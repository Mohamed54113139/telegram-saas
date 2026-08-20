import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { signToken } from "../utils/jwt";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { logEvent } from "../services/logService";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
  name: z.string().optional(),
});

router.post("/register", async (req, res, next) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Un compte existe déjà avec cet email." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, passwordHash, name } });

    const token = signToken({ userId: user.id, email: user.email });
    await logEvent({ category: "auth", message: "Nouveau compte créé.", metadata: { userId: user.id } });

    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Email ou mot de passe incorrect." });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Email ou mot de passe incorrect." });
    }
    const token = signToken({ userId: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
    res.json({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
});

router.patch("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.userId }, data });
    res.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    next(err);
  }
});

const passwordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

router.post("/me/password", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { currentPassword, newPassword } = passwordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Mot de passe actuel incorrect." });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await prisma.user.delete({ where: { id: req.userId } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
