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

  const res = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body: params,
  });

  const data = (await res.json()) as ImgbbResponse;
  if (!data.success || !data.data) {
    throw new HttpError(400, data.error?.message ?? "Échec de l'upload de l'image.");
  }

  return data.data.display_url;
}
