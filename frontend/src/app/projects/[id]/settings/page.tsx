"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  timezone: string;
}

function currentTimeInTimezone(timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return null;
  }
}

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const data = await apiFetch<Project>(`/api/projects/${id}`);
    setProject(data);
    setName(data.name);
    setTimezone(data.timezone);
  }
  useEffect(() => { load(); }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiFetch<Project>(`/api/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, timezone }),
      });
      setProject(updated);
      setSuccess("Enregistré.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur d'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Supprimer définitivement ce projet ainsi que tout son contenu (messages, programmations, historique) ?")) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
      router.push("/projects");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Suppression impossible.");
      setDeleting(false);
    }
  }

  if (!project) return <p className="muted">Chargement…</p>;

  const previewTime = currentTimeInTimezone(timezone);

  return (
    <div>
      <h1>Paramètres</h1>

      <form onSubmit={handleSave} className="card">
        <label>Nom du projet</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required />

        <label>Fuseau horaire</label>
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
        <p className="muted" style={{ marginTop: 4 }}>
          Identifiant IANA valide, ex : Europe/Paris, Africa/Ouagadougou, UTC, America/New_York.
        </p>

        <p className="muted" style={{ marginTop: 8 }}>
          {previewTime ? `Il est actuellement ${previewTime} dans ce fuseau horaire.` : "Fuseau horaire invalide."}
        </p>

        {error && <div className="error-box">{error}</div>}
        {success && <div className="success-box">{success}</div>}

        <div style={{ marginTop: 12 }}>
          <button type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </form>

      <div className="card">
        <h2>Zone dangereuse</h2>
        <p className="muted">La suppression d'un projet est définitive et entraîne la perte de tout son contenu.</p>
        <button type="button" className="danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? "Suppression…" : "Supprimer ce projet"}
        </button>
      </div>
    </div>
  );
}
