export function parseTelegramPostUrl(url: string): { chatId: string; messageId: number } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("t.me")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // Format canal privé : t.me/c/1234567890/123
    if (parts[0] === "c" && parts.length >= 3) {
      const internalId = parts[1];
      const messageId = parseInt(parts[2], 10);
      if (!internalId || Number.isNaN(messageId)) return null;
      return { chatId: `-100${internalId}`, messageId };
    }
    // Format canal public : t.me/username/123
    if (parts.length >= 2) {
      const username = parts[0];
      const messageId = parseInt(parts[1], 10);
      if (!username || Number.isNaN(messageId)) return null;
      return { chatId: `@${username}`, messageId };
    }
    return null;
  } catch {
    return null;
  }
}
