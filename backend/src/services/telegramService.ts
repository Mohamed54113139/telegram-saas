import fetch from "node-fetch";
import { HttpError } from "../middleware/errorHandler";

const TELEGRAM_API = "https://api.telegram.org";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function callTelegram<T>(botToken: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    // Ne jamais inclure le token dans le message d'erreur (point 7)
    throw new HttpError(400, data.description ?? "Erreur Telegram inconnue.");
  }
  return data.result as T;
}

export interface TelegramMe {
  id: number;
  is_bot: boolean;
  username: string;
}

export interface TelegramChat {
  id: number;
  title?: string;
  type: string;
}

// Vérifie que le bot est valide (point 6 : vérifier la connexion)
export async function verifyBot(botToken: string): Promise<TelegramMe> {
  return callTelegram<TelegramMe>(botToken, "getMe");
}

// Vérifie que le bot a accès au chat/canal et récupère ses infos
export async function verifyChat(botToken: string, chatId: string): Promise<TelegramChat> {
  return callTelegram<TelegramChat>(botToken, "getChat", { chat_id: chatId });
}

// Vérifie que le bot est administrateur du canal avec les droits de publication
export async function verifyBotIsAdmin(botToken: string, chatId: string, botUserId: number): Promise<boolean> {
  try {
    const member = await callTelegram<{ status: string; can_post_messages?: boolean }>(
      botToken,
      "getChatMember",
      { chat_id: chatId, user_id: botUserId }
    );
    if (member.status === "creator") return true;
    if (member.status === "administrator") {
      // can_post_messages n'est renvoyé que pour les canaux ; absent = autorisé par défaut sur certains types
      return member.can_post_messages !== false;
    }
    return false;
  } catch {
    return false;
  }
}

// Envoie un message texte sur le canal
export async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<{ message_id: number }> {
  return callTelegram<{ message_id: number }>(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
}
