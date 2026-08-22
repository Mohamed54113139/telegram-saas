"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import ImageUploadField from "@/components/ImageUploadField";

interface MessageTemplate {
  id: string;
  name: string;
  originalContent: string;
  imageUrl?: string | null;
  sourceChatId?: string | null;
  sourceMessageId?: number | null;
  autoEdit: boolean;
  editLevel: string;
  customInstructions?: string | null;
  similarity: number;
  preserveEmojis: boolean;
  preservePunctuation: boolean;
  requiredElements: string[];
  active: boolean;
}

interface PreviewResult {
  originalContent: string;
  generatedContent: string;
  usedVariables: Record<string, string>;
  wasRewritten: boolean;
  rewriteVerified: boolean;
  rewriteIssues: string[];
}

interface SuggestionResult {
  id: string;
  currentInstructions: string | null;
  suggestedInstructions: string;
  reasoning: string;
}

export default function MessageDetailPage() {
  const { id, messageId } = useParams<{ id: string; messageId: string }>();
  const router = useRouter();
  const [msg, setMsg] = useState<MessageTemplate | null>(null);
  const [requiredElementsText, setRequiredElementsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  async function load() {
    const data = await apiFetch<MessageTemplate>(`/api/projects/${id}/messages/${messageId}`);
    setMsg(data);
    setRequiredElementsText(data.requiredElements.join(", "));
  }
  useEffect(() => { load(); }, [id, messageId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!msg) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiFetch<MessageTemplate>(`/api/projects/${id}/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: msg.name,
          originalContent: msg.originalContent,
          imageUrl: msg.imageUrl || null,
          autoEdit: msg.autoEdit,
          editLevel: msg.editLevel,
          customInstructions: msg.customInstructions,
          similarity: msg.similarity,
          preserveEmojis: msg.preserveEmojis,
          preservePunctuation: msg.preservePunctuation,
          requiredElements: requiredElementsText.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      setMsg(updated);
      setSuccess("Enregistré.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur d'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setError(null);
    try {
      const result = await apiFetch<PreviewResult>(`/api/projects/${id}/messages/${messageId}/preview`, { method: "POST", body: JSON.stringify({}) });
      setPreview(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Aperçu impossible.");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSendTest() {
    if (!confirm("Envoyer réellement ce message sur le canal Telegram connecté ?")) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/projects/${id}/messages/${messageId}/send-test`, { method: "POST", body: JSON.stringify({}) });
      setSuccess("Message de test envoyé sur Telegram.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  }

  async function handleSuggestImprovement() {
    setSuggesting(true);
    setSuggestionError(null);
    setSuggestion(null);
    try {
      const result = await apiFetch<SuggestionResult>(`/api/projects/${id}/messages/${messageId}/suggest-improvement`, { method: "POST", body: JSON.stringify({}) });
      setSuggestion(result);
    } catch (err) {
      setSuggestionError(err instanceof ApiError ? err.message : "Analyse impossible.");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Supprimer définitivement ce message ?")) return;
    await apiFetch(`/api/projects/${id}/messages/${messageId}`, { method: "DELETE" });
    router.push(`/projects/${id}/messages`);
  }

  if (!msg) return <p className="muted">Chargement…</p>;

  if (msg.sourceChatId && !msg.originalContent) {
    return (
      <div>
        <h1>{msg.name} <span className="badge muted">Copie</span></h1>
        <div className="card">
          <p>Publication copiée depuis {msg.sourceChatId}, message #{msg.sourceMessageId}</p>
          <p className="muted">Ce message republie tel quel un post Telegram existant ; le contenu, l'image et les réglages de reformulation ne s'appliquent pas ici.</p>
          {error && <div className="error-box">{error}</div>}
          {success && <div className="success-box">{success}</div>}
          <div className="row" style={{ marginTop: 14 }}>
            <button type="button" className="secondary" onClick={handleSendTest} disabled={sending}>{sending ? "Envoi…" : "Envoyer un message test"}</button>
            <button type="button" className="danger" onClick={handleDelete}>Supprimer</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>{msg.name}</h1>

      {msg.sourceChatId && (
        <div className="card">
          <p>Publication copiée depuis {msg.sourceChatId}, message #{msg.sourceMessageId}.</p>
          <p className="muted">Ceci reformule uniquement la légende du post copié, pas le média (image/vidéo) lui-même.</p>
        </div>
      )}

      {msg.imageUrl && (
        <div className="card">
          <img src={msg.imageUrl} style={{ maxWidth: 300, borderRadius: 8 }} />
        </div>
      )}

      <form onSubmit={handleSave} className="card">
        <h2>Contenu &amp; édition</h2>
        <label>Nom</label>
        <input value={msg.name} onChange={(e) => setMsg({ ...msg, name: e.target.value })} />

        <label>Message modèle original</label>
        <textarea value={msg.originalContent} onChange={(e) => setMsg({ ...msg, originalContent: e.target.value })} style={{ minHeight: 140 }} />

        <ImageUploadField projectId={id} value={msg.imageUrl ?? ""} onChange={(url) => setMsg({ ...msg, imageUrl: url })} />

        <label className="row" style={{ marginTop: 16 }}>
          <input type="checkbox" checked={msg.autoEdit} onChange={(e) => setMsg({ ...msg, autoEdit: e.target.checked })} />
          Modifier automatiquement (reformulation IA)
        </label>

        {msg.autoEdit && (
          <>
            <label>Niveau de modification</label>
            <select value={msg.editLevel} onChange={(e) => setMsg({ ...msg, editLevel: e.target.value })}>
              <option value="LEGERE">Légère</option>
              <option value="NORMALE">Normale</option>
              <option value="IMPORTANTE">Importante</option>
              <option value="PERSONNALISEE">Personnalisée</option>
            </select>

            {msg.editLevel === "PERSONNALISEE" && (
              <>
                <label>Instructions personnalisées</label>
                <textarea value={msg.customInstructions ?? ""} onChange={(e) => setMsg({ ...msg, customInstructions: e.target.value })} />
              </>
            )}

            <label>Similarité avec le modèle : {msg.similarity}% (0 = très différent, 100 = très proche)</label>
            <input type="range" min={0} max={100} value={msg.similarity} onChange={(e) => setMsg({ ...msg, similarity: parseInt(e.target.value) })} />

            <label className="row"><input type="checkbox" checked={msg.preserveEmojis} onChange={(e) => setMsg({ ...msg, preserveEmojis: e.target.checked })} /> Conserver les emojis</label>
            <label className="row"><input type="checkbox" checked={msg.preservePunctuation} onChange={(e) => setMsg({ ...msg, preservePunctuation: e.target.checked })} /> Conserver exactement la ponctuation</label>
          </>
        )}

        <label>Éléments obligatoires (séparés par des virgules)</label>
        <input value={requiredElementsText} onChange={(e) => setRequiredElementsText(e.target.value)} />

        {error && <div className="error-box">{error}</div>}
        {success && <div className="success-box">{success}</div>}

        <div className="row" style={{ marginTop: 14 }}>
          <button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
          <button type="button" className="secondary" onClick={handlePreview} disabled={previewing}>{previewing ? "Génération…" : "Tester (aperçu)"}</button>
          <button type="button" className="secondary" onClick={handleSendTest} disabled={sending}>{sending ? "Envoi…" : "Envoyer un message test"}</button>
          <button type="button" className="secondary" onClick={handleSuggestImprovement} disabled={suggesting}>{suggesting ? "Analyse…" : "Analyser les retours"}</button>
          <button type="button" className="danger" onClick={handleDelete}>Supprimer</button>
        </div>
      </form>

      {suggestionError && <div className="error-box">{suggestionError}</div>}

      {suggestion && (
        <div className="card">
          <h2>Suggestion d'amélioration</h2>
          <h3>Instructions actuelles</h3>
          <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{suggestion.currentInstructions || "(aucune)"}</p>
          <h3>Instructions suggérées</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{suggestion.suggestedInstructions}</p>
          <h3>Raisonnement</h3>
          <p className="muted">{suggestion.reasoning}</p>
          <p className="muted">Rendez-vous dans l'onglet "Suggestions" du projet pour approuver ou rejeter cette proposition.</p>
        </div>
      )}

      {preview && (
        <div className="card">
          <h2>Aperçu</h2>
          <h3>Modèle original</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{preview.originalContent}</p>
          <h3>Version générée</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{preview.generatedContent}</p>
          {Object.keys(preview.usedVariables).length > 0 && (
            <>
              <h3>Variables utilisées</h3>
              <p className="muted">{Object.entries(preview.usedVariables).map(([k, v]) => `${k} = ${v}`).join(" · ")}</p>
            </>
          )}
          {!preview.rewriteVerified && (
            <div className="error-box">La reformulation a été rejetée (contraintes non respectées) : {preview.rewriteIssues.join(" ; ")}. Le contenu original a été utilisé à la place.</div>
          )}
        </div>
      )}
    </div>
  );
}
