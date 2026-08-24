import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";
import { generateMessageContent } from "../services/contentGenerationService";
import { decryptSecret } from "../utils/crypto";
import { sendTelegramMessage, sendTelegramPhoto, copyTelegramMessage } from "../services/telegramService";
import { parseTelegramPostUrl } from "../utils/telegramLink";
import { HttpError } from "../middleware/errorHandler";
import { uploadImageToImgbb } from "../services/imgbbService";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// Upload d'une image (base64) vers ImgBB, retourne le lien direct à utiliser comme imageUrl.
router.post("/:projectId/upload-image", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "Image manquante." });
    }
    const url = await uploadImageToImgbb(imageBase64);
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

const templateSchema = z.object({
  name: z.string().min(1),
  originalContent: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),
  autoEdit: z.boolean().default(false),
  editLevel: z.enum(["LEGERE", "NORMALE", "IMPORTANTE", "PERSONNALISEE"]).default("NORMALE"),
  customInstructions: z.string().nullable().optional(),
  similarity: z.number().min(0).max(100).default(50),
  preserveEmojis: z.boolean().default(true),
  preservePunctuation: z.boolean().default(false),
  requiredElements: z.array(z.string()).default([]),
  signatureOverride: z.string().nullable().optional(),
  signatureEnabledOverride: z.boolean().nullable().optional(),
  randomMinMinutes: z.number().int().nullable().optional(),
  randomMaxMinutes: z.number().int().nullable().optional(),
});

// Liste des messages modèles d'un projet (point 9)
router.get("/:projectId/messages", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const messages = await prisma.messageTemplate.findMany({
      where: { projectId: req.project.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// Création d'un message modèle — le contenu original est conservé tel quel (Règle 1)
router.post("/:projectId/messages", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = templateSchema.parse(req.body);
    const message = await prisma.messageTemplate.create({
      data: { projectId: req.project.id, ...data },
    });
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

const fromLinkSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  currentCaption: z.string().optional(),
});

// Création d'un message "copie" d'une publication Telegram existante, via son lien
router.post("/:projectId/messages/from-link", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const { name, url, currentCaption } = fromLinkSchema.parse(req.body);
    const parsed = parseTelegramPostUrl(url);
    if (!parsed) return res.status(400).json({ error: "Lien Telegram invalide." });

    const message = await prisma.messageTemplate.create({
      data: {
        projectId: req.project.id,
        name,
        originalContent: currentCaption ?? "",
        sourceChatId: parsed.chatId,
        sourceMessageId: parsed.messageId,
        autoEdit: false,
      },
    });
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

router.get("/:projectId/messages/:messageId", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const message = await prisma.messageTemplate.findFirst({
      where: { id: req.params.messageId, projectId: req.project.id },
    });
    if (!message) return res.status(404).json({ error: "Message introuvable." });
    res.json(message);
  } catch (err) {
    next(err);
  }
});

router.patch("/:projectId/messages/:messageId", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = templateSchema.partial().parse(req.body);
    const existing = await prisma.messageTemplate.findFirst({ where: { id: req.params.messageId, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Message introuvable." });

    // Le modèle original ne doit jamais être modifié "automatiquement" par le système,
    // mais l'utilisateur reste libre d'éditer son propre modèle explicitement ici (Règle 1 = pas de modif AUTOMATIQUE).
    const message = await prisma.messageTemplate.update({ where: { id: existing.id }, data });
    res.json(message);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId/messages/:messageId", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.messageTemplate.findFirst({ where: { id: req.params.messageId, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Message introuvable." });
    await prisma.messageTemplate.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Aperçu / test : génère une variante SANS publier (points 28-29)
router.post("/:projectId/messages/:messageId/preview", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const template = await prisma.messageTemplate.findFirst({ where: { id: req.params.messageId, projectId: req.project.id } });
    if (!template) return res.status(404).json({ error: "Message introuvable." });

    const result = await generateMessageContent(template, req.project, req.body?.overrides);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Envoi réel d'un message de test sur le canal connecté, hors programmation (point 29)
router.post("/:projectId/messages/:messageId/send-test", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const template = await prisma.messageTemplate.findFirst({ where: { id: req.params.messageId, projectId: req.project.id } });
    if (!template) return res.status(404).json({ error: "Message introuvable." });

    const channel = await prisma.telegramChannel.findUnique({ where: { projectId: req.project.id } });
    if (!channel || channel.status !== "CONNECTED") {
      throw new HttpError(400, "Aucun canal Telegram connecté.");
    }

    const botToken = decryptSecret(channel.botTokenEncrypted);

    if (template.sourceChatId && template.sourceMessageId) {
      if (!template.originalContent) {
        const result = await copyTelegramMessage(botToken, template.sourceChatId, channel.chatId, template.sourceMessageId);
        return res.json({ success: true, messageId: result.message_id, content: "[Publication copiée depuis Telegram]" });
      }

      const generated = await generateMessageContent(template, req.project);
      const result = await copyTelegramMessage(botToken, template.sourceChatId, channel.chatId, template.sourceMessageId, generated.generatedContent);
      return res.json({ success: true, messageId: result.message_id, content: generated.generatedContent });
    }

    const generated = await generateMessageContent(template, req.project, req.body?.overrides);
    const result = template.imageUrl
      ? await sendTelegramPhoto(botToken, channel.chatId, template.imageUrl, generated.generatedContent)
      : await sendTelegramMessage(botToken, channel.chatId, generated.generatedContent);

    res.json({ success: true, messageId: result.message_id, content: generated.generatedContent });
  } catch (err) {
    next(err);
  }
});

export default router;
