import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().default("UTC"),
});

// Liste des projets de l'utilisateur (point 4)
router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      where: { userId: req.userId },
      include: { telegramChannel: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// Création d'un projet (point 5) — plateforme fixée à TELEGRAM pour le moment
router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const project = await prisma.project.create({
      data: { userId: req.userId!, name: data.name, timezone: data.timezone, platform: "TELEGRAM" },
    });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.get("/:projectId", requireProjectOwnership, async (req: AuthRequest & any, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.project.id },
    include: { telegramChannel: true },
  });
  res.json(project);
});

const updateSchema = z.object({
  name: z.string().optional(),
  timezone: z.string().optional(),
  autoEditDefault: z.boolean().optional(),
  editLevelDefault: z.enum(["LEGERE", "NORMALE", "IMPORTANTE", "PERSONNALISEE"]).optional(),
  similarityDefault: z.number().min(0).max(100).optional(),
  preserveEmojisDefault: z.boolean().optional(),
  preservePunctuationDefault: z.boolean().optional(),
  signature: z.string().nullable().optional(),
  signatureEnabled: z.boolean().optional(),
  antiRepetitionEnabled: z.boolean().optional(),
  antiRepetitionWindow: z.number().int().positive().optional(),
  adminNotifyChatId: z.string().nullable().optional(),
});

router.patch("/:projectId", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const project = await prisma.project.update({ where: { id: req.project.id }, data });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    await prisma.project.delete({ where: { id: req.project.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Tableau de bord d'un projet (point 8)
router.get("/:projectId/dashboard", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const projectId = req.project.id;
    const now = new Date();

    const [telegramChannel, nextPost, nextSession, scheduledCount, publishedCount, failedCount] = await Promise.all([
      prisma.telegramChannel.findUnique({ where: { projectId } }),
      prisma.scheduledPost.findFirst({
        where: { projectId, status: "SCHEDULED", scheduledFor: { gte: now } },
        orderBy: { scheduledFor: "asc" },
        include: { messageTemplate: { select: { name: true } } },
      }),
      prisma.session.findFirst({
        where: { projectId, active: true, startTime: { gte: now } },
        orderBy: { startTime: "asc" },
      }),
      prisma.scheduledPost.count({ where: { projectId, status: "SCHEDULED" } }),
      prisma.scheduledPost.count({ where: { projectId, status: "PUBLISHED" } }),
      prisma.scheduledPost.count({ where: { projectId, status: "FAILED" } }),
    ]);

    res.json({
      project: { id: req.project.id, name: req.project.name },
      telegramStatus: telegramChannel?.status ?? "DISCONNECTED",
      channelTitle: telegramChannel?.chatTitle ?? null,
      nextPost,
      nextSession,
      scheduledCount,
      publishedCount,
      failedCount,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
