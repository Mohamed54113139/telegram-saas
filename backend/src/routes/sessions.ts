import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";
import { calculateSessionOccurrences } from "../services/sessionCalcService";
import { logEvent } from "../services/logService";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const sessionSchema = z.object({
  name: z.string().min(1),
  messageTemplateId: z.string().uuid(),
  startTime: z.coerce.date(),
  durationMin: z.number().int().positive(),
  intervalMin: z.number().int().positive(),
  beforeMessageTemplateId: z.string().uuid().nullable().optional(),
  beforeMinutesOffset: z.number().int().positive().nullable().optional(),
  afterMessageTemplateId: z.string().uuid().nullable().optional(),
});

// Aperçu / calcul automatique AVANT création (points 38-39) — aucune écriture en base
router.post("/:projectId/sessions/preview", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = sessionSchema.pick({ startTime: true, durationMin: true, intervalMin: true }).parse(req.body);
    const result = calculateSessionOccurrences(data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/:projectId/sessions", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const list = await prisma.session.findMany({
      where: { projectId: req.project.id },
      include: { messageTemplate: { select: { name: true } } },
      orderBy: { startTime: "desc" },
    });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Création d'une session : calcule les horaires ET crée les publications programmées correspondantes
router.post("/:projectId/sessions", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = sessionSchema.parse(req.body);
    const template = await prisma.messageTemplate.findFirst({ where: { id: data.messageTemplateId, projectId: req.project.id } });
    if (!template) return res.status(400).json({ error: "Message modèle invalide pour ce projet." });

    const calc = calculateSessionOccurrences(data);

    const session = await prisma.session.create({ data: { projectId: req.project.id, ...data } });

    await prisma.$transaction(
      calc.occurrences.map((occ, index) =>
        prisma.scheduledPost.create({
          data: {
            projectId: req.project.id,
            messageTemplateId: data.messageTemplateId,
            sessionId: session.id,
            idempotencyKey: `session:${session.id}:${index}`,
            scheduledFor: occ,
            status: "SCHEDULED",
          },
        })
      )
    );

    // Message avant session (point 41)
    if (data.beforeMessageTemplateId && data.beforeMinutesOffset) {
      const beforeTime = new Date(data.startTime.getTime() - data.beforeMinutesOffset * 60_000);
      await prisma.scheduledPost.create({
        data: {
          projectId: req.project.id,
          messageTemplateId: data.beforeMessageTemplateId,
          sessionId: session.id,
          idempotencyKey: `session:${session.id}:before`,
          scheduledFor: beforeTime,
          status: "SCHEDULED",
        },
      });
    }

    // Message après session (point 42)
    if (data.afterMessageTemplateId) {
      await prisma.scheduledPost.create({
        data: {
          projectId: req.project.id,
          messageTemplateId: data.afterMessageTemplateId,
          sessionId: session.id,
          idempotencyKey: `session:${session.id}:after`,
          scheduledFor: calc.endTime,
          status: "SCHEDULED",
        },
      });
    }

    await logEvent({ projectId: req.project.id, category: "session", message: `Session "${session.name}" créée avec ${calc.totalPosts} publication(s).` });

    res.status(201).json({ session, calc });
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/sessions/:id/toggle", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.session.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Session introuvable." });
    const session = await prisma.session.update({ where: { id: existing.id }, data: { active: !existing.active } });

    if (!session.active) {
      await prisma.scheduledPost.updateMany({
        where: { sessionId: session.id, status: "SCHEDULED", scheduledFor: { gte: new Date() } },
        data: { status: "CANCELLED" },
      });
    }
    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId/sessions/:id", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.session.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Session introuvable." });
    await prisma.session.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
