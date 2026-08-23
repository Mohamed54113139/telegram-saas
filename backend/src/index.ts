import { app } from "./app";
import { env } from "./config/env";
import { startScheduler } from "./scheduler/scheduler";

app.listen(env.port, () => {
  console.log(`API démarrée sur le port ${env.port} (${env.nodeEnv})`);
});

// Le scheduler démarre avec le serveur et continue de fonctionner indépendamment
// du frontend/navigateur (points 48, 67, Règle 6).
startScheduler().catch((err) => {
  console.error("Échec du démarrage du scheduler:", err);
});
