import OpenAI from "openai";
import { env } from "../config/env";
import { verifyProtectedVariablesPresent, verifyRequiredElementsPresent } from "./variableService";
import { logEvent } from "./logService";

const client = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

export type EditLevel = "LEGERE" | "NORMALE" | "IMPORTANTE" | "PERSONNALISEE";

export interface RewriteOptions {
  content: string;
  editLevel: EditLevel;
  customInstructions?: string | null;
  similarity: number; // 0 (très différent) - 100 (très proche)
  protectedValues: string[];
  requiredElements: string[];
  preserveEmojis: boolean;
  preservePunctuation: boolean;
  recentVariants?: string[]; // pour l'anti-répétition
}

const LEVEL_INSTRUCTIONS: Record<EditLevel, string> = {
  LEGERE: "Applique des changements très légers : quelques synonymes, ponctuation mineure. Le style et la structure générale doivent rester quasiment identiques.",
  NORMALE: "Reformule modérément : tu peux changer la structure des phrases et le choix des mots, tout en gardant le même sens et le même ton.",
  IMPORTANTE: "Reformule de façon plus importante : tu peux réorganiser les idées, changer significativement la formulation, tout en gardant le message et l'intention identiques.",
  PERSONNALISEE: "Suis strictement les instructions personnalisées fournies par l'utilisateur pour la reformulation.",
};

// Génère une variante du message. Respecte strictement :
// - les variables non modifiables (doivent apparaître verbatim)
// - les éléments obligatoires
// - ne doit JAMAIS inventer de faits, chiffres ou informations non présents dans le contenu fourni
export async function generateRewrite(options: RewriteOptions): Promise<{ text: string; verified: boolean; issues: string[] }> {
  const protectedList = options.protectedValues.map((v) => `- "${v}"`).join("\n") || "(aucune)";
  const requiredList = options.requiredElements.map((v) => `- "${v}"`).join("\n") || "(aucun)";
  const recentList = (options.recentVariants ?? []).slice(0, 20).map((v, i) => `${i + 1}. ${v}`).join("\n");

  const similarityInstruction =
    options.similarity >= 75
      ? "Reste très proche du texte original dans le choix des mots."
      : options.similarity <= 25
      ? "Autorise-toi une formulation très différente du texte original, tant que le sens est conservé."
      : "Trouve un équilibre entre fidélité au texte original et reformulation.";

  const systemPrompt = `Tu es un assistant de réécriture de messages pour une plateforme de publication automatisée.

RÈGLES ABSOLUES (ne jamais enfreindre) :
1. Ne travaille QUE sur le contenu fourni par l'utilisateur. N'invente et n'ajoute AUCUNE information, chiffre, fait, nom, lien ou donnée qui ne soit pas déjà présent dans le texte original.
2. Les éléments suivants doivent apparaître EXACTEMENT tels quels dans ta réponse, sans aucune modification (variables non modifiables) :
${protectedList}
3. Les éléments obligatoires suivants doivent être présents (leur formulation exacte peut être conservée telle quelle) :
${requiredList}
4. ${options.preserveEmojis ? "Conserve les emojis existants tels quels." : "Tu peux modifier ou supprimer les emojis si pertinent."}
5. ${options.preservePunctuation ? "Conserve exactement la ponctuation du texte original." : "Tu peux adapter la ponctuation."}
6. Ne change jamais l'objectif général du message.
7. Réponds UNIQUEMENT avec le texte final du message, sans aucun commentaire, préambule ni guillemets englobants.

Niveau de reformulation demandé : ${LEVEL_INSTRUCTIONS[options.editLevel]}
${options.editLevel === "PERSONNALISEE" && options.customInstructions ? `Instructions personnalisées de l'utilisateur : ${options.customInstructions}` : ""}
${similarityInstruction}
${recentList ? `\nÉvite de produire une variante trop similaire à ces publications récentes :\n${recentList}` : ""}`;

  if (!client) {
    // Pas de clé API configurée : on retourne le contenu original inchangé plutôt que d'échouer silencieusement
    return { text: options.content, verified: true, issues: ["OPENAI_API_KEY non configurée : reformulation ignorée."] };
  }

  const response = await client.chat.completions.create({
    model: env.openaiModel,
    max_tokens: 1000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Texte original à reformuler :\n\n${options.content}` },
    ],
  });

  const generated = response.choices[0]?.message?.content?.trim() ?? options.content;

  const protectedCheck = verifyProtectedVariablesPresent(generated, options.protectedValues);
  const requiredCheck = verifyRequiredElementsPresent(generated, options.requiredElements);
  const issues = [...protectedCheck.missing.map((m) => `Variable non modifiable manquante: "${m}"`), ...requiredCheck.missing.map((m) => `Élément obligatoire manquant: "${m}"`)];

  if (issues.length > 0) {
    await logEvent({ level: "WARN", category: "ai-rewrite", message: "Reformulation rejetée : contraintes non respectées, retour au modèle original.", metadata: { issues } });
    // Sécurité : en cas de non-respect des contraintes, on retombe sur le contenu original plutôt que de publier un texte non conforme (Règle 3)
    return { text: options.content, verified: false, issues };
  }

  return { text: generated, verified: true, issues: [] };
}
