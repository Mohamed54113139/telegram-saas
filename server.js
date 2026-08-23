// Serveur combiné : sert l'API Express (backend/) et le frontend Next.js
// (frontend/) sur un seul port, tel qu'exigé par Render (variable PORT).
// Le scheduler et les services de fond (feedWatcherService, digestService,
// scheduleMaterializationService, ...) tournent dans ce même processus.
const path = require("path");
const { createServer } = require("http");

const next = require(path.join(__dirname, "frontend", "node_modules", "next"));
const { app: apiApp } = require(path.join(__dirname, "backend", "dist", "app.js"));
const { startScheduler } = require(path.join(__dirname, "backend", "dist", "scheduler", "scheduler.js"));

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

const nextApp = next({ dev, dir: path.join(__dirname, "frontend") });
const handleNextRequest = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const server = createServer((req, res) => {
    // Toutes les routes API existantes du backend restent sous /api ;
    // /health est également routé vers l'API (utilisé pour les checks de
    // disponibilité). Tout le reste est délégué au handler par défaut de
    // Next.js (pages, assets statiques, etc.).
    if (req.url && (req.url === "/health" || req.url.startsWith("/api/"))) {
      apiApp(req, res);
      return;
    }
    handleNextRequest(req, res);
  });

  server.listen(port, () => {
    console.log(`Serveur combiné (API + frontend) démarré sur le port ${port}`);
  });

  startScheduler().catch((err) => {
    console.error("Échec du démarrage du scheduler:", err);
  });
}).catch((err) => {
  console.error("Échec de la préparation du frontend Next.js:", err);
  process.exit(1);
});
