"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface ContentSource {
  id: string;
  name: string;
  feedUrl: string;
  mode: "AUTO" | "MANUAL";
  digestMode: boolean;
  active: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export default function SourcesPage() {
  const { id } = useParams<{ id: string }>();
  const [sources, setSources] = useState<ContentSource[]>([]);
  const [name, setName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [mode, setMode] = useState<"AUTO" | "MANUAL">("MANUAL");
  const [digestMode, setDigestMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  async function load() {
    const data = await apiFetch<ContentSource[]>(`/api/projects/${id}/sources`);
    setSources(data);
  }
  useEffect(() => { load(); }, [id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/sources`, {
        method: "POST",
        body: JSON.stringify({ name, feedUrl, mode: digestMode ? "MANUAL" : mode, digestMode }),
      });
      setName(""); setFeedUrl(""); setMode("MANUAL"); setDigestMode(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(sourceId: string) {
    await apiFetch(`/api/projects/${id}/sources/${sourceId}/toggle`, { method: "POST" });
    await load();
  }

  async function checkNow(sourceId: string) {
    setCheckingId(sourceId);
    try {
      await apiFetch(`/api/projects/${id}/sources/${sourceId}/check`, { method: "POST" });
      await load();
    } finally {
      setCheckingId(null);
    }
  }

  async function remove(sourceId: string) {
    if (!confirm("Supprimer cette source de veille ?")) return;
    await apiFetch(`/api/projects/${id}/sources/${sourceId}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <h1>Sources de veille</h1>
      <p className="muted">Surveillez un flux RSS et publiez automatiquement (ou en accumulant en digest) chaque nouvel élément trouvé.</p>

      <div className="card">
        <h2>+ Nouvelle source</h2>
        <form onSubmit={handleCreate}>
          <label>Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Actualités du secteur" required />

          <label>URL du flux RSS</label>
          <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://exemple.com/flux.xml" required />

          <label className="row" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={digestMode} onChange={(e) => setDigestMode(e.target.checked)} />
            Mode digest quotidien (accumule au lieu de publier individuellement)
          </label>

          {!digestMode && (
            <>
              <label>Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as "AUTO" | "MANUAL")}>
                <option value="MANUAL">Manuel (crée le message, vous programmez vous-même)</option>
                <option value="AUTO">Automatique (publie chaque nouvel élément immédiatement)</option>
              </select>
            </>
          )}

          {error && <div className="error-box">{error}</div>}
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={creating}>{creating ? "Création…" : "Créer la source"}</button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: 12 }}>
          Utilisez la variable {"{PRONOS_DU_JOUR}"} dans un message modèle, puis programmez-le quotidiennement, pour publier le résumé de toutes les sources en mode digest de ce projet.
        </p>
      </div>

      <div className="stack">
        {sources.map((s) => (
          <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ marginTop: 0 }}>
                <strong>{s.name}</strong>
                {s.digestMode && <span className="badge muted">Digest</span>}
                {!s.digestMode && <span className="badge muted">{s.mode === "AUTO" ? "Auto" : "Manuel"}</span>}
              </div>
              <span className={`badge ${s.active ? "ok" : "muted"}`}>{s.active ? "Active" : "Inactive"}</span>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>{s.feedUrl}</p>
            <p className="muted">
              {s.lastCheckedAt ? `Dernière vérification : ${new Date(s.lastCheckedAt).toLocaleString("fr-FR")}` : "Jamais vérifiée"}
            </p>
            {s.lastError && <div className="error-box">{s.lastError}</div>}
            <div className="row">
              <button className="secondary" onClick={() => checkNow(s.id)} disabled={checkingId === s.id}>{checkingId === s.id ? "Vérification…" : "Vérifier maintenant"}</button>
              <button className="secondary" onClick={() => toggleActive(s.id)}>{s.active ? "Désactiver" : "Activer"}</button>
              <button className="danger" onClick={() => remove(s.id)}>Supprimer</button>
            </div>
          </div>
        ))}
        {sources.length === 0 && <p className="muted">Aucune source de veille pour le moment.</p>}
      </div>
    </div>
  );
}
