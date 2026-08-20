import crypto from "crypto";
import { env } from "../config/env";

// Chiffrement AES-256-GCM pour les secrets sensibles (ex: token Telegram)
// La clé doit faire exactement 32 octets. On la dérive via sha256 pour accepter
// n'importe quelle chaîne fournie dans ENCRYPTION_KEY.
const KEY = crypto.createHash("sha256").update(env.encryptionKey).digest();
const IV_LENGTH = 12; // recommandé pour GCM

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // format: iv:authTag:ciphertext (tous en base64)
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Format de secret chiffré invalide");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

// Masque un token pour affichage/logs (ne jamais logger le token en clair — point 68)
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}
