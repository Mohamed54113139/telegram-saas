"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface Suggestion {
  id: string;
  currentInstructions: string | null;
  suggestedInstructions: string;
  reasoning: string;
  createdAt: string;
  messageTemplate: { name: string };
}

export default function SuggestionsPage() {
  const { id } = useParams<{ id: string }>();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const data = await apiFetch<Suggestion[]>(`/api/projects/${id}/suggestions`);
    setSuggestions(data);
  }
  useEffect(() => { load(); }, [id]);

  async function handleApprove(suggestionId: string) {
    setBusyId(suggestionId);
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/suggestions/${suggestionId}/approve`, { method: "POST", body: JSON.stringify({}) });
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approbation impossible.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(suggestionId: string) {
    setBusyId(suggestionId);
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/suggestions/${suggestionId}/reject`, { method: "POST", body: JSON.stringify({}) });
      setSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rejet impossible.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1>Suggestions</h1>
      <p className="muted">Propositions d'amélioration des instructions personnalisées, générées à partir des retours 👍/👎 accumulés. Rien n'est jamais appliqué automatiquement.</p>

      {error && <div className="error-box">{error}</div>}

      <div className="stack">
        {suggestions.map((s) => (
          <div key={s.id} className="card">
            <h2>{s.messageTemplate.name}</h2>
            <h3>Instructions actuelles</h3>
            <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{s.currentInstructions || "(aucune)"}</p>
            <h3>Instructions suggérées</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{s.suggestedInstructions}</p>
            <h3>Raisonnement</h3>
            <p className="muted">{s.reasoning}</p>
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => handleApprove(s.id)} disabled={busyId === s.id}>Approuver</button>
              <button type="button" className="danger" onClick={() => handleReject(s.id)} disabled={busyId === s.id}>Rejeter</button>
            </div>
          </div>
        ))}
        {suggestions.length === 0 && <p className="muted">Aucune suggestion en attente.</p>}
      </div>
    </div>
  );
}
