"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface MessageTemplate { id: string; name: string; }
interface SessionItem {
  id: string;
  name: string;
  startTime: string;
  durationMin: number;
  intervalMin: number;
  active: boolean;
  messageTemplate: { name: string };
}
interface CalcResult { startTime: string; endTime: string; totalPosts: number; occurrences: string[]; }

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SessionsPage() {
  const { id } = useParams<{ id: string }>();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [name, setName] = useState("Session");
  const [messageTemplateId, setMessageTemplateId] = useState("");
  const [startTime, setStartTime] = useState(toLocalInputValue(new Date(Date.now() + 3600_000)));
  const [durationMin, setDurationMin] = useState(60);
  const [intervalMin, setIntervalMin] = useState(10);
  const [calc, setCalc] = useState<CalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const [s, t] = await Promise.all([
      apiFetch<SessionItem[]>(`/api/projects/${id}/sessions`),
      apiFetch<MessageTemplate[]>(`/api/projects/${id}/messages`),
    ]);
    setSessions(s);
    setTemplates(t);
    if (t.length > 0 && !messageTemplateId) setMessageTemplateId(t[0].id);
  }
  useEffect(() => { load(); }, [id]);

  async function handlePreview() {
    setError(null);
    try {
      const result = await apiFetch<CalcResult>(`/api/projects/${id}/sessions/preview`, {
        method: "POST",
        body: JSON.stringify({ startTime: new Date(startTime).toISOString(), durationMin, intervalMin }),
      });
      setCalc(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Calcul impossible.");
    }
  }

  useEffect(() => { handlePreview(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [startTime, durationMin, intervalMin]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/sessions`, {
        method: "POST",
        body: JSON.stringify({ name, messageTemplateId, startTime: new Date(startTime).toISOString(), durationMin, intervalMin }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(sessionId: string) {
    await apiFetch(`/api/projects/${id}/sessions/${sessionId}/toggle`, { method: "POST" });
    await load();
  }
  async function remove(sessionId: string) {
    if (!confirm("Supprimer cette session ?")) return;
    await apiFetch(`/api/projects/${id}/sessions/${sessionId}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <h1>Sessions de publication</h1>
      <p className="muted">Une session publie plusieurs fois le même message sur une période donnée. Le nombre de publications est calculé automatiquement.</p>

      {templates.length === 0 ? (
        <p className="muted">Créez d'abord un message avant de créer une session.</p>
      ) : (
        <form onSubmit={handleCreate} className="card">
          <label>Nom de la session</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />

          <label>Message</label>
          <select value={messageTemplateId} onChange={(e) => setMessageTemplateId(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <div className="row">
            <div style={{ flex: 1, minWidth: 200 }}>
              <label>Début</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div style={{ width: 160 }}>
              <label>Durée (minutes)</label>
              <input type="number" min={1} value={durationMin} onChange={(e) => setDurationMin(parseInt(e.target.value) || 0)} required />
            </div>
            <div style={{ width: 160 }}>
              <label>Intervalle (minutes)</label>
              <input type="number" min={1} value={intervalMin} onChange={(e) => setIntervalMin(parseInt(e.target.value) || 0)} required />
            </div>
          </div>

          {calc && (
            <div className="success-box">
              <strong>{calc.totalPosts} publication(s)</strong> — de {new Date(calc.startTime).toLocaleTimeString("fr-FR")} à {new Date(calc.endTime).toLocaleTimeString("fr-FR")} ({new Date(calc.startTime).toLocaleDateString("fr-FR")})
            </div>
          )}
          {error && <div className="error-box">{error}</div>}

          <div style={{ marginTop: 10 }}>
            <button type="submit" disabled={creating}>{creating ? "Création…" : "Créer la session"}</button>
          </div>
        </form>
      )}

      <div className="stack">
        {sessions.map((s) => (
          <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{s.name}</strong>
              <span className={`badge ${s.active ? "ok" : "muted"}`}>{s.active ? "Active" : "Inactive"}</span>
            </div>
            <p className="muted">{s.messageTemplate.name} · {new Date(s.startTime).toLocaleString("fr-FR")} · {s.durationMin} min · intervalle {s.intervalMin} min</p>
            <div className="row">
              <button className="secondary" onClick={() => toggleActive(s.id)}>{s.active ? "Désactiver" : "Activer"}</button>
              <button className="danger" onClick={() => remove(s.id)}>Supprimer</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
