import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";
import { generateMessageContent } from "../services/contentGenerationService";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// Mode simulation (point 62) : calcule tout (horaires, contenu généré, variables, sessions)
// SANS envoyer aucune publication réelle sur Telegram.
router.post("/:projectId/simulate", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const from = new Date();
    const to = new Date(Date.now() + 7 * 24 * 3600 * 1000);

    const upcoming = await prisma.scheduledPost.findMany({
      where: { projectId: req.project.id, status: "SCHEDULED", scheduledFor: { gte: from, lte: to } },
      include: { messageTemplate: true },
      orderBy: { scheduledFor: "asc" },
      take: 100,
    });

    const results = [];
    for (const post of upcoming) {
      const generated = await generateMessageContent(post.messageTemplate, req.project);
      results.push({
        scheduledFor: post.scheduledFor,
        messageTemplate: post.messageTemplate.name,
        originalContent: generated.originalContent,
        generatedContent: generated.generatedContent,
        usedVariables: generated.usedVariables,
        wasRewritten: generated.wasRewritten,
      });
    }

    res.json({ totalSimulated: results.length, window: { from, to }, results });
  } catch (err) {
    next(err);
  }
});

// Validation avant activation (point 63)
router.get("/:projectId/validate", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const projectId = req.project.id;
    const issues: string[] = [];

    const channel = await prisma.telegramChannel.findUnique({ where: { projectId } });
    if (!channel || channel.status !== "CONNECTED") issues.push("Aucun canal Telegram connecté ou valide.");

    const messages = await prisma.messageTemplate.count({ where: { projectId, active: true } });
    if (messages === 0) issues.push("Aucun message modèle actif.");

    const schedules = await prisma.schedule.count({ where: { projectId, active: true } });
    const sessions = await prisma.session.count({ where: { projectId, active: true } });
    if (schedules === 0 && sessions === 0) issues.push("Aucune programmation ni session active.");

    const invalidSessions = await prisma.session.findMany({
      where: { projectId, active: true, OR: [{ durationMin: { lte: 0 } }, { intervalMin: { lte: 0 } }] },
    });
    if (invalidSessions.length > 0) issues.push("Certaines sessions ont une durée ou un intervalle invalide.");

    res.json({ valid: issues.length === 0, issues });
  } catch (err) {
    next(err);
  }
});

export default router;
