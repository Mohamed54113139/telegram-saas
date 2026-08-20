import { Request, Response, NextFunction } from "express";

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Ne jamais renvoyer de secrets ou de détails internes sensibles dans les réponses (point 7)
  console.error("[ERROR]", err?.message ?? err);
  const status = err?.status ?? 500;
  res.status(status).json({ error: err?.publicMessage ?? "Erreur interne du serveur." });
}

export class HttpError extends Error {
  status: number;
  publicMessage: string;
  constructor(status: number, publicMessage: string) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}
