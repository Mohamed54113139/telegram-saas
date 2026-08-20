import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";
import { encryptSecret, decryptSecret } from "../utils/crypto";
import { verifyBot, verifyChat, verifyBotIsAdmin, sendTelegramMessage } from "../services/telegramService";
import { logEvent } from "../services/logService";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const connectSchema = z.object({
  botToken: z.string().min(10),
  chatId: z.string().min(1),
});

// Connexion d'un canal Telegram à un projet (point 6)
router.post("/:projectId/telegram/connect", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const { botToken, chatId } = connectSchema.parse(req.body);

    const me = await verifyBot(botToken);
    const chat = await verifyChat(botToken, chatId);
    const isAdmin = await verifyBotIsAdmin(botToken, chatId, me.id);

    if (!isAdmin) {
      await logEvent({ projectId: req.project.id, level: "WARN", category: "telegram", message: "Le bot n'a pas les permissions nécessaires sur le canal." });
      return res.status(400).json({ error: "Le bot doit être administrateur du canal avec le droit de publier des messages." });
    }

    const channel = await prisma.telegramChannel.upsert({
      where: { projectId: req.project.id },
      create: {
        projectId: req.project.id,
        botTokenEncrypted: encryptSecret(botToken),
        chatId,
        chatTitle: chat.title ?? null,
        botUsername: me.username,
        status: "CONNECTED",
        lastCheckedAt: new Date(),
        lastError: null,
      },
      update: {
        botTokenEncrypted: encryptSecret(botToken),
        chatId,
        chatTitle: chat.title ?? null,
        botUsername: me.username,
        status: "CONNECTED",
        lastCheckedAt: new Date(),
        lastError: null,
      },
    });

    await logEvent({ projectId: req.project.id, category: "telegram", message: "Canal Telegram connecté.", metadata: { chatTitle: chat.title } });

    // Le token chiffré n'est jamais renvoyé au frontend (point 7)
    res.json({ id: channel.id, status: channel.status, chatId: channel.chatId, chatTitle: channel.chatTitle, botUsername: channel.botUsername });
  } catch (err: any) {
    await logEvent({ projectId: req.project.id, level: "ERROR", category: "telegram", message: "Échec de connexion Telegram.", metadata: { error: err?.publicMessage ?? err?.message } });
    next(err);
  }
});

router.get("/:projectId/telegram/status", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const channel = await prisma.telegramChannel.findUnique({ where: { projectId: req.project.id } });
    if (!channel) return res.json({ status: "DISCONNECTED" });
    res.json({
      status: channel.status,
      chatId: channel.chatId,
      chatTitle: channel.chatTitle,
      botUsername: channel.botUsername,
      lastCheckedAt: channel.lastCheckedAt,
      lastError: channel.lastError,
    });
  } catch (err) {
    next(err);
  }
});

// Envoi d'un message de test (point 29)
router.post("/:projectId/telegram/test", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const channel = await prisma.telegramChannel.findUnique({ where: { projectId: req.project.id } });
    if (!channel) return res.status(400).json({ error: "Aucun canal Telegram connecté." });

    const botToken = decryptSecret(channel.botTokenEncrypted);
    const text = req.body?.text ?? "✅ Message de test envoyé depuis votre plateforme d'automatisation.";
    const result = await sendTelegramMessage(botToken, channel.chatId, text);

    res.json({ success: true, messageId: result.message_id });
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId/telegram", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    await prisma.telegramChannel.deleteMany({ where: { projectId: req.project.id } });
    await logEvent({ projectId: req.project.id, category: "telegram", message: "Canal Telegram déconnecté." });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
