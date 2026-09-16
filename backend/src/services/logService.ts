import { prisma } from "../config/prisma";

type LogLevel = "INFO" | "WARN" | "ERROR";

// Journalisation technique (point 68). Ne jamais passer de secrets dans `metadata`.
//
// Seuls les événements importants (WARN/ERROR — échecs de publication,
// erreurs critiques) sont écrits en base. Les logs de routine (INFO — succès
// normal, cycles de matérialisation) ne passent que par la console (visibles
// dans les logs Render), pour limiter le volume de requêtes/données échangées
// avec la base (quota réseau Neon).
export async function logEvent(params: {
  projectId?: string | null;
  level?: LogLevel;
  category: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const level = params.level ?? "INFO";

  if (level === "INFO") {
    console.log(`[INFO] [${params.category}] ${params.message}`);
    return;
  }

  try {
    await prisma.log.create({
      data: {
        projectId: params.projectId ?? null,
        level,
        category: params.category,
        message: params.message,
        metadata: params.metadata ? (params.metadata as any) : undefined,
      },
    });
  } catch (e) {
    // Le logging ne doit jamais faire planter une opération métier
    console.error("Échec de journalisation:", e);
  }
}
