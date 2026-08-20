import { Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { AuthRequest } from "./auth";

// Vérifie que le projet demandé appartient bien à l'utilisateur connecté (points 65 / isolation des projets).
// Attache le projet vérifié à req.project pour éviter une seconde requête dans le handler.
export async function requireProjectOwnership(req: AuthRequest & { project?: any }, res: Response, next: NextFunction) {
  const projectId = req.params.projectId;
  if (!projectId) {
    return res.status(400).json({ error: "projectId manquant." });
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: req.userId },
  });
  if (!project) {
    return res.status(404).json({ error: "Projet introuvable." });
  }
  req.project = project;
  next();
}
