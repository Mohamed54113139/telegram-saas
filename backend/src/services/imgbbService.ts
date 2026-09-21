import fetch from "node-fetch";
import { env } from "../config/env";
import { HttpError } from "../middleware/errorHandler";

interface ImgbbResponse {
  data?: { url: string; display_url: string };
  success: boolean;
  error?: { message: string };
}

// Upload une image encodée en base64 vers ImgBB, retourne le lien direct.
export async function uploadImageToImgbb(base64Image: string): Promise<string> {
  if (!env.imgbbApiKey) {
    throw new HttpError(400, "L'upload d'image n'est pas configuré (IMGBB_API_KEY manquante).");
  }

  // Retire le préfixe "data:image/xxx;base64," si présent — ImgBB attend
  // uniquement les données base64 pures
  const cleanBase64 = base64Image.includes(",")
    ? base64Image.split(",")[1]
    : base64Image;

  const params = new URLSearchParams();
  params.append("key", env.imgbbApiKey);
  params.append("image", cleanBase64);

  // Toute panne réseau / réponse inattendue d'ImgBB est convertie en HttpError
  // explicite : sans ça, l'utilisateur ne voit que le message générique
  // "Erreur interne du serveur." et la cause réelle reste invisible.
  let res;
  try {
    res = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: params,
      timeout: 25_000,
    });
  } catch (e: any) {
    console.error("[imgbb] Appel réseau échoué:", e?.message);
    throw new HttpError(502, `Le service d'hébergement d'images (ImgBB) est injoignable : ${e?.message ?? "erreur réseau"}.`);
  }

  const raw = await res.text();
  let data: ImgbbResponse;
  try {
    data = JSON.parse(raw) as ImgbbResponse;
  } catch {
    console.error("[imgbb] Réponse non-JSON, status", res.status, raw.slice(0, 200));
    throw new HttpError(502, `ImgBB a renvoyé une réponse invalide (HTTP ${res.status}). Réessayez dans un instant.`);
  }

  if (!data.success || !data.data) {
    console.error("[imgbb] Refus, status", res.status, JSON.stringify(data.error ?? data).slice(0, 300));
    throw new HttpError(400, data.error?.message ?? `Échec de l'upload de l'image (HTTP ${res.status}).`);
  }

  return data.data.display_url;
}
