# Image unique combinant le backend Express (API + scheduler) et le
# frontend Next.js, servis par un seul processus (server.js) sur un seul
# port — voir la variable d'environnement PORT fournie par Render.

# ---------------------------------------------------------------------
# Étape 1 : build du backend (TypeScript -> dist/, client Prisma)
# ---------------------------------------------------------------------
FROM node:20-slim AS backend-build
WORKDIR /app/backend
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm install

COPY backend .
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------
# Étape 2 : build du frontend (next build)
# ---------------------------------------------------------------------
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend .
RUN npm run build

# ---------------------------------------------------------------------
# Étape 3 : image finale — backend + frontend + serveur combiné
# ---------------------------------------------------------------------
FROM node:20-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

# Backend : code compilé, dépendances (incl. CLI Prisma pour la migration
# au démarrage) et schéma Prisma.
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/prisma ./backend/prisma
COPY --from=backend-build /app/backend/package*.json ./backend/

# Frontend : build Next.js et ses dépendances.
COPY --from=frontend-build /app/frontend/.next ./frontend/.next
COPY --from=frontend-build /app/frontend/node_modules ./frontend/node_modules
COPY --from=frontend-build /app/frontend/public ./frontend/public
COPY --from=frontend-build /app/frontend/package*.json ./frontend/
COPY --from=frontend-build /app/frontend/next.config.js ./frontend/

# Serveur combiné à la racine.
COPY server.js ./
COPY package*.json ./

EXPOSE 3000

# Applique le schéma Prisma à jour puis démarre le serveur combiné
# (API + frontend + scheduler dans le même processus).
CMD ["sh", "-c", "cd backend && npx prisma db push --accept-data-loss --skip-generate && cd .. && node server.js"]
