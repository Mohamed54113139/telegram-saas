"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface MessageTemplate { id: string; name: string; }
interface Schedule {
  id: string;
  repeatMode: string;
  daysOfWeek: number[];
  times: string[];
  active: boolean;
  messageTemplate: { name: string };
}

const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function SchedulesPage() {
  const { id } = useParams<{ id: string }>();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [messageTemplateId, setMessageTemplateId] = useState("");
  const [repeatMode, setRepeatMode] = useState("DAILY");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [times, setTimes] = useState<string[]>(["09:00"]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const [s, t] = await Promise.all([
      apiFetch<Schedule[]>(`/api/projects/${id}/schedules`),
      apiFetch<MessageTemplate[]>(`/api/projects/${id}/messages`),
    ]);
    setSchedules(s);
    setTemplates(t);
    if (t.length > 0 && !messageTemplateId) setMessageTemplateId(t[0].id);
  }
  useEffect(() => { load(); }, [id]);

  function toggleDay(d: number) {
    setDaysOfWeek((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }
  function updateTime(idx: number, value: string) {
    setTimes((prev) => prev.map((t, i) => (i === idx ? value : t)));
  }
  function addTime() { setTimes((prev) => [...prev, "12:00"]); }
  function removeTime(idx: number) { setTimes((prev) => prev.filter((_, i) => i !== idx)); }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/schedules`, {
        method: "POST",
        body: JSON.stringify({
          messageTemplateId,
          repeatMode,
          daysOfWeek: repeatMode === "CUSTOM_DAYS" ? daysOfWeek : [],
          times,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(scheduleId: string) {
    await apiFetch(`/api/projects/${id}/schedules/${scheduleId}/toggle`, { method: "POST" });
    await load();
  }
  async function remove(scheduleId: string) {
    if (!confirm("Supprimer cette programmation ?")) return;
    await apiFetch(`/api/projects/${id}/schedules/${scheduleId}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <h1>Programmation</h1>
      <p className="muted">Programmez un message par jour(s) et heure(s) récurrents.</p>

      {templates.length === 0 ? (
        <p className="muted">Créez d'abord un message avant de le programmer.</p>
      ) : (
        <form onSubmit={handleCreate} className="card">
          <label>Message</label>
          <select value={messageTemplateId} onChange={(e) => setMessageTemplateId(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <label>Répétition</label>
          <select value={repeatMode} onChange={(e) => setRepeatMode(e.target.value)}>
            <option value="DAILY">Tous les jours</option>
            <option value="CUSTOM_DAYS">Jours personnalisés</option>
          </select>

          {repeatMode === "CUSTOM_DAYS" && (
            <div className="row" style={{ marginTop: 8 }}>
              {DAYS.map((d, idx) => (
                <label key={idx} className="row" style={{ marginTop: 0 }}>
                  <input type="checkbox" checked={daysOfWeek.includes(idx)} onChange={() => toggleDay(idx)} /> {d}
                </label>
              ))}
            </div>
          )}

          <label>Heures</label>
          <div className="stack">
            {times.map((t, idx) => (
              <div key={idx} className="row">
                <input type="time" value={t} onChange={(e) => updateTime(idx, e.target.value)} style={{ width: 140 }} />
                {times.length > 1 && <button type="button" className="secondary" onClick={() => removeTime(idx)}>Retirer</button>}
              </div>
            ))}
            <button type="button" className="secondary" onClick={addTime}>+ Ajouter une heure</button>
          </div>

          {error && <div className="error-box">{error}</div>}
          <div style={{ marginTop: 14 }}>
            <button type="submit" disabled={creating}>{creating ? "Création…" : "Programmer"}</button>
          </div>
        </form>
      )}

      <div className="stack">
        {schedules.map((s) => (
          <div key={s.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{s.messageTemplate.name}</strong>
              <span className={`badge ${s.active ? "ok" : "muted"}`}>{s.active ? "Actif" : "Inactif"}</span>
            </div>
            <p className="muted">
              {s.repeatMode === "DAILY" ? "Tous les jours" : s.daysOfWeek.map((d) => DAYS[d]).join(", ")} · {s.times.join(", ")}
            </p>
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
