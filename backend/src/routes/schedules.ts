import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";
import { materializeSchedule } from "../services/scheduleMaterializationService";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const scheduleSchema = z.object({
  messageTemplateId: z.string().uuid(),
  repeatMode: z.enum(["ONCE", "DAILY", "CUSTOM_DAYS", "CUSTOM_DATES"]),
  daysOfWeek: z.array(z.number().min(0).max(6)).default([]),
  specificDates: z.array(z.coerce.date()).default([]),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// Programmation par date / jour / heure (points 30-34)
router.get("/:projectId/schedules", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const list = await prisma.schedule.findMany({ where: { projectId: req.project.id }, include: { messageTemplate: { select: { name: true } } }, orderBy: { createdAt: "desc" } });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/schedules", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = scheduleSchema.parse(req.body);
    const template = await prisma.messageTemplate.findFirst({ where: { id: data.messageTemplateId, projectId: req.project.id } });
    if (!template) return res.status(400).json({ error: "Message modèle invalide pour ce projet." });

    const schedule = await prisma.schedule.create({ data: { projectId: req.project.id, ...data } });

    // Matérialise immédiatement les prochaines occurrences (point 44 : recalcul automatique)
    const created = await materializeSchedule(schedule, req.project);

    res.status(201).json({ schedule, postsCreated: created });
  } catch (err) {
    next(err);
  }
});

router.patch("/:projectId/schedules/:id", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = scheduleSchema.partial().parse(req.body);
    const existing = await prisma.schedule.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Programmation introuvable." });

    const schedule = await prisma.schedule.update({ where: { id: existing.id }, data });

    // Les publications futures non encore envoyées sont annulées puis recalculées (point 44)
    await prisma.scheduledPost.updateMany({
      where: { scheduleId: schedule.id, status: "SCHEDULED", scheduledFor: { gte: new Date() } },
      data: { status: "CANCELLED" },
    });
    const created = await materializeSchedule(schedule, req.project);

    res.json({ schedule, postsCreated: created });
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/schedules/:id/toggle", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.schedule.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Programmation introuvable." });
    // Désactiver ne supprime pas l'historique (point 45)
    const schedule = await prisma.schedule.update({ where: { id: existing.id }, data: { active: !existing.active } });
    res.json(schedule);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId/schedules/:id", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.schedule.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Programmation introuvable." });
    await prisma.schedule.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
