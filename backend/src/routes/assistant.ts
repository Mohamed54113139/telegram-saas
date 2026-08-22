import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";
import { proposeConfiguration, AssistantPlan } from "../services/assistantService";
import { materializeSchedule } from "../services/scheduleMaterializationService";

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.post("/:projectId/assistant/propose", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const { description } = z.object({ description: z.string().min(5) }).parse(req.body);
    const plan = await proposeConfiguration(description, req.project);
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// Rien n'est créé tant que cette route n'est pas appelée explicitement par l'utilisateur,
// avec le plan qu'il a potentiellement modifié depuis la proposition initiale.
router.post("/:projectId/assistant/apply", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const plan = req.body.plan as AssistantPlan;
    const createdMessageIds: string[] = [];

    for (const m of plan.messages) {
      const template = await prisma.messageTemplate.create({
        data: { projectId: req.project.id, name: m.name, originalContent: m.content, autoEdit: m.autoEdit, editLevel: m.editLevel, similarity: m.similarity },
      });
      createdMessageIds.push(template.id);
    }

    for (const s of plan.schedules) {
      const messageTemplateId = createdMessageIds[s.messageIndex];
      if (!messageTemplateId) continue;
      const schedule = await prisma.schedule.create({
        data: { projectId: req.project.id, messageTemplateId, repeatMode: s.repeatMode, daysOfWeek: s.daysOfWeek, times: s.times },
      });
      await materializeSchedule(schedule, req.project);
    }

    for (const src of plan.sources) {
      if (!src.feedUrlHint || !src.feedUrlHint.startsWith("http")) continue; // ignore si l'utilisateur n'a pas encore renseigné une vraie URL
      await prisma.contentSource.create({
        data: { projectId: req.project.id, name: src.name, feedUrl: src.feedUrlHint, mode: src.mode, digestMode: src.digestMode },
      });
    }

    res.json({ success: true, messagesCreated: createdMessageIds.length, schedulesCreated: plan.schedules.length });
  } catch (err) {
    next(err);
  }
});

export default router;
