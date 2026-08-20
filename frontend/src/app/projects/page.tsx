"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import Topbar from "@/components/Topbar";
import { apiFetch, ApiError } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  timezone: string;
  telegramChannel?: { status: string; chatTitle?: string } | null;
}

function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Paris");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<Project[]>("/api/projects");
      setProjects(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiFetch("/api/projects", { method: "POST", body: JSON.stringify({ name, timezone }) });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="container">
      <h1>Mes projets</h1>
      <p className="muted">Chaque projet est indépendant : son propre canal Telegram, ses messages, ses programmations.</p>

      <div className="card">
        <h2>+ Créer un projet</h2>
        <form onSubmit={handleCreate} className="row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label>Nom du projet</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon canal" required />
          </div>
          <div style={{ width: 220 }}>
            <label>Fuseau horaire</label>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Paris" required />
          </div>
          <button type="submit" disabled={creating}>{creating ? "Création…" : "Créer"}</button>
        </form>
        {error && <div className="error-box">{error}</div>}
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : projects.length === 0 ? (
        <p className="muted">Aucun projet pour le moment. Créez votre premier projet ci-dessus.</p>
      ) : (
        <div className="grid">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card" style={{ display: "block" }}>
              <h2 style={{ marginBottom: 6 }}>{p.name}</h2>
              <p className="muted" style={{ marginBottom: 8 }}>{p.timezone}</p>
              <span className={`badge ${p.telegramChannel?.status === "CONNECTED" ? "ok" : "muted"}`}>
                {p.telegramChannel?.status === "CONNECTED" ? `Connecté · ${p.telegramChannel?.chatTitle ?? ""}` : "Telegram non connecté"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <RequireAuth>
      <Topbar />
      <ProjectsList />
    </RequireAuth>
  );
}
