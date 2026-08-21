import { prisma } from "../config/prisma";

// Récupère les éléments accumulés non encore utilisés pour ce projet, les
// formate en liste, et les marque comme consommés.
export async function resolveDigestVariable(projectId: string): Promise<string> {
  const items = await prisma.digestItem.findMany({
    where: { projectId, consumed: false },
    orderBy: { createdAt: "asc" },
  });

  if (items.length === 0) {
    return "Aucune information trouvée aujourd'hui.";
  }

  const formatted = items
    .map((item) => `• ${item.title}${item.link ? `\n${item.link}` : ""}`)
    .join("\n\n");

  await prisma.digestItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { consumed: true },
  });

  return formatted;
}
