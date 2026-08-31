import { prisma } from "../config/prisma";

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
// marque les éléments comme consommés.
export async function resolveDigestVariable(projectId: string): Promise<string> {
  const items = await prisma.digestItem.findMany({
    where: { projectId, consumed: false },
    orderBy: { createdAt: "asc" },
  });

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
          // Le format actuel ne mentionne pas d'heure de coup d'envoi précise ;
          // la date de création du digest est la meilleure approximation
          // disponible du jour "aujourd'hui" retenu par l'analyse IA.
          matchDate: item.createdAt,
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
