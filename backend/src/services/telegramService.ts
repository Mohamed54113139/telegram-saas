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

function isParseEntitiesError(err: unknown): boolean {
  const message = err instanceof HttpError ? err.publicMessage : err instanceof Error ? err.message : "";
  return /can't parse entities/i.test(message);
}

// Enveloppe callTelegram pour les appels avec parse_mode : si Telegram rejette
// le texte à cause d'un caractère de formatage isolé/mal fermé, on retente
// une fois sans parse_mode plutôt que de bloquer complètement l'envoi.
async function callTelegramWithParseModeFallback<T>(botToken: string, method: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await callTelegram<T>(botToken, method, body);
  } catch (err) {
    if (body.parse_mode && isParseEntitiesError(err)) {
      const { parse_mode, ...withoutParseMode } = body;
      return await callTelegram<T>(botToken, method, withoutParseMode);
    }
    throw err;
  }
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
  return callTelegramWithParseModeFallback<{ message_id: number }>(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
}

const PHOTO_CAPTION_LIMIT = 1024;
const SHORT_CAPTION_LENGTH = 100;

// Raccourcit un texte trop long pour une légende de photo, pour servir de
// teaser — le texte complet est de toute façon envoyé juste après en message
// séparé (voir sendTelegramPhoto / copyTelegramMessage).
function shortenCaption(caption: string): string {
  return caption.slice(0, SHORT_CAPTION_LENGTH) + "…";
}

// Envoie une photo (via URL) avec légende sur le canal. La légende d'une
// photo Telegram est limitée à 1024 caractères (contre 4096 pour un message
// texte) : si le texte tient dedans, un seul message photo+légende est
// envoyé comme avant. S'il dépasse, la photo part avec une légende courte,
// immédiatement suivie d'un message texte séparé contenant le contenu
// complet — plutôt que de tronquer silencieusement le texte.
export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption?: string
): Promise<{ message_id: number }> {
  if (!caption || caption.length <= PHOTO_CAPTION_LIMIT) {
    return callTelegramWithParseModeFallback<{ message_id: number }>(botToken, "sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
    });
  }

  const photoResult = await callTelegramWithParseModeFallback<{ message_id: number }>(botToken, "sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption: shortenCaption(caption),
    parse_mode: "HTML",
  });

  await sendTelegramMessage(botToken, chatId, caption);

  return photoResult;
}

// Copie une publication existante (par son lien) vers le canal cible. Même
// traitement que sendTelegramPhoto pour la légende (voir ci-dessus) lorsque
// la légende de remplacement dépasse la limite de 1024 caractères.
export async function copyTelegramMessage(
  botToken: string,
  fromChatId: string,
  toChatId: string,
  messageId: number,
  caption?: string
): Promise<{ message_id: number }> {
  if (!caption || caption.length <= PHOTO_CAPTION_LIMIT) {
    return callTelegramWithParseModeFallback<{ message_id: number }>(botToken, "copyMessage", {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
      ...(caption ? { caption, parse_mode: "HTML" } : {}),
    });
  }

  const copyResult = await callTelegramWithParseModeFallback<{ message_id: number }>(botToken, "copyMessage", {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    caption: shortenCaption(caption),
    parse_mode: "HTML",
  });

  await sendTelegramMessage(botToken, toChatId, caption);

  return copyResult;
}
