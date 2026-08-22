import OpenAI from "openai";
import { env } from "../config/env";
import { Project } from "@prisma/client";
import { HttpError } from "../middleware/errorHandler";

const client = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

export interface AssistantPlan {
  summary: string;
  messages: Array<{
    name: string;
    content: string;
    autoEdit: boolean;
    editLevel: "LEGERE" | "NORMALE" | "IMPORTANTE";
    similarity: number;
  }>;
  schedules: Array<{
    messageIndex: number;
    repeatMode: "DAILY" | "CUSTOM_DAYS";
    daysOfWeek: number[];
    times: string[];
  }>;
  sources: Array<{
    name: string;
    feedUrlHint: string; // description de ce qu'il faut chercher, PAS une vraie URL inventée
    mode: "AUTO" | "MANUAL";
    digestMode: boolean;
    checkIntervalMinutes: number;
  }>;
}

export async function proposeConfiguration(description: string, project: Project): Promise<AssistantPlan> {
  if (!client) {
    throw new HttpError(400, "OPENAI_API_KEY non configurée : assistant indisponible.");
  }

  const systemPrompt = `Tu es un assistant qui aide à configurer une plateforme d'automatisation de publications Telegram.

RÈGLES ABSOLUES :
1. Ne propose QUE des configurations basées sur ce que l'utilisateur décrit. N'invente jamais de faits, de statistiques ou d'affirmations non vérifiables.
2. Pour les sources de veille (flux RSS), tu ne dois JAMAIS inventer une URL de flux qui semble réelle mais que tu n'es pas certain d'exister. Utilise le champ "feedUrlHint" pour DÉCRIRE ce qu'il faudrait chercher (ex: "flux RSS d'un site d'actualité football francophone"), jamais une URL fabriquée.
3. Le fuseau horaire du projet est ${project.timezone} — les horaires proposés doivent être cohérents avec un usage normal dans ce fuseau.
4. Réponds UNIQUEMENT avec un objet JSON valide respectant exactement cette structure, sans aucun texte avant ou après :
{
  "summary": "résumé en une phrase de ce qui est proposé",
  "messages": [{ "name": "...", "content": "...", "autoEdit": true|false, "editLevel": "LEGERE"|"NORMALE"|"IMPORTANTE", "similarity": 0-100 }],
  "schedules": [{ "messageIndex": 0, "repeatMode": "DAILY"|"CUSTOM_DAYS", "daysOfWeek": [0-6], "times": ["HH:MM"] }],
  "sources": [{ "name": "...", "feedUrlHint": "...", "mode": "AUTO"|"MANUAL", "digestMode": true|false, "checkIntervalMinutes": 60 }]
}
5. Propose entre 1 et 5 messages maximum, et uniquement les schedules/sources pertinents à la demande (tableaux vides si non nécessaire).`;

  const response = await client.chat.completions.create({
    model: env.openaiModel,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: description },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  return JSON.parse(raw) as AssistantPlan;
}
