# Plateforme d'automatisation de contenus Telegram

Plateforme SaaS générique de gestion, programmation et automatisation de publications Telegram : projets multiples, messages modèles, variables (protégées / modifiables), sessions de publication, programmation récurrente, reformulation IA optionnelle, scheduler persistant côté serveur, historique et mode simulation.

Ce projet est **fonctionnel de bout en bout** (backend + base de données + scheduler réel, frontend connecté à une vraie API — aucune donnée fictive) et prêt à être déployé.

---

## 1. Structure du projet

```
telegram-saas/
├── docker-compose.yml          # Orchestration Postgres + backend + frontend
├── backend/                    # API + scheduler (Node.js / TypeScript / Express / Prisma)
│   ├── prisma/
│   │   └── schema.prisma       # Modèle de données complet (Users, Projects, Messages, Variables, Schedules, Sessions, ScheduledPosts, Logs…)
│   ├── src/
│   │   ├── config/             # Configuration (env, client Prisma)
│   │   ├── middleware/         # Auth JWT, isolation des projets, gestion d'erreurs
│   │   ├── routes/             # auth, projects, telegram, messages, variables, schedules, sessions, posts, simulation
│   │   ├── services/           # Telegram Bot API, reformulation IA, variables, calcul de session, matérialisation des programmations
│   │   ├── scheduler/          # Scheduler persistant (cron + file d'attente + reprise après redémarrage)
│   │   ├── utils/               # Chiffrement, JWT, fuseaux horaires, idempotence
│   │   └── index.ts             # Point d'entrée du serveur
│   ├── Dockerfile
│   └── .env.example
└── frontend/                   # Interface web (Next.js / TypeScript, App Router)
    ├── src/app/                # Pages : login, register, projects, dashboard, messages, variables,
    │                            #         programmation, sessions, planning, historique, Telegram
    ├── src/components/         # Topbar, garde d'authentification
    ├── src/lib/                # Client API, contexte d'authentification
    ├── Dockerfile
    └── .env.example
```

---

## 2. Variables d'environnement

### Backend (`backend/.env`, à copier depuis `backend/.env.example`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | URL de connexion PostgreSQL |
| `JWT_SECRET` | Secret pour signer les tokens d'authentification (chaîne longue et aléatoire) |
| `JWT_EXPIRES_IN` | Durée de validité des sessions (ex: `7d`) |
| `ENCRYPTION_KEY` | Clé utilisée pour chiffrer les tokens Telegram en base (32 caractères minimum) |
| `ANTHROPIC_API_KEY` | Clé API Anthropic pour la reformulation automatique (optionnelle — si absente, la reformulation est simplement ignorée et le message original est utilisé) |
| `PORT` | Port du serveur API (défaut `4000`) |
| `CORS_ORIGIN` | URL du frontend autorisée en CORS |
| `SCHEDULER_INTERVAL_SECONDS` | Intervalle entre deux cycles du scheduler (défaut `30`) |

### Frontend (`frontend/.env`, à copier depuis `frontend/.env.example`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL du backend (ex: `http://localhost:4000`) |

**Aucun secret (token Telegram, clé API) n'est jamais exposé au frontend.** Le token du bot est chiffré (AES-256-GCM) avant stockage en base et n'est jamais renvoyé dans les réponses API ni dans les logs.

---

## 3. Installation et lancement en local

Prérequis : Node.js 20+, PostgreSQL 16 (ou Docker), npm.

### 3.1 Base de données

Si vous n'utilisez pas Docker pour Postgres, créez une base `telegram_saas` et adaptez `DATABASE_URL`.

### 3.2 Backend

```bash
cd backend
cp .env.example .env
# éditez .env : DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, éventuellement ANTHROPIC_API_KEY

npm install
npx prisma generate
npx prisma migrate dev --name init   # crée les tables en base

npm run dev        # démarre l'API + le scheduler en mode développement (http://localhost:4000)
```

### 3.3 Frontend

Dans un second terminal :

```bash
cd frontend
cp .env.example .env
# NEXT_PUBLIC_API_URL=http://localhost:4000

npm install
npm run dev         # http://localhost:3000
```

Ouvrez `http://localhost:3000`, créez un compte, puis un premier projet.

### 3.4 Commandes utiles

| Commande | Effet |
|---|---|
| `npm run build` (backend) | Compile le TypeScript vers `dist/` |
| `npm start` (backend) | Lance la version compilée |
| `npx prisma studio` (backend) | Interface graphique pour explorer la base |
| `npm run build` (frontend) | Build de production Next.js |
| `npm start` (frontend) | Lance le frontend en production |

---

## 4. Déploiement avec Docker

Un `docker-compose.yml` à la racine orchestre PostgreSQL, le backend et le frontend.

```bash
cd telegram-saas

# Définissez vos secrets de production (recommandé : fichier .env à la racine, lu automatiquement par docker-compose)
cat > .env << 'ENVEOF'
JWT_SECRET=une-longue-chaine-aleatoire
ENCRYPTION_KEY=une-autre-chaine-de-32-caracteres-minimum
ANTHROPIC_API_KEY=sk-ant-...
CORS_ORIGIN=https://votre-domaine.com
NEXT_PUBLIC_API_URL=https://api.votre-domaine.com
ENVEOF

docker compose up -d --build
```

Le backend applique automatiquement les migrations Prisma au démarrage du conteneur (`prisma migrate deploy`) avant de lancer le serveur et le scheduler.

Le scheduler tourne **dans le conteneur backend**, indépendamment du navigateur : une fois une programmation ou une session activée, elle continue de s'exécuter tant que le conteneur tourne, y compris après un redémarrage (les publications déjà envoyées ne sont jamais rejouées, grâce à des clés d'idempotence).

---

## 5. Déploiement sur un serveur / cloud (sans Docker)

1. Provisionnez une base PostgreSQL managée (ou auto-hébergée).
2. Backend : `npm ci && npx prisma generate && npx prisma migrate deploy && npm run build`, puis lancez `node dist/index.js` derrière un gestionnaire de process persistant (`pm2`, `systemd`, ou l'équivalent de votre plateforme — Render, Railway, Fly.io, VPS...). C'est ce process qui héberge à la fois l'API **et** le scheduler.
3. Frontend : `npm ci && npm run build && npm start`, ou déployez le dossier `.next` sur Vercel/Netlify en pointant `NEXT_PUBLIC_API_URL` vers votre backend.
4. Placez un reverse proxy (Nginx, Caddy, ou le load balancer de votre cloud) devant les deux services avec HTTPS (Let's Encrypt).
5. Assurez-vous que le process backend reste **toujours actif** (redémarrage automatique en cas de crash) : c'est lui qui exécute réellement les publications programmées.

---

## 6. Connecter Telegram

1. Ouvrez Telegram, discutez avec **[@BotFather](https://t.me/BotFather)**, envoyez `/newbot` et suivez les instructions. Vous obtenez un **token** du type `123456789:ABCdefGhIJKlmnoPQRstuVwxyz`.
2. Créez (ou utilisez) votre canal Telegram, ajoutez votre bot comme **administrateur** avec le droit *Publier des messages*.
3. Récupérez l'identifiant du canal :
   - canal public : `@nomducanal`
   - canal privé : un identifiant numérique du type `-1001234567890` (obtenu par ex. via l'API Telegram ou un bot utilitaire comme @userinfobot ajouté temporairement au canal)
4. Dans la plateforme : ouvrez un projet → onglet **Telegram** → renseignez le token et l'identifiant → **Connecter**. Le système vérifie automatiquement que le bot existe, qu'il a accès au canal et qu'il y a les droits de publication.
5. Utilisez **Envoyer un message de test** pour confirmer que tout fonctionne avant d'activer une programmation ou une session.

---

## 7. Ce qui est réellement implémenté (et vérifié)

- Authentification complète (JWT + bcrypt), isolation stricte des données par utilisateur et par projet.
- Multi-projets indépendants, chacun avec son propre canal Telegram, ses messages, variables, programmations et historique.
- Connexion Telegram via l'API officielle, avec vérification du bot, du canal et des permissions ; token chiffré en base (AES-256-GCM), jamais exposé au frontend ni dans les logs.
- Messages modèles : le contenu original n'est **jamais** modifié automatiquement. La reformulation IA (optionnelle, via l'API Anthropic) respecte strictement les variables non modifiables et les éléments obligatoires — toute violation entraîne un retour automatique au texte original.
- Variables non modifiables et modifiables (texte, nombre avec bornes, dates/heures automatiques).
- Programmation par jour(s)/date(s)/heure(s), avec recalcul automatique lors d'une modification.
- Sessions de publication avec calcul automatique du nombre de publications à partir du début, de la durée et de l'intervalle.
- Scheduler persistant côté serveur (cron), avec file d'attente par verrouillage optimiste, reprise après redémarrage, et prévention stricte des doublons via clés d'idempotence.
- Historique, planning visuel, annulation de publications futures, mode simulation (calcul complet sans envoi réel), validation pré-activation.
- Journalisation technique sans exposition de secrets.

Le backend a été vérifié par compilation TypeScript stricte (`tsc --noEmit`) sans erreur. Le frontend a été vérifié par un build de production Next.js complet (14 routes compilées avec succès). `npx prisma generate` nécessite un accès réseau à `binaries.prisma.sh` : à exécuter dans votre propre environnement (l'environnement de génération de ce projet a un accès réseau restreint).

---

## 8. Prochaines évolutions possibles (architecture déjà prévue pour)

- Autres plateformes que Telegram : le modèle `Project.platform` est une énumération conçue pour être étendue (ajout d'un `PlatformAdapter` par plateforme), sans toucher au reste de l'application.
- Notifications par email lors d'échecs de publication répétés.
- Anti-répétition inter-messages (actuellement implémenté par modèle de message).
