import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// ---- Variables non modifiables (points 15-16, 21) ----

const protectedSchema = z.object({
  value: z.string().min(1),
  label: z.string().optional(),
  isLink: z.boolean().default(false),
});

router.get("/:projectId/protected-variables", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const list = await prisma.protectedVariable.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "desc" } });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/protected-variables", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = protectedSchema.parse(req.body);
    const created = await prisma.protectedVariable.create({ data: { projectId: req.project.id, ...data } });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId/protected-variables/:id", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.protectedVariable.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Variable introuvable." });
    await prisma.protectedVariable.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---- Variables modifiables (points 17-19) ----

const variableSchema = z.object({
  key: z.string().min(1).regex(/^[A-Za-z0-9_]+$/, "La clé ne doit contenir que des lettres, chiffres et underscores."),
  type: z.enum(["TEXT", "NUMBER", "DATE", "TIME", "DAY"]).default("TEXT"),
  possibleValues: z.array(z.string()).default([]),
  numberMin: z.number().optional(),
  numberMax: z.number().optional(),
  preferredMin: z.number().optional(),
  preferredMax: z.number().optional(),
});

router.get("/:projectId/variables", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const list = await prisma.messageVariable.findMany({ where: { projectId: req.project.id }, orderBy: { createdAt: "desc" } });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/variables", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = variableSchema.parse(req.body);
    if (data.type === "NUMBER" && (data.numberMin === undefined || data.numberMax === undefined)) {
      return res.status(400).json({ error: "Minimum et maximum requis pour une variable numérique." });
    }
    const created = await prisma.messageVariable.create({ data: { projectId: req.project.id, ...data } });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "P2002") return res.status(409).json({ error: "Cette clé de variable existe déjà pour ce projet." });
    next(err);
  }
});

router.patch("/:projectId/variables/:id", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = variableSchema.partial().parse(req.body);
    const existing = await prisma.messageVariable.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Variable introuvable." });
    const updated = await prisma.messageVariable.update({ where: { id: existing.id }, data });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId/variables/:id", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const existing = await prisma.messageVariable.findFirst({ where: { id: req.params.id, projectId: req.project.id } });
    if (!existing) return res.status(404).json({ error: "Variable introuvable." });
    await prisma.messageVariable.delete({ where: { id: existing.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
