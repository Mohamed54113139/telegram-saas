import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";
import { generateInstructionSuggestion } from "../services/suggestionService";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const feedbackSchema = z.object({
  feedback: z.enum(["POSITIVE", "NEGATIVE"]),
});

// Retour 👍/👎 de l'utilisateur sur une publication déjà envoyée
router.post("/:projectId/posts/:postId/feedback", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const { feedback } = feedbackSchema.parse(req.body);
    const post = await prisma.scheduledPost.findFirst({ where: { id: req.params.postId, projectId: req.project.id } });
    if (!post) return res.status(404).json({ error: "Publication introuvable." });

    const updated = await prisma.scheduledPost.update({ where: { id: post.id }, data: { feedback } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Analyse les retours accumulés sur un message et propose une amélioration des instructions (jamais appliquée automatiquement)
router.post("/:projectId/messages/:messageId/suggest-improvement", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const suggestion = await generateInstructionSuggestion(req.params.messageId, req.project.id);
    res.json(suggestion);
  } catch (err) {
    next(err);
  }
});

// Liste des suggestions en attente de validation manuelle
router.get("/:projectId/suggestions", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const suggestions = await prisma.instructionSuggestion.findMany({
      where: { projectId: req.project.id, status: "PENDING" },
      include: { messageTemplate: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(suggestions);
  } catch (err) {
    next(err);
  }
});

// Approbation manuelle : applique la suggestion au message modèle
router.post("/:projectId/suggestions/:id/approve", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const suggestion = await prisma.instructionSuggestion.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!suggestion) return res.status(404).json({ error: "Suggestion introuvable." });

    await prisma.messageTemplate.update({
      where: { id: suggestion.messageTemplateId },
      data: { customInstructions: suggestion.suggestedInstructions, editLevel: "PERSONNALISEE" },
    });
    const updated = await prisma.instructionSuggestion.update({ where: { id: suggestion.id }, data: { status: "APPROVED" } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Rejet manuel : la suggestion reste enregistrée mais n'est pas appliquée
router.post("/:projectId/suggestions/:id/reject", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const suggestion = await prisma.instructionSuggestion.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!suggestion) return res.status(404).json({ error: "Suggestion introuvable." });

    const updated = await prisma.instructionSuggestion.update({ where: { id: suggestion.id }, data: { status: "REJECTED" } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
