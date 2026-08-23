/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pas de "output: standalone" : incompatible avec le serveur personnalisé
  // (server.js à la racine, qui appelle next() + app.prepare() lui-même).
};
module.exports = nextConfig;
