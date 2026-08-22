import OpenAI from "openai";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { HttpError } from "../middleware/errorHandler";

const client = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

export async function generateInstructionSuggestion(messageTemplateId: string, projectId: string) {
  const template = await prisma.messageTemplate.findFirst({ where: { id: messageTemplateId, projectId } });
  if (!template) throw new HttpError(404, "Message introuvable.");

  const feedbackPosts = await prisma.scheduledPost.findMany({
    where: { messageTemplateId, feedback: { not: null }, generatedContent: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: 20,
  });

  if (feedbackPosts.length < 3) {
    throw new HttpError(400, "Au moins 3 retours (👍 ou 👎) sont nécessaires avant de pouvoir proposer une amélioration.");
  }
  if (!client) {
    throw new HttpError(400, "OPENAI_API_KEY non configurée.");
  }

  const positives = feedbackPosts.filter((p) => p.feedback === "POSITIVE").map((p) => p.generatedContent).join("\n---\n");
  const negatives = feedbackPosts.filter((p) => p.feedback === "NEGATIVE").map((p) => p.generatedContent).join("\n---\n");

  const systemPrompt = `Tu aides à améliorer les instructions de reformulation d'un message automatisé, à partir de retours utilisateur (👍/👎) sur des versions déjà envoyées.

RÈGLES ABSOLUES :
1. Ne change jamais le sujet ou l'objectif du message, uniquement le style/ton.
2. Base-toi UNIQUEMENT sur les exemples fournis, n'invente aucune préférence non déductible de ces exemples.
3. Réponds UNIQUEMENT avec un JSON valide : { "suggestedInstructions": "...", "reasoning": "explication en 1-2 phrases de ce que tu as observé dans les retours" }

Instructions personnalisées actuelles : ${template.customInstructions ?? "(aucune)"}

Exemples appréciés (👍) :
${positives || "(aucun)"}

Exemples non appréciés (👎) :
${negatives || "(aucun)"}`;

  const response = await client.chat.completions.create({
    model: env.openaiModel,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Propose une amélioration." }],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { suggestedInstructions: string; reasoning: string };

  return prisma.instructionSuggestion.create({
    data: {
      projectId,
      messageTemplateId,
      currentInstructions: template.customInstructions,
      suggestedInstructions: parsed.suggestedInstructions,
      reasoning: parsed.reasoning,
    },
  });
}
