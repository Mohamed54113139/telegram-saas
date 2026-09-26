import { prisma } from "../config/prisma";
import { localDateParts } from "../utils/timezone";

function dateKeyInTimezone(date: Date, timezone: string): string {
  const { year, month, day } = localDateParts(date, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Parse une ligne du format strict produit par analyzeFootballArticle
// (feedWatcherService.ts) : "[drapeau emoji] Équipe A vs Équipe B : résultat
// prédit". Le drapeau (ou toute autre séquence de caractères non-lettres en
// tête) est retiré via \p{L}, sans dépendre d'une détection d'emoji précise.
function parseMatchLine(line: string): { teamA: string; teamB: string; predictedResult: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const vsIndex = trimmed.indexOf(" vs ");
  if (vsIndex === -1) return null;

  const left = trimmed.slice(0, vsIndex);
  const right = trimmed.slice(vsIndex + 4);

  const colonIndex = right.indexOf(" : ");
  if (colonIndex === -1) return null;

  const teamA = left.replace(/^[^\p{L}]+/u, "").trim();
  const teamB = right.slice(0, colonIndex).trim();
  const predictedResult = right.slice(colonIndex + 3).trim();

  if (!teamA || !teamB || !predictedResult) return null;
  return { teamA, teamB, predictedResult };
}

// Récupère les éléments accumulés non encore utilisés pour ce projet, les
// formate en liste, crée une entrée de suivi (MatchResult) pour chaque match
// identifié afin de vérifier automatiquement le résultat après coup, puis
// marque les éléments consommés.
//
// Un article "preview" est souvent collecté 1-2 jours avant le match (voir
// feedWatcherService.ts) : sans filtre ici, un message "PRONOSTICS DU JOUR"
// pourrait mélanger des matchs d'aujourd'hui avec des matchs d'après-demain,
// ce qui n'a plus rien à voir avec "aujourd'hui" pour qui le lit. On ne
// consomme donc QUE les éléments dont la vraie date de match (matchDate,
// repli sur createdAt si absente) tombe sur la date du jour, dans le fuseau
// du projet — les autres restent en attente jusqu'à leur propre jour.
export async function resolveDigestVariable(projectId: string, timezone: string): Promise<string> {
  const allPending = await prisma.digestItem.findMany({
    where: { projectId, consumed: false },
    orderBy: { createdAt: "asc" },
  });

  const todayKey = dateKeyInTimezone(new Date(), timezone);
  const items = allPending.filter((item) => dateKeyInTimezone(item.matchDate ?? item.createdAt, timezone) === todayKey);

  if (items.length === 0) {
    return "Aucune information trouvée aujourd'hui.";
  }

  const formatted = items.map((item) => `• ${item.title}`).join("\n\n");

  for (const item of items) {
    const lines = item.title.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parsed = parseMatchLine(line);
      if (!parsed) continue;
      await prisma.matchResult.create({
        data: {
          projectId,
          teamA: parsed.teamA,
          teamB: parsed.teamB,
          predictedResult: parsed.predictedResult,
          // Date réelle du match extraite par l'IA (feedWatcherService.ts) si
          // disponible — un article "preview" est souvent publié 1-2 jours
          // avant le match, donc createdAt seul serait faux dans ce cas.
          // Repli sur createdAt uniquement si la date n'a pas pu être extraite.
          matchDate: item.matchDate ?? item.createdAt,
        },
      });
    }
  }

  await prisma.digestItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { consumed: true },
  });

  return formatted;
}
