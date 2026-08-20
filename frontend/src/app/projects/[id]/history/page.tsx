"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

interface Post {
  id: string;
  scheduledFor: string;
  publishedAt?: string | null;
  status: string;
  generatedContent?: string | null;
  lastError?: string | null;
  messageTemplate: { name: string };
}

const STATUS_LABEL: Record<string, string> = { PUBLISHED: "Publié", FAILED: "Échec", CANCELLED: "Annulé" };
const STATUS_CLASS: Record<string, string> = { PUBLISHED: "ok", FAILED: "err", CANCELLED: "muted" };

export default function HistoryPage() {
  const { id } = useParams<{ id: string }>();
  const [posts, setPosts] = useState<Post[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");

  async function load() {
    const query = filter ? `?status=${filter}` : "";
    const data = await apiFetch<Post[]>(`/api/projects/${id}/history${query}`);
    setPosts(data);
  }
  useEffect(() => { load(); }, [id, filter]);

  return (
    <div>
      <h1>Historique</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className={filter === "" ? "" : "secondary"} onClick={() => setFilter("")}>Tout</button>
        <button className={filter === "PUBLISHED" ? "" : "secondary"} onClick={() => setFilter("PUBLISHED")}>Publiées</button>
        <button className={filter === "FAILED" ? "" : "secondary"} onClick={() => setFilter("FAILED")}>Échouées</button>
        <button className={filter === "CANCELLED" ? "" : "secondary"} onClick={() => setFilter("CANCELLED")}>Annulées</button>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Date prévue</th><th>Message</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {posts.map((p) => (
              <>
                <tr key={p.id} onClick={() => setExpanded(expanded === p.id ? null : p.id)} style={{ cursor: "pointer" }}>
                  <td>{new Date(p.scheduledFor).toLocaleString("fr-FR")}</td>
                  <td>{p.messageTemplate.name}</td>
                  <td><span className={`badge ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status] ?? p.status}</span></td>
                  <td className="muted">{expanded === p.id ? "▲" : "▼"}</td>
                </tr>
                {expanded === p.id && (
                  <tr>
                    <td colSpan={4}>
                      {p.publishedAt && <p className="muted">Publié le {new Date(p.publishedAt).toLocaleString("fr-FR")}</p>}
                      {p.generatedContent && <p style={{ whiteSpace: "pre-wrap" }}>{p.generatedContent}</p>}
                      {p.lastError && <div className="error-box">{p.lastError}</div>}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {posts.length === 0 && <p className="muted">Aucune publication dans l'historique.</p>}
      </div>
    </div>
  );
}
