import { MessageTemplate, MessageVariable, Project, ProtectedVariable } from "@prisma/client";
import { resolveVariables } from "./variableService";
import { generateRewrite } from "./aiRewriteService";
import { resolveDigestVariable } from "./digestService";
import { prisma } from "../config/prisma";

export interface GeneratedContent {
  originalContent: string;
  generatedContent: string;
  usedVariables: Record<string, string>;
  wasRewritten: boolean;
  rewriteVerified: boolean;
  rewriteIssues: string[];
}

// Point central de génération d'un message final à partir d'un modèle.
// Le modèle original (template.originalContent) n'est JAMAIS modifié ici (Règle 1).
export async function generateMessageContent(
  template: MessageTemplate,
  project: Project,
  overrides?: Record<string, string>
): Promise<GeneratedContent> {
  // 0. Variable spéciale {PRONOS_DU_JOUR} : injecte le digest accumulé des
  // sources en mode digest, puis le vide (consommé). Le modèle original
  // (template.originalContent) n'est jamais modifié, seule cette copie de
  // travail l'est (Règle 1).
  let baseContent = template.originalContent;
  if (baseContent.includes("{PRONOS_DU_JOUR}")) {
    const digest = await resolveDigestVariable(project.id);
    baseContent = baseContent.split("{PRONOS_DU_JOUR}").join(digest);
  }

  const [variables, protectedVars] = await Promise.all([
    prisma.messageVariable.findMany({ where: { projectId: project.id } }),
    prisma.protectedVariable.findMany({ where: { projectId: project.id } }),
  ]);

  // 1. Résolution des variables modifiables ({NOM}, {VALEUR}, {DATE}...)
  const { resolved, usedValues } = resolveVariables(
    baseContent,
    variables,
    project.timezone,
    { randomMinMinutes: template.randomMinMinutes, randomMaxMinutes: template.randomMaxMinutes },
    overrides
  );

  let finalText = resolved;
  let wasRewritten = false;
  let rewriteVerified = true;
  let rewriteIssues: string[] = [];

  // 2. Reformulation IA si activée (Règle 2 : si OFF, copie exacte, aucune modification)
  if (template.autoEdit) {
    const protectedValues = protectedVars.map((p: ProtectedVariable) => p.value);
    const recentVariants = await getRecentVariants(project, template.id);

    const rewrite = await generateRewrite({
      content: resolved,
      editLevel: template.editLevel as any,
      customInstructions: template.customInstructions,
      similarity: template.similarity,
      protectedValues,
      requiredElements: template.requiredElements,
      preserveEmojis: template.preserveEmojis,
      preservePunctuation: template.preservePunctuation,
      recentVariants,
    });

    finalText = rewrite.text;
    wasRewritten = rewrite.text !== resolved;
    rewriteVerified = rewrite.verified;
    rewriteIssues = rewrite.issues;
  }

  // 3. Signature automatique (point 25)
  const signatureEnabled = template.signatureEnabledOverride ?? project.signatureEnabled;
  const signature = template.signatureOverride ?? project.signature;
  if (signatureEnabled && signature) {
    finalText = `${finalText}\n\n${signature}`;
  }

  return {
    originalContent: template.originalContent,
    generatedContent: finalText,
    usedVariables: usedValues,
    wasRewritten,
    rewriteVerified,
    rewriteIssues,
  };
}

// Récupère les dernières variantes publiées pour l'anti-répétition (point 26)
async function getRecentVariants(project: Project, messageTemplateId: string): Promise<string[]> {
  if (!project.antiRepetitionEnabled) return [];
  const recent = await prisma.scheduledPost.findMany({
    where: { projectId: project.id, messageTemplateId, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: project.antiRepetitionWindow,
    select: { generatedContent: true },
  });
  return recent.map((r: { generatedContent: string | null }) => r.generatedContent).filter((c: string | null): c is string => !!c);
}
