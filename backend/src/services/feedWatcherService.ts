import Parser from "rss-parser";
import { ContentSource } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logEvent } from "./logService";

const parser = new Parser();

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
    const feed = await parser.parseURL(source.feedUrl);

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
        // Mode digest : accumule l'élément, ne publie rien individuellement
        await prisma.digestItem.create({
          data: { projectId: source.projectId, contentSourceId: source.id, title, link, summary },
        });
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
      message: "Échec de vérification d'une source de veille.",
      metadata: { sourceId: source.id, error: err?.message },
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
