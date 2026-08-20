import { prisma } from "../config/prisma";

type LogLevel = "INFO" | "WARN" | "ERROR";

// Journalisation technique (point 68). Ne jamais passer de secrets dans `metadata`.
export async function logEvent(params: {
  projectId?: string | null;
  level?: LogLevel;
  category: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.log.create({
      data: {
        projectId: params.projectId ?? null,
        level: params.level ?? "INFO",
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
