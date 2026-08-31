import dotenv from "dotenv";
dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "4000", 10),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  encryptionKey: required("ENCRYPTION_KEY"), // 32 caractères, pour chiffrer les tokens Telegram
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  imgbbApiKey: process.env.IMGBB_API_KEY ?? "",
  apiFootballKey: process.env.API_FOOTBALL_KEY ?? "",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim()).filter(Boolean),
  schedulerIntervalSeconds: parseInt(process.env.SCHEDULER_INTERVAL_SECONDS ?? "30", 10),
};
