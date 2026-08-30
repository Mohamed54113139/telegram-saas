"use client";

// Limite Telegram pour la légende d'une photo (contre 4096 pour un message
// texte) — voir telegramService.ts. Au-delà, le backend envoie la photo avec
// un court aperçu suivi d'un message texte séparé contenant le contenu complet.
const PHOTO_CAPTION_LIMIT = 1024;

interface CaptionLengthNoticeProps {
  content: string;
  hasImage: boolean;
}

export default function CaptionLengthNotice({ content, hasImage }: CaptionLengthNoticeProps) {
  const length = content.length;
  const overLimit = hasImage && length > PHOTO_CAPTION_LIMIT;

  return (
    <>
      <p className="muted" style={{ marginTop: 4 }}>
        {length} caractère{length > 1 ? "s" : ""}
        {hasImage ? ` (limite légende photo : ${PHOTO_CAPTION_LIMIT})` : ""}
      </p>
      {overLimit && (
        <div className="warning-box">
          Ce texte dépasse la limite de légende Telegram pour une image ({PHOTO_CAPTION_LIMIT} caractères). Le message sera envoyé en deux parties : la photo avec un court aperçu, immédiatement suivie d'un message texte séparé contenant le contenu complet.
        </div>
      )}
    </>
  );
}
