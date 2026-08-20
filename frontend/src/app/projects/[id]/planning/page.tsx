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

  async function load() {
    try {
      const data = await apiFetch<Post[]>(`/api/projects/${id}/planning`);
      setPosts(data);
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

  const grouped = posts.reduce<Record<string, Post[]>>((acc, p) => {
    const day = new Date(p.scheduledFor).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    (acc[day] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <h1>Planning</h1>
      {error && <div className="error-box">{error}</div>}
      {Object.keys(grouped).length === 0 && <p className="muted">Aucune publication programmée sur les 30 prochains jours.</p>}
      {Object.entries(grouped).map(([day, items]) => (
        <div key={day} className="card">
          <h3>{day}</h3>
          <table>
            <thead><tr><th>Heure</th><th>Message</th><th>Session</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.scheduledFor).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{p.messageTemplate.name}</td>
                  <td>{p.session?.name ?? "—"}</td>
                  <td><span className={`badge ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span></td>
                  <td>{p.status === "SCHEDULED" && <button className="secondary" onClick={() => cancelPost(p.id)}>Annuler</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
