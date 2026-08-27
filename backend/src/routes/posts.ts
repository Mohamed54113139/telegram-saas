import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requireProjectOwnership } from "../middleware/projectAccess";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// Planning visuel (point 43) : toutes les publications futures, tous statuts confondus
router.get("/:projectId/planning", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date();
    const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 30 * 24 * 3600 * 1000);

    const posts = await prisma.scheduledPost.findMany({
      where: { projectId: req.project.id, scheduledFor: { gte: from, lte: to }, isSimulation: false },
      include: { messageTemplate: { select: { name: true } }, session: { select: { name: true } } },
      orderBy: { scheduledFor: "asc" },
    });
    res.json(posts);
  } catch (err) {
    next(err);
  }
});

// Historique (points 51-52)
router.get("/:projectId/history", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const posts = await prisma.scheduledPost.findMany({
      where: {
        projectId: req.project.id,
        isSimulation: false,
        ...(status ? { status: status as any } : { status: { in: ["PUBLISHED", "FAILED", "CANCELLED"] } }),
      },
      include: { messageTemplate: { select: { name: true } }, session: { select: { name: true } } },
      orderBy: { scheduledFor: "desc" },
      take: 200,
    });
    res.json(posts);
  } catch (err) {
    next(err);
  }
});

router.get("/:projectId/history/:postId", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.postId, projectId: req.project.id },
      include: { messageTemplate: true, session: true, schedule: true },
    });
    if (!post) return res.status(404).json({ error: "Publication introuvable." });
    res.json(post);
  } catch (err) {
    next(err);
  }
});

// Annulation d'une publication future (point 46)
router.post("/:projectId/posts/:postId/cancel", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const post = await prisma.scheduledPost.findFirst({ where: { id: req.params.postId, projectId: req.project.id } });
    if (!post) return res.status(404).json({ error: "Publication introuvable." });
    if (post.status !== "SCHEDULED") {
      return res.status(400).json({ error: "Seule une publication programmée peut être annulée." });
    }
    const updated = await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: "CANCELLED" } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

const bulkCancelSchema = z.object({
  postIds: z.array(z.string().uuid()).min(1),
});

// Annulation groupée depuis le Planning (sélection multiple) — même contrainte
// que l'annulation individuelle : seules les publications encore SCHEDULED
// sont annulées, les autres ids fournis sont simplement ignorés.
router.post("/:projectId/posts/bulk-cancel", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const { postIds } = bulkCancelSchema.parse(req.body);
    const result = await prisma.scheduledPost.updateMany({
      where: { id: { in: postIds }, projectId: req.project.id, status: "SCHEDULED" },
      data: { status: "CANCELLED" },
    });
    res.json({ cancelled: result.count });
  } catch (err) {
    next(err);
  }
});

// Suppression définitive d'une publication annulée. Restreint à CANCELLED :
// une publication active (SCHEDULED), en cours d'envoi (PROCESSING) ou déjà
// envoyée (PUBLISHED)/échouée (FAILED) ne doit jamais pouvoir être supprimée
// par erreur — seule une annulation explicite permet de la rendre supprimable.
router.delete("/:projectId/posts/:postId", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const post = await prisma.scheduledPost.findFirst({ where: { id: req.params.postId, projectId: req.project.id } });
    if (!post) return res.status(404).json({ error: "Publication introuvable." });
    if (post.status !== "CANCELLED") {
      return res.status(400).json({ error: "Seule une publication annulée peut être supprimée définitivement." });
    }
    await prisma.scheduledPost.delete({ where: { id: post.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const bulkDeleteSchema = z.object({
  postIds: z.array(z.string().uuid()).min(1),
});

// Suppression groupée depuis le Planning — même contrainte que la suppression
// individuelle : le filtre status: "CANCELLED" est appliqué directement dans
// la requête, donc tout id fourni qui ne serait pas CANCELLED est simplement
// ignoré plutôt que supprimé.
router.post("/:projectId/posts/bulk-delete", requireProjectOwnership, async (req: AuthRequest & any, res, next) => {
  try {
    const { postIds } = bulkDeleteSchema.parse(req.body);
    const result = await prisma.scheduledPost.deleteMany({
      where: { id: { in: postIds }, projectId: req.project.id, status: "CANCELLED" },
    });
    res.json({ deleted: result.count });
  } catch (err) {
    next(err);
  }
});

export default router;
