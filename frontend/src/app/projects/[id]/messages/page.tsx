"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";

interface MessageTemplate {
  id: string;
  name: string;
  originalContent: string;
  imageUrl?: string | null;
  autoEdit: boolean;
  active: boolean;
}

export default function MessagesPage() {
  const { id } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<MessageTemplate[]>([]);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const data = await apiFetch<MessageTemplate[]>(`/api/projects/${id}/messages`);
    setMessages(data);
  }
  useEffect(() => { load(); }, [id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/messages`, { method: "POST", body: JSON.stringify({ name, originalContent: content, imageUrl: imageUrl || null }) });
      setName(""); setContent(""); setImageUrl("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h1>Messages</h1>
      <p className="muted">Le contenu du modèle original est toujours conservé tel quel ; les réglages de reformulation se configurent depuis la fiche du message.</p>

      <div className="card">
        <h2>+ Nouveau message</h2>
        <form onSubmit={handleCreate}>
          <label>Nom du message</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Message d'accueil" required />
          <label>Contenu (utilisez {"{VARIABLE}"} pour les variables modifiables)</label>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={"Bonjour à tous !\n\nVoici le contenu de votre message.\n\nÀ bientôt."} required />
          <label>Image (URL, optionnel)</label>
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://exemple.com/image.jpg" />
          {error && <div className="error-box">{error}</div>}
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={creating}>{creating ? "Création…" : "Créer le message"}</button>
          </div>
        </form>
      </div>

      <div className="stack">
        {messages.map((m) => (
          <Link key={m.id} href={`/projects/${id}/messages/${m.id}`} className="card" style={{ display: "block" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{m.name}</h2>
              <span className={`badge ${m.autoEdit ? "ok" : "muted"}`}>{m.autoEdit ? "Reformulation ON" : "Modifier : OFF"}</span>
            </div>
            <p className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{m.originalContent.slice(0, 160)}{m.originalContent.length > 160 ? "…" : ""}</p>
          </Link>
        ))}
        {messages.length === 0 && <p className="muted">Aucun message pour le moment.</p>}
      </div>
    </div>
  );
}
