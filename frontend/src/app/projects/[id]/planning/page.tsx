"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface Post {
  id: string;
  scheduledFor: string;
  status: string;
  messageTemplate: { name: string };
  session?: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Programmé", PROCESSING: "En cours", PUBLISHED: "Publié", FAILED: "Échec", CANCELLED: "Annulé",
};
const STATUS_CLASS: Record<string, string> = {
  SCHEDULED: "muted", PROCESSING: "warn", PUBLISHED: "ok", FAILED: "err", CANCELLED: "muted",
};

export default function PlanningPage() {
  const { id } = useParams<{ id: string }>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const data = await apiFetch<Post[]>(`/api/projects/${id}/planning`);
      setPosts(data);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur de chargement.");
    }
  }
  useEffect(() => { load(); }, [id]);

  async function cancelPost(postId: string) {
    if (!confirm("Annuler cette publication ?")) return;
    await apiFetch(`/api/projects/${id}/posts/${postId}/cancel`, { method: "POST" });
    await load();
  }

  async function deletePost(postId: string) {
    if (!confirm("Supprimer définitivement cette publication annulée ? Cette action est irréversible.")) return;
    await apiFetch(`/api/projects/${id}/posts/${postId}`, { method: "DELETE" });
    await load();
  }

  const scheduledIds = posts.filter((p) => p.status === "SCHEDULED").map((p) => p.id);
  const cancelledIds = posts.filter((p) => p.status === "CANCELLED").map((p) => p.id);
  const selectableIds = [...scheduledIds, ...cancelledIds];
  const allSelected = selectableIds.length > 0 && selected.size === selectableIds.length;

  const selectedScheduled = Array.from(selected).filter((pid) => scheduledIds.includes(pid));
  const selectedCancelled = Array.from(selected).filter((pid) => cancelledIds.includes(pid));

  function toggleOne(postId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function cancelSelected() {
    if (selectedScheduled.length === 0) return;
    if (!confirm(`Annuler les ${selectedScheduled.length} publication(s) sélectionnée(s) ?`)) return;
    setCancelling(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/posts/bulk-cancel`, {
        method: "POST",
        body: JSON.stringify({ postIds: selectedScheduled }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Annulation groupée impossible.");
    } finally {
      setCancelling(false);
    }
  }

  async function deleteSelected() {
    if (selectedCancelled.length === 0) return;
    if (!confirm(`Supprimer définitivement les ${selectedCancelled.length} publication(s) annulée(s) sélectionnée(s) ? Cette action est irréversible.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${id}/posts/bulk-delete`, {
        method: "POST",
        body: JSON.stringify({ postIds: selectedCancelled }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Suppression groupée impossible.");
    } finally {
      setDeleting(false);
    }
  }

  const grouped = posts.reduce<Record<string, Post[]>>((acc, p) => {
    const day = new Date(p.scheduledFor).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    (acc[day] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <h1>Planning</h1>
      {error && <div className="error-box">{error}</div>}

      {selectableIds.length > 0 && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button type="button" className="secondary" onClick={toggleSelectAll}>
            {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
          </button>
          <button type="button" className="danger" onClick={cancelSelected} disabled={selectedScheduled.length === 0 || cancelling}>
            {cancelling ? "Annulation…" : `Annuler la sélection${selectedScheduled.length > 0 ? ` (${selectedScheduled.length})` : ""}`}
          </button>
          <button type="button" className="danger" onClick={deleteSelected} disabled={selectedCancelled.length === 0 || deleting}>
            {deleting ? "Suppression…" : `Supprimer la sélection${selectedCancelled.length > 0 ? ` (${selectedCancelled.length})` : ""}`}
          </button>
        </div>
      )}

      {Object.keys(grouped).length === 0 && <p className="muted">Aucune publication programmée sur les 30 prochains jours.</p>}
      {Object.entries(grouped).map(([day, items]) => (
        <div key={day} className="card">
          <h3>{day}</h3>
          <table>
            <thead><tr><th></th><th>Heure</th><th>Message</th><th>Session</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    {(p.status === "SCHEDULED" || p.status === "CANCELLED") && (
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} />
                    )}
                  </td>
                  <td>{new Date(p.scheduledFor).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{p.messageTemplate.name}</td>
                  <td>{p.session?.name ?? "—"}</td>
                  <td><span className={`badge ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                  <td>
                    {p.status === "SCHEDULED" && <button className="secondary" onClick={() => cancelPost(p.id)}>Annuler</button>}
                    {p.status === "CANCELLED" && <button className="danger" onClick={() => deletePost(p.id)}>Supprimer définitivement</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
