import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";
import { checkSource } from "../services/feedWatcherService";

const router = Router({ mergeParams: true });
router.use(requireAuth);

const sourceSchema = z.object({
  name: z.string().min(1),
  feedUrl: z.string().url(),
  mode: z.enum(["AUTO", "MANUAL"]).default("MANUAL"),
  digestMode: z.boolean().default(false),
});

// Liste des sources de veille d'un projet
router.get("/:projectId/sources", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const sources = await prisma.contentSource.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "desc" } });
    res.json(sources);
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/sources", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = sourceSchema.parse(req.body);
    const source = await prisma.contentSource.create({ data: { projectId: req.project.id, ...data } });
    res.status(201).json(source);
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/sources/:id/toggle", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.contentSource.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Source introuvable." });
    const source = await prisma.contentSource.update({ where: { id: existing.id }, data: { active: !existing.active } });
    res.json(source);
  } catch (err) {
    next(err);
  }
});

// Déclenche une vérification immédiate de la source (hors cycle périodique du scheduler)
router.post("/:projectId/sources/:id/check", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.contentSource.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Source introuvable." });
    await checkSource(existing);
    const updated = await prisma.contentSource.findUnique({ where: { id: existing.id } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId/sources/:id", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.contentSource.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Source introuvable." });
    await prisma.contentSource.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
