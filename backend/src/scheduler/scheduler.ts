import cron from "node-cron";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { generateMessageContent } from "../services/contentGenerationService";
import { decryptSecret } from "../utils/crypto";
import { sendTelegramMessage, sendTelegramPhoto, copyTelegramMessage } from "../services/telegramService";
import { materializeAllActiveSchedules, materializeAllActiveRecurringSessions } from "../services/scheduleMaterializationService";
import { checkAllActiveSources } from "../services/feedWatcherService";
import { checkDailyMatchResultsRecap } from "../services/matchResultService";
import { logEvent } from "../services/logService";

const MAX_ATTEMPTS = 3;
const STUCK_PROCESSING_MINUTES = 5;

let running = false; // évite les exécutions concurrentes du même tick

// Réclame de façon atomique un lot de publications dues, pour agir comme une file d'attente
// simple sans double-traitement (points 47, 53, Règle 8).
async function claimDuePosts(limit = 20) {
  const now = new Date();
  const due = await prisma.scheduledPost.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: now }, isSimulation: false },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  const claimed = [];
  for (const post of due) {
    // updateMany avec condition sur le statut actuel = verrouillage optimiste
    const result = await prisma.scheduledPost.updateMany({
      where: { id: post.id, status: "SCHEDULED" },
      data: { status: "PROCESSING" },
    });
    if (result.count === 1) claimed.push(post.id);
  }
  return claimed;
}

async function processPost(postId: string) {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: postId },
    include: { messageTemplate: true, project: true },
  });
  if (!post) return;

  try {
    const channel = await prisma.telegramChannel.findUnique({ where: { projectId: post.projectId } });
    if (!channel || channel.status !== "CONNECTED") {
      throw new Error("Canal Telegram non connecté.");
    }

    const botToken = decryptSecret(channel.botTokenEncrypted);

    if (post.messageTemplate.sourceChatId && post.messageTemplate.sourceMessageId) {
      if (!post.messageTemplate.originalContent) {
        const result = await copyTelegramMessage(botToken, post.messageTemplate.sourceChatId, channel.chatId, post.messageTemplate.sourceMessageId);

        // Écrit PUBLISHED + le message_id immédiatement après la réponse
        // réussie de Telegram, pour réduire au minimum la fenêtre pendant
        // laquelle un crash laisserait un envoi réel non enregistré en base.
        await prisma.scheduledPost.update({
          where: { id: post.id },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            generatedContent: "[Publication copiée depuis Telegram]",
            telegramMessageId: result.message_id,
            attempts: { increment: 1 },
          },
        });

        await logEvent({ projectId: post.projectId, category: "publication", message: "Publication (copie) envoyée avec succès.", metadata: { postId: post.id, telegramMessageId: result.message_id } });
        return;
      }

      const generated = await generateMessageContent(post.messageTemplate, post.project);
      const result = await copyTelegramMessage(botToken, post.messageTemplate.sourceChatId, channel.chatId, post.messageTemplate.sourceMessageId, generated.generatedContent);

      await prisma.scheduledPost.update({
        where: { id: post.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          generatedContent: generated.generatedContent,
          variablesUsed: generated.usedVariables as any,
          telegramMessageId: result.message_id,
          attempts: { increment: 1 },
        },
      });

      await logEvent({ projectId: post.projectId, category: "publication", message: "Publication (copie avec légende reformulée) envoyée avec succès.", metadata: { postId: post.id, telegramMessageId: result.message_id } });
      return;
    }

    const generated = await generateMessageContent(post.messageTemplate, post.project);
    const result = post.messageTemplate.imageUrl
      ? await sendTelegramPhoto(botToken, channel.chatId, post.messageTemplate.imageUrl, generated.generatedContent)
      : await sendTelegramMessage(botToken, channel.chatId, generated.generatedContent);

    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        generatedContent: generated.generatedContent,
        variablesUsed: generated.usedVariables as any,
        telegramMessageId: result.message_id,
        attempts: { increment: 1 },
      },
    });

    await logEvent({ projectId: post.projectId, category: "publication", message: "Publication envoyée avec succès.", metadata: { postId: post.id, telegramMessageId: result.message_id } });
  } catch (err: any) {
    const attempts = post.attempts + 1;
    const shouldRetry = attempts < MAX_ATTEMPTS;

    await prisma.scheduledPost.update({
      where: { id: post.id },
      data: {
        status: shouldRetry ? "SCHEDULED" : "FAILED",
        attempts,
        lastError: err?.message ?? "Erreur inconnue.",
      },
    });

    await logEvent({
      projectId: post.projectId,
      level: "ERROR",
      category: "publication",
      message: shouldRetry ? "Échec de publication, nouvelle tentative prévue." : "Échec définitif de publication.",
      metadata: { postId: post.id, attempts, error: err?.message },
    });
  }
}

// Reprise après redémarrage du serveur (points 48-49) :
// - les publications déjà PUBLISHED ne sont jamais rejouées (elles gardent leur statut)
// - les publications restées bloquées en PROCESSING (ex: crash serveur en plein envoi) ne
//   sont PAS remises automatiquement en file : on ne peut pas savoir avec certitude si
//   l'envoi Telegram a déjà eu lieu avant l'interruption (le message pourrait avoir été
//   réellement délivré juste avant le crash, sans que le PUBLISHED correspondant ait pu
//   être écrit en base). On les marque donc FAILED, pour vérification manuelle, plutôt
//   que de risquer un double envoi automatique.
async function recoverStuckPosts() {
  const threshold = new Date(Date.now() - STUCK_PROCESSING_MINUTES * 60_000);
  const stuck = await prisma.scheduledPost.findMany({
    where: { status: "PROCESSING", updatedAt: { lte: threshold } },
    select: { id: true },
  });
  if (stuck.length === 0) return;

  await prisma.scheduledPost.updateMany({
    where: { id: { in: stuck.map((p) => p.id) } },
    data: {
      status: "FAILED",
      lastError: "Statut incertain après interruption (redémarrage/crash pendant l'envoi) : vérifier manuellement si le message a été publié.",
    },
  });

  await logEvent({
    level: "WARN",
    category: "scheduler",
    message: `${stuck.length} publication(s) bloquée(s) marquée(s) en échec pour vérification manuelle (statut incertain après interruption).`,
    metadata: { postIds: stuck.map((p) => p.id) },
  });
}

async function tick() {
  if (running) return; // empêche le chevauchement de deux exécutions
  running = true;
  try {
    await materializeAllActiveSchedules();
    await materializeAllActiveRecurringSessions();
    await checkAllActiveSources();
    const claimed = await claimDuePosts();
    for (const id of claimed) {
      await processPost(id);
    }
  } catch (err: any) {
    await logEvent({ level: "ERROR", category: "scheduler", message: "Erreur durant le cycle du scheduler.", metadata: { error: err?.message } });
  } finally {
    running = false;
  }
}

export async function startScheduler() {
  await logEvent({ category: "scheduler", message: "Démarrage du scheduler côté serveur." });

  // Étape de reprise après redémarrage (point 49)
  await recoverStuckPosts();
  await materializeAllActiveSchedules();
  await tick();

  // Exécution périodique (persistante côté serveur, indépendante du navigateur — point 67)
  const seconds = Math.max(10, env.schedulerIntervalSeconds);
  cron.schedule(`*/${seconds} * * * * *`, () => {
    tick().catch((e) => console.error("Erreur scheduler:", e));
  });

  // Suivi des résultats après-match : job séparé (indépendant du tick
  // principal), vérifié toutes les 15 min pour détecter l'heure locale du
  // récapitulatif quotidien (23h30) de chaque projet, voir matchResultService.ts.
  cron.schedule("*/15 * * * *", () => {
    checkDailyMatchResultsRecap().catch((e) => console.error("Erreur récapitulatif des résultats:", e));
  });
}
