"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";

interface PlanMessage {
  name: string;
  content: string;
  autoEdit: boolean;
  editLevel: "LEGERE" | "NORMALE" | "IMPORTANTE";
  similarity: number;
}
interface PlanSchedule {
  messageIndex: number;
  repeatMode: "DAILY" | "CUSTOM_DAYS";
  daysOfWeek: number[];
  times: string[];
}
interface PlanSource {
  name: string;
  feedUrlHint: string;
  mode: "AUTO" | "MANUAL";
  digestMode: boolean;
  checkIntervalMinutes: number;
}
interface AssistantPlan {
  summary: string;
  messages: PlanMessage[];
  schedules: PlanSchedule[];
  sources: PlanSource[];
}

const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function AssistantPage() {
  const { id } = useParams<{ id: string }>();
  const [description, setDescription] = useState("");
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [realUrls, setRealUrls] = useState<string[]>([]);
  const [proposing, setProposing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ messagesCreated: number; schedulesCreated: number } | null>(null);

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    setProposing(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch<AssistantPlan>(`/api/projects/${id}/assistant/propose`, {
        method: "POST",
        body: JSON.stringify({ description }),
      });
      setPlan(data);
      setRealUrls(data.sources.map(() => ""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de générer une proposition.");
    } finally {
      setProposing(false);
    }
  }

  function updateMessage(idx: number, patch: Partial<PlanMessage>) {
    if (!plan) return;
    setPlan({ ...plan, messages: plan.messages.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });
  }

  function updateSchedule(idx: number, patch: Partial<PlanSchedule>) {
    if (!plan) return;
    setPlan({ ...plan, schedules: plan.schedules.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  }

  function updateScheduleTime(scheduleIdx: number, timeIdx: number, value: string) {
    if (!plan) return;
    const times = plan.schedules[scheduleIdx].times.map((t, i) => (i === timeIdx ? value : t));
    updateSchedule(scheduleIdx, { times });
  }

  function toggleScheduleDay(scheduleIdx: number, day: number) {
    if (!plan) return;
    const current = plan.schedules[scheduleIdx].daysOfWeek;
    const daysOfWeek = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    updateSchedule(scheduleIdx, { daysOfWeek });
  }

  function updateSource(idx: number, patch: Partial<PlanSource>) {
    if (!plan) return;
    setPlan({ ...plan, sources: plan.sources.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  }

  function updateRealUrl(idx: number, value: string) {
    setRealUrls((prev) => prev.map((u, i) => (i === idx ? value : u)));
  }

  async function handleApply() {
    if (!plan) return;
    setApplying(true);
    setError(null);
    try {
      // L'indication de l'IA (feedUrlHint) n'est JAMAIS envoyée comme une URL réelle :
      // on la remplace par ce que l'utilisateur a lui-même saisi (vide si rien n'a été
      // renseigné, auquel cas le backend ignore cette source lors de la création).
      const outgoingPlan: AssistantPlan = {
        ...plan,
        sources: plan.sources.map((s, i) => ({ ...s, feedUrlHint: realUrls[i] ?? "" })),
      };
      const data = await apiFetch<{ success: boolean; messagesCreated: number; schedulesCreated: number }>(`/api/projects/${id}/assistant/apply`, {
        method: "POST",
        body: JSON.stringify({ plan: outgoingPlan }),
      });
      setResult(data);
      setPlan(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <h1>Assistant IA</h1>
      <p className="muted">Décrivez ce que vous voulez publier (types de contenus, horaires, sources). L'IA propose une configuration complète, que vous pouvez relire et modifier — rien n'est créé tant que vous n'avez pas validé.</p>

      <div className="card">
        <form onSubmit={handlePropose}>
          <label>Décrivez ce que vous voulez publier</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex : publier chaque matin à 8h un message de bienvenue, et republier les actualités d'un flux RSS de foot dès qu'elles sortent."
            style={{ minHeight: 100 }}
            required
            minLength={5}
          />
          {error && <div className="error-box">{error}</div>}
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={proposing}>{proposing ? "Génération…" : "Proposer une configuration"}</button>
          </div>
        </form>
      </div>

      {result && (
        <div className="card">
          <div className="success-box">Configuration créée : {result.messagesCreated} message(s), {result.schedulesCreated} programmation(s).</div>
          <div className="row" style={{ marginTop: 10 }}>
            <Link href={`/projects/${id}/messages`}>Voir les messages</Link>
            <Link href={`/projects/${id}/schedules`}>Voir la programmation</Link>
            <Link href={`/projects/${id}/sources`}>Voir les sources</Link>
          </div>
        </div>
      )}

      {plan && (
        <div className="card">
          <h2>Proposition</h2>
          <p className="muted">{plan.summary}</p>

          {plan.messages.length > 0 && (
            <>
              <h3>Messages</h3>
              <div className="stack">
                {plan.messages.map((m, idx) => (
                  <div key={idx} className="card">
                    <label>Nom</label>
                    <input value={m.name} onChange={(e) => updateMessage(idx, { name: e.target.value })} />
                    <label>Contenu</label>
                    <textarea value={m.content} onChange={(e) => updateMessage(idx, { content: e.target.value })} style={{ minHeight: 100 }} />
                    <label className="row" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={m.autoEdit} onChange={(e) => updateMessage(idx, { autoEdit: e.target.checked })} /> Reformulation IA
                    </label>
                    {m.autoEdit && (
                      <>
                        <label>Niveau</label>
                        <select value={m.editLevel} onChange={(e) => updateMessage(idx, { editLevel: e.target.value as PlanMessage["editLevel"] })}>
                          <option value="LEGERE">Légère</option>
                          <option value="NORMALE">Normale</option>
                          <option value="IMPORTANTE">Importante</option>
                        </select>
                        <label>Similarité : {m.similarity}%</label>
                        <input type="range" min={0} max={100} value={m.similarity} onChange={(e) => updateMessage(idx, { similarity: parseInt(e.target.value) })} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {plan.schedules.length > 0 && (
            <>
              <h3>Programmations</h3>
              <div className="stack">
                {plan.schedules.map((s, idx) => (
                  <div key={idx} className="card">
                    <p className="muted">Message : {plan.messages[s.messageIndex]?.name ?? `#${s.messageIndex}`}</p>
                    <label>Répétition</label>
                    <select value={s.repeatMode} onChange={(e) => updateSchedule(idx, { repeatMode: e.target.value as PlanSchedule["repeatMode"] })}>
                      <option value="DAILY">Tous les jours</option>
                      <option value="CUSTOM_DAYS">Jours personnalisés</option>
                    </select>
                    {s.repeatMode === "CUSTOM_DAYS" && (
                      <div className="row" style={{ marginTop: 8 }}>
                        {DAYS.map((d, dayIdx) => (
                          <label key={dayIdx} className="row" style={{ marginTop: 0 }}>
                            <input type="checkbox" checked={s.daysOfWeek.includes(dayIdx)} onChange={() => toggleScheduleDay(idx, dayIdx)} /> {d}
                          </label>
                        ))}
                      </div>
                    )}
                    <label>Heures</label>
                    <div className="row">
                      {s.times.map((t, timeIdx) => (
                        <input key={timeIdx} type="time" value={t} onChange={(e) => updateScheduleTime(idx, timeIdx, e.target.value)} style={{ width: 140 }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {plan.sources.length > 0 && (
            <>
              <h3>Sources de veille</h3>
              <div className="stack">
                {plan.sources.map((s, idx) => (
                  <div key={idx} className="card">
                    <label>Nom</label>
                    <input value={s.name} onChange={(e) => updateSource(idx, { name: e.target.value })} />
                    <p className="muted">Indication de l'IA (une description, pas une vraie URL) : {s.feedUrlHint}</p>
                    <label>URL réelle du flux RSS (à renseigner vous-même — obligatoire pour que cette source soit créée)</label>
                    <input value={realUrls[idx] ?? ""} onChange={(e) => updateRealUrl(idx, e.target.value)} placeholder="https://…" />
                    <label className="row" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={s.digestMode} onChange={(e) => updateSource(idx, { digestMode: e.target.checked })} /> Mode digest quotidien
                    </label>
                    {!s.digestMode && (
                      <>
                        <label>Mode</label>
                        <select value={s.mode} onChange={(e) => updateSource(idx, { mode: e.target.value as PlanSource["mode"] })}>
                          <option value="MANUAL">Manuel</option>
                          <option value="AUTO">Automatique</option>
                        </select>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 14 }}>
            <button type="button" onClick={handleApply} disabled={applying}>{applying ? "Création…" : "Créer cette configuration"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
