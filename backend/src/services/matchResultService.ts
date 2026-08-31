import fetch from "node-fetch";
import { MatchResult, Project } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { localDateParts } from "../utils/timezone";
import { logEvent } from "./logService";

// Le résultat n'est cherché qu'une fois le match probablement terminé.
const RESULT_LOOKUP_DELAY_HOURS = 3;
// Après ce nombre de tentatives infructueuses (réparties sur plusieurs
// cycles horaires), on arrête d'essayer pour ce match.
const MAX_LOOKUP_ATTEMPTS = 5;
// Forfait gratuit API-Football : 100 requêtes/jour. On garde une marge de
// sécurité plutôt que de viser exactement la limite.
const DAILY_CALL_LIMIT = 90;

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";

interface ApiFootballFixture {
  teamHome: string;
  teamAway: string;
  scoreHome: number | null;
  scoreAway: number | null;
  statusShort: string | null;
}

// Une requête par date interrogée (pas par match) : on récupère tous les
// matchs du jour puis on cherche les équipes dedans côté serveur — beaucoup
// plus économe que de chercher par équipe (qui nécessiterait de résoudre un
// ID d'équipe au préalable, donc un appel supplémentaire par équipe).
async function fetchFixturesForDate(dateStr: string): Promise<ApiFootballFixture[]> {
  const res = await fetch(`${API_FOOTBALL_BASE_URL}/fixtures?date=${dateStr}`, {
    headers: { "x-apisports-key": env.apiFootballKey },
  });
  if (!res.ok) {
    throw new Error(`L'API-Football a répondu ${res.status}.`);
  }
  const data = (await res.json()) as any;
  return (data.response ?? []).map((f: any) => ({
    teamHome: f.teams?.home?.name ?? "",
    teamAway: f.teams?.away?.name ?? "",
    scoreHome: f.goals?.home ?? null,
    scoreAway: f.goals?.away ?? null,
    statusShort: f.fixture?.status?.short ?? null,
  }));
}

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

interface MatchedFixture {
  scoreForA: number;
  scoreForB: number;
  isFinal: boolean;
}

// Cherche, parmi les matchs du jour, celui qui oppose teamA à teamB (dans
// n'importe quel ordre domicile/extérieur), et remet les scores dans l'ordre
// A/B attendu par l'appelant.
function findMatchingFixture(fixtures: ApiFootballFixture[], teamA: string, teamB: string): MatchedFixture | null {
  for (const f of fixtures) {
    const isFinal = f.statusShort === "FT" && f.scoreHome !== null && f.scoreAway !== null;
    if (teamNamesMatch(f.teamHome, teamA) && teamNamesMatch(f.teamAway, teamB)) {
      return { scoreForA: f.scoreHome ?? 0, scoreForB: f.scoreAway ?? 0, isFinal };
    }
    if (teamNamesMatch(f.teamHome, teamB) && teamNamesMatch(f.teamAway, teamA)) {
      return { scoreForA: f.scoreAway ?? 0, scoreForB: f.scoreHome ?? 0, isFinal };
    }
  }
  return null;
}

// Compare le pronostic original (format produit par analyzeFootballArticle :
// "Équipe A gagne" / "Équipe B gagne" / "Match nul" / "plus de X buts" / ...)
// au score réel. Renvoie null si le marché n'est pas reconnu — pas de verdict
// automatique plutôt qu'un résultat deviné.
export function evaluatePrediction(predictedResult: string, teamA: string, teamB: string, scoreA: number, scoreB: number): boolean | null {
  const normalized = predictedResult.toLowerCase();

  const overMatch = normalized.match(/(?:plus de|over)\s*(\d+(?:\.\d+)?)/);
  if (overMatch) return scoreA + scoreB > parseFloat(overMatch[1]);

  const underMatch = normalized.match(/(?:moins de|under)\s*(\d+(?:\.\d+)?)/);
  if (underMatch) return scoreA + scoreB < parseFloat(underMatch[1]);

  if (normalized.includes("nul")) return scoreA === scoreB;

  if (normalized.includes(teamA.toLowerCase()) && normalized.includes("gagne")) return scoreA > scoreB;
  if (normalized.includes(teamB.toLowerCase()) && normalized.includes("gagne")) return scoreB > scoreA;

  return null;
}

// Crée un ScheduledPost de suivi (même mécanisme que les articles de veille :
// un MessageTemplate à la volée + un ScheduledPost immédiat), publié sur le
// même canal Telegram du projet via le cycle normal du scheduler.
async function publishFollowUp(match: MatchResult, scoreA: number, scoreB: number, wasCorrect: boolean | null): Promise<string> {
  const verdict = wasCorrect === null ? "résultat non déterminé automatiquement" : wasCorrect ? "correct ✅" : "incorrect ❌";
  const text = `⚽ ${match.teamA} ${scoreA} - ${scoreB} ${match.teamB} — Pronostic : ${verdict}`;

  const messageTemplate = await prisma.messageTemplate.create({
    data: {
      projectId: match.projectId,
      name: `Suivi résultat : ${match.teamA} vs ${match.teamB}`,
      originalContent: text,
      autoEdit: false,
    },
  });

  const post = await prisma.scheduledPost.create({
    data: {
      projectId: match.projectId,
      messageTemplateId: messageTemplate.id,
      idempotencyKey: `matchresult:${match.id}`,
      scheduledFor: new Date(),
      status: "SCHEDULED",
    },
  });

  return post.id;
}

// Job périodique (toutes les heures) : cherche le résultat des matchs en
// attente dont le coup d'envoi est passé depuis au moins 3h, publie un
// message de suivi quand le résultat est trouvé, et abandonne après 5
// tentatives infructueuses. Respecte un quota quotidien d'appels API, en
// priorisant les matchs en attente les plus anciens.
export async function checkPendingMatchResults(): Promise<void> {
  if (!env.apiFootballKey) return; // pas de log répété à chaque heure si simplement non configuré

  const threshold = new Date(Date.now() - RESULT_LOOKUP_DELAY_HOURS * 60 * 60 * 1000);
  const pending = await prisma.matchResult.findMany({
    where: { status: "PENDING", matchDate: { lte: threshold } },
    orderBy: { matchDate: "asc" }, // les plus anciens en premier si le quota est serré
    include: { project: true },
  });
  if (pending.length === 0) return;

  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);
  let callsUsedToday = await prisma.apiFootballCall.count({ where: { createdAt: { gte: startOfUtcDay } } });

  const fixturesByDate = new Map<string, ApiFootballFixture[]>();

  for (const match of pending as (MatchResult & { project: Project })[]) {
    if (callsUsedToday >= DAILY_CALL_LIMIT) {
      await logEvent({
        category: "matchResults",
        level: "WARN",
        message: `Limite quotidienne d'appels API-Football atteinte (${DAILY_CALL_LIMIT}), matchs restants reportés au prochain cycle.`,
      });
      break;
    }

    try {
      const { year, month, day } = localDateParts(match.matchDate, match.project.timezone);
      const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      let fixtures = fixturesByDate.get(dateKey);
      if (!fixtures) {
        fixtures = await fetchFixturesForDate(dateKey);
        callsUsedToday++;
        await prisma.apiFootballCall.create({ data: {} });
        fixturesByDate.set(dateKey, fixtures);
      }

      const fixture = findMatchingFixture(fixtures, match.teamA, match.teamB);

      if (fixture?.isFinal) {
        const wasCorrect = evaluatePrediction(match.predictedResult, match.teamA, match.teamB, fixture.scoreForA, fixture.scoreForB);
        const followUpPostId = await publishFollowUp(match, fixture.scoreForA, fixture.scoreForB, wasCorrect);

        await prisma.matchResult.update({
          where: { id: match.id },
          data: {
            status: "FOUND",
            finalScoreA: fixture.scoreForA,
            finalScoreB: fixture.scoreForB,
            wasCorrect,
            followUpPostId,
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });

        await logEvent({
          projectId: match.projectId,
          category: "matchResults",
          message: `Résultat trouvé pour ${match.teamA} vs ${match.teamB} (${fixture.scoreForA}-${fixture.scoreForB}), suivi publié.`,
          metadata: { matchResultId: match.id, wasCorrect },
        });
      } else {
        const attempts = match.attempts + 1;
        const status = attempts >= MAX_LOOKUP_ATTEMPTS ? "NOT_FOUND" : "PENDING";

        await prisma.matchResult.update({
          where: { id: match.id },
          data: { attempts, status, lastAttemptAt: new Date() },
        });

        if (status === "NOT_FOUND") {
          await logEvent({
            projectId: match.projectId,
            level: "WARN",
            category: "matchResults",
            message: `Résultat introuvable pour ${match.teamA} vs ${match.teamB} après ${attempts} tentative(s), abandon.`,
            metadata: { matchResultId: match.id },
          });
        }
      }
    } catch (err: any) {
      await logEvent({
        projectId: match.projectId,
        level: "ERROR",
        category: "matchResults",
        message: `Échec de vérification du résultat pour ${match.teamA} vs ${match.teamB}.`,
        metadata: { matchResultId: match.id, error: err?.message },
      });
    }
  }
}
