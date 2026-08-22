import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { startScheduler } from "./scheduler/scheduler";

import authRoutes from "./routes/auth";
import projectRoutes from "./routes/projects";
import telegramRoutes from "./routes/telegram";
import messageRoutes from "./routes/messages";
import variableRoutes from "./routes/variables";
import scheduleRoutes from "./routes/schedules";
import sessionRoutes from "./routes/sessions";
import postRoutes from "./routes/posts";
import simulationRoutes from "./routes/simulation";
import sourceRoutes from "./routes/sources";
import assistantRoutes from "./routes/assistant";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origine non autorisée par CORS."));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

// Rate limiting global de protection des API (point 64)
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/projects", telegramRoutes);
app.use("/api/projects", messageRoutes);
app.use("/api/projects", variableRoutes);
app.use("/api/projects", scheduleRoutes);
app.use("/api/projects", sessionRoutes);
app.use("/api/projects", postRoutes);
app.use("/api/projects", simulationRoutes);
app.use("/api/projects", sourceRoutes);
app.use("/api/projects", assistantRoutes);

app.use((req, res) => res.status(404).json({ error: "Route introuvable." }));
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`API démarrée sur le port ${env.port} (${env.nodeEnv})`);
});

// Le scheduler démarre avec le serveur et continue de fonctionner indépendamment
// du frontend/navigateur (points 48, 67, Règle 6).
startScheduler().catch((err) => {
  console.error("Échec du démarrage du scheduler:", err);
});
