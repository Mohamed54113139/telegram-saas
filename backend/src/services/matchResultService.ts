import fetch from "node-fetch";
import { MatchResult, Project } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { localDateParts, localTimeParts } from "../utils/timezone";
import { logEvent } from "./logService";

// Heure locale (fuseau du projet) du récapitulatif quotidien.
const DAILY_RECAP_HOUR = 23;
const DAILY_RECAP_MINUTE = 30;
// Fenêtre de tolérance (en minutes) : ce job est vérifié périodiquement
// (voir checkDailyMatchResultsRecap), pas exactement à la seconde près.
const DAILY_RECAP_WINDOW_MINUTES = 15;

// Après ce nombre de tentatives infructueuses (réparties sur plusieurs
// jours), on arrête d'essayer pour ce match.
const MAX_LOOKUP_ATTEMPTS = 5;
// Forfait gratuit API-Football : 100 requêtes/jour. On garde une petite
// marge de sécurité plutôt que de viser exactement la limite.
const DAILY_CALL_LIMIT = 90;

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKeyInTimezone(date: Date, timezone: string): string {
  const { year, month, day } = localDateParts(date, timezone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

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

function formatVerdict(wasCorrect: boolean | null): string {
  if (wasCorrect === null) return "résultat non déterminé automatiquement";
  return wasCorrect ? "correct ✅" : "incorrect ❌";
}

// Traite le récapitulatif quotidien pour un projet : interroge l'API-Football
// pour chaque match en attente (dans la limite du quota restant du jour, en
// priorisant les plus anciens), regroupe tous les résultats trouvés en un
// seul message, et le publie via un ScheduledPost classique.
async function runDailyRecapForProject(project: Project, todayKey: string): Promise<void> {
  // Marqué tout de suite : ne doit jamais se relancer deux fois le même jour
  // pour ce projet, même si la suite échoue en cours de route.
  await prisma.project.update({ where: { id: project.id }, data: { lastMatchResultsRecapDate: todayKey } });

  const pending = await prisma.matchResult.findMany({
    where: { projectId: project.id, status: "PENDING" },
    orderBy: { matchDate: "asc" }, // les plus anciens en attente en premier si le quota est serré
  });
  if (pending.length === 0) return;

  if (!env.apiFootballKey) {
    await logEvent({
      projectId: project.id,
      category: "matchResults",
      level: "WARN",
      message: "API_FOOTBALL_KEY non configurée : récapitulatif quotidien des résultats ignoré.",
    });
    return;
  }

  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);
  let callsUsedToday = await prisma.apiFootballCall.count({ where: { createdAt: { gte: startOfUtcDay } } });

  const fixturesByDate = new Map<string, ApiFootballFixture[]>();
  const found: { match: MatchResult; scoreA: number; scoreB: number; wasCorrect: boolean | null }[] = [];
  let quotaReached = false;

  for (const match of pending) {
    if (callsUsedToday >= DAILY_CALL_LIMIT) {
      quotaReached = true;
      break;
    }

    try {
      const dateKey = dateKeyInTimezone(match.matchDate, project.timezone);

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
        await prisma.matchResult.update({
          where: { id: match.id },
          data: {
            status: "FOUND",
            finalScoreA: fixture.scoreForA,
            finalScoreB: fixture.scoreForB,
            wasCorrect,
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });
        found.push({ match, scoreA: fixture.scoreForA, scoreB: fixture.scoreForB, wasCorrect });
      } else {
        const attempts = match.attempts + 1;
        const status = attempts >= MAX_LOOKUP_ATTEMPTS ? "NOT_FOUND" : "PENDING";
        await prisma.matchResult.update({ where: { id: match.id }, data: { attempts, status, lastAttemptAt: new Date() } });

        if (status === "NOT_FOUND") {
          await logEvent({
            projectId: project.id,
            level: "WARN",
            category: "matchResults",
            message: `Résultat introuvable pour ${match.teamA} vs ${match.teamB} après ${attempts} tentative(s), abandon.`,
            metadata: { matchResultId: match.id },
          });
        }
      }
    } catch (err: any) {
      await logEvent({
        projectId: project.id,
        level: "ERROR",
        category: "matchResults",
        message: `Échec de vérification du résultat pour ${match.teamA} vs ${match.teamB}.`,
        metadata: { matchResultId: match.id, error: err?.message },
      });
    }
  }

  if (quotaReached) {
    await logEvent({
      projectId: project.id,
      category: "matchResults",
      level: "WARN",
      message: `Limite quotidienne d'appels API-Football atteinte (${DAILY_CALL_LIMIT}), matchs restants reportés au lendemain.`,
    });
  }

  if (found.length === 0) return;

  const lines = found.map(
    ({ match, scoreA, scoreB, wasCorrect }) => `⚽ ${match.teamA} ${scoreA} - ${scoreB} ${match.teamB} — Pronostic : ${formatVerdict(wasCorrect)}`
  );
  const text = lines.join("\n");

  const messageTemplate = await prisma.messageTemplate.create({
    data: {
      projectId: project.id,
      name: `Récapitulatif résultats du ${todayKey}`,
      originalContent: text,
      autoEdit: false,
    },
  });

  const post = await prisma.scheduledPost.create({
    data: {
      projectId: project.id,
      messageTemplateId: messageTemplate.id,
      idempotencyKey: `matchresults-recap:${project.id}:${todayKey}`,
      scheduledFor: new Date(),
      status: "SCHEDULED",
    },
  });

  await prisma.matchResult.updateMany({
    where: { id: { in: found.map((r) => r.match.id) } },
    data: { followUpPostId: post.id },
  });

  await logEvent({
    projectId: project.id,
    category: "matchResults",
    message: `Récapitulatif quotidien des résultats publié (${found.length} match(s)).`,
    metadata: { postId: post.id, count: found.length },
  });
}

// Vérifie, pour chaque projet ayant des matchs en attente, s'il est
// actuellement l'heure du récapitulatif quotidien (23h30 dans SON fuseau
// horaire) et si ce n'est pas déjà fait aujourd'hui. Conçu pour être appelé
// fréquemment (toutes les 15 min) plutôt que de nécessiter un cron distinct
// par fuseau horaire.
export async function checkDailyMatchResultsRecap(): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { matchResults: { some: { status: "PENDING" } } },
  });

  for (const project of projects) {
    const { hour, minute } = localTimeParts(new Date(), project.timezone);
    const isRecapWindow =
      hour === DAILY_RECAP_HOUR && minute >= DAILY_RECAP_MINUTE && minute < DAILY_RECAP_MINUTE + DAILY_RECAP_WINDOW_MINUTES;
    if (!isRecapWindow) continue;

    const todayKey = dateKeyInTimezone(new Date(), project.timezone);
    if (project.lastMatchResultsRecapDate === todayKey) continue; // déjà fait aujourd'hui

    try {
      await runDailyRecapForProject(project, todayKey);
    } catch (err: any) {
      await logEvent({
        projectId: project.id,
        level: "ERROR",
        category: "matchResults",
        message: "Échec du récapitulatif quotidien des résultats.",
        metadata: { error: err?.message },
      });
    }
  }
}
