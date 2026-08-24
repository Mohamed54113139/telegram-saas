import fetch from "node-fetch";
import Parser from "rss-parser";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import OpenAI from "openai";
import { ContentSource } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logEvent } from "./logService";
import { env } from "../config/env";

const parser = new Parser();
const aiClient = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

// Certains flux RSS mal formés contiennent des "&" isolés (ex: "Ligue 1 & 2",
// des URL non échappées...) qui font planter le parseur XML. On échappe tout
// "&" qui n'est pas déjà le début d'une entité valide, avant de parser.
const RAW_AMPERSAND_PATTERN = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g;

function sanitizeFeedXml(raw: string): string {
  return raw.replace(RAW_AMPERSAND_PATTERN, "&amp;");
}

// Un User-Agent de navigateur évite les blocages 403 de certains sites qui
// rejettent les requêtes sans en-tête ou avec un User-Agent générique de bot.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Récupère le flux en texte brut (plutôt que de laisser rss-parser faire sa
// propre requête), nettoie le XML, puis le parse — appliqué à toutes les
// sources pour se protéger de flux mal formés.
async function fetchAndParseFeed(feedUrl: string) {
  const res = await fetch(feedUrl, { headers: { "User-Agent": BROWSER_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Impossible de récupérer le flux (HTTP ${res.status}).`);
  }
  const raw = await res.text();
  const sanitized = sanitizeFeedXml(raw);
  return parser.parseString(sanitized);
}

// Récupère la page complète d'un article et en extrait le texte principal
// (corps de l'article, sans menus/pubs/navigation) via Readability, le même
// standard que celui utilisé par le mode lecture de Firefox.
async function fetchArticleText(articleUrl: string): Promise<string> {
  const res = await fetch(articleUrl, { headers: { "User-Agent": BROWSER_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Impossible de récupérer l'article (HTTP ${res.status}).`);
  }
  const html = await res.text();
  const dom = new JSDOM(html, { url: articleUrl });
  const article = new Readability(dom.window.document).parse();
  if (!article?.textContent?.trim()) {
    throw new Error("Impossible d'extraire le contenu principal de l'article.");
  }
  return article.textContent.trim();
}

interface FootballArticleAnalysis {
  hasMatchToday: boolean;
  summary: string | null;
}

// Demande à l'IA si l'article concerne un ou plusieurs matchs de football se
// jouant précisément aujourd'hui (dans le fuseau horaire du projet), et si
// oui, produit une ligne stricte par match ("[drapeau] Équipe A vs Équipe B :
// résultat prédit"), sans justification, sans jamais inventer de cote ou de
// statistique absente du texte source. En cas de doute, l'article est
// rejeté plutôt que deviné.
async function analyzeFootballArticle(articleText: string, timezone: string): Promise<FootballArticleAnalysis> {
  if (!aiClient) {
    return { hasMatchToday: false, summary: null };
  }

  const todayLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .format(new Date())
    .toLowerCase();

  const systemPrompt = `Tu analyses un article de site de pronostics football pour un système de publication automatisée.

Nous sommes aujourd'hui le ${todayLabel} (fuseau horaire du projet).

RÈGLES ABSOLUES :
1. Détermine si l'article concerne un ou plusieurs matchs de football ayant lieu PRÉCISÉMENT aujourd'hui. Si ce n'est pas identifiable avec certitude (date différente, date absente ou ambiguë, article pas centré sur un match précis), rejette : hasMatchToday=false, summary=null. En cas de doute, rejette plutôt que de deviner.
2. N'invente JAMAIS de cote, statistique ou information qui n'est pas explicitement mentionnée dans le texte fourni.
3. Si accepté, produis en français UNE SEULE LIGNE STRICTE par match identifié, SANS justification et sans aucun autre texte, au format exact :
[drapeau emoji du pays de la compétition] Équipe A vs Équipe B : [résultat prédit]
   - Résultat prédit : "Équipe A gagne", "Équipe B gagne", "Match nul", ou le marché parié tel que mentionné dans l'article (ex: "plus de 2.5 buts") si ce n'est pas un simple résultat de victoire/nul.
   - Drapeau : celui du pays de la compétition/ligue mentionnée dans l'article (ex: 🏴󠁧󠁢󠁥󠁮󠁧󠁿 ou 🇬🇧 pour Premier League/Championship anglais, 🇪🇸 pour LaLiga, 🇮🇹 pour Serie A, 🇫🇷 pour Ligue 1, 🇩🇪 pour Bundesliga, 🇪🇺 pour Ligue des Champions/Europa League, etc.). Si le pays ou la compétition n'est pas identifiable avec certitude, OMETS le drapeau plutôt que d'en inventer un.
   - Si plusieurs matchs, une ligne par match, séparées par un simple retour à la ligne (pas de ligne vide entre elles).
   - Traduis en français même si l'article source est en anglais (garde les noms d'équipes tels quels).
4. Réponds UNIQUEMENT avec un JSON valide de la forme : { "hasMatchToday": boolean, "summary": string | null }`;

  const response = await aiClient.chat.completions.create({
    model: env.openaiModel,
    max_tokens: 600,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: articleText.slice(0, 8000) },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<FootballArticleAnalysis>;
  return {
    hasMatchToday: !!parsed.hasMatchToday,
    summary: parsed.hasMatchToday ? parsed.summary ?? null : null,
  };
}

// Filtre par mots-clés football : un article n'est retenu que si son titre
// contient au moins un de ces mots (insensible à la casse).
const FOOTBALL_KEYWORDS = ["football", "foot", "match", "pronostic", "predictions", "tips", "betting"];

function matchesFootballKeywords(title: string): boolean {
  const lower = title.toLowerCase();
  return FOOTBALL_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// Une source n'est revérifiée que si son intervalle (checkIntervalMinutes)
// est écoulé depuis la dernière vérification.
function isDueForCheck(source: ContentSource): boolean {
  if (!source.lastCheckedAt) return true;
  const dueAt = source.lastCheckedAt.getTime() + source.checkIntervalMinutes * 60_000;
  return Date.now() >= dueAt;
}

// Un élément est considéré comme déjà traité s'il a déjà une entrée
// ContentSourceItem pour cette source (déduplication par guid/lien/titre).
async function isDuplicate(contentSourceId: string, guid: string): Promise<boolean> {
  const existing = await prisma.contentSourceItem.findUnique({
    where: { contentSourceId_guid: { contentSourceId, guid } },
  });
  return !!existing;
}

// Vérifie un flux RSS et traite chaque nouvel élément trouvé.
export async function checkSource(source: ContentSource): Promise<void> {
  try {
    const project = await prisma.project.findUnique({ where: { id: source.projectId }, select: { timezone: true } });
    const projectTimezone = project?.timezone ?? "UTC";

    const feed = await fetchAndParseFeed(source.feedUrl);

    for (const item of feed.items ?? []) {
      const guid = item.guid || item.link || item.title;
      if (!guid) continue;

      const isDup = await isDuplicate(source.id, guid);
      if (isDup) continue;

      // Marque l'élément comme vu avant tout traitement, pour ne jamais le retraiter
      await prisma.contentSourceItem.create({ data: { contentSourceId: source.id, guid } });

      const title = item.title ?? "Sans titre";
      if (!matchesFootballKeywords(title)) continue;

      const link = item.link ?? null;
      const summary = item.contentSnippet ?? item.content ?? null;

      if (source.digestMode) {
        // Mode digest : extrait l'article complet, demande à l'IA s'il concerne
        // un match du jour, et n'accumule que le résumé structuré produit (pas
        // le titre brut). Isolé dans son propre try/catch : un échec sur cet
        // article (extraction ou analyse) ne doit pas interrompre le
        // traitement des autres articles de cette source.
        try {
          if (!link) {
            throw new Error("Article sans lien, extraction impossible.");
          }
          const articleText = await fetchArticleText(link);
          const analysis = await analyzeFootballArticle(articleText, projectTimezone);

          if (!analysis.hasMatchToday || !analysis.summary) {
            await logEvent({
              projectId: source.projectId,
              category: "feedWatcher",
              message: `Article ignoré (aucun match du jour identifié avec certitude) : "${title}".`,
              metadata: { sourceId: source.id, sourceName: source.name, link },
            });
            continue;
          }

          await prisma.digestItem.create({
            data: { projectId: source.projectId, contentSourceId: source.id, title: analysis.summary, link, summary: null },
          });
        } catch (err: any) {
          await logEvent({
            projectId: source.projectId,
            level: "ERROR",
            category: "feedWatcher",
            message: `Échec d'extraction/analyse de l'article "${title}".`,
            metadata: { sourceId: source.id, sourceName: source.name, link, error: err?.message },
          });
        }
        continue; // passe au prochain item, ne fait rien d'autre pour celui-ci
      } else {
        const messageTemplate = await prisma.messageTemplate.create({
          data: {
            projectId: source.projectId,
            name: title,
            originalContent: [title, summary, link].filter(Boolean).join("\n\n"),
            autoEdit: false,
          },
        });

        // Mode AUTO : publie immédiatement ; mode MANUAL : laisse l'utilisateur programmer lui-même
        if (source.mode === "AUTO") {
          await prisma.scheduledPost.create({
            data: {
              projectId: source.projectId,
              messageTemplateId: messageTemplate.id,
              idempotencyKey: `source:${source.id}:${guid}`,
              scheduledFor: new Date(),
              status: "SCHEDULED",
            },
          });
        }
      }
    }

    await prisma.contentSource.update({
      where: { id: source.id },
      data: { lastCheckedAt: new Date(), lastError: null },
    });
  } catch (err: any) {
    await prisma.contentSource.update({
      where: { id: source.id },
      data: { lastCheckedAt: new Date(), lastError: err?.message ?? "Erreur inconnue." },
    });
    await logEvent({
      projectId: source.projectId,
      level: "ERROR",
      category: "feedWatcher",
      message: `Échec de vérification de la source "${source.name}".`,
      metadata: { sourceId: source.id, sourceName: source.name, error: err?.message },
    });
  }
}

// Vérifie toutes les sources actives (appelé par le scheduler périodique)
export async function checkAllActiveSources(): Promise<void> {
  const sources = await prisma.contentSource.findMany({ where: { active: true } });
  for (const source of sources) {
    if (!isDueForCheck(source)) continue;
    await checkSource(source);
  }
}
