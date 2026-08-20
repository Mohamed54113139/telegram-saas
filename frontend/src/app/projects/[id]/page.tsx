"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface Dashboard {
  project: { id: string; name: string };
  telegramStatus: string;
  channelTitle: string | null;
  nextPost: any;
  nextSession: any;
  scheduledCount: number;
  publishedCount: number;
  failedCount: number;
}

export default function ProjectDashboard() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Dashboard | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; issues: string[] } | null>(null);

  async function load() {
    const d = await apiFetch<Dashboard>(`/api/projects/${id}/dashboard`);
    setData(d);
    const v = await apiFetch<{ valid: boolean; issues: string[] }>(`/api/projects/${id}/validate`);
    setValidation(v);
  }

  useEffect(() => { load(); }, [id]);

  if (!data) return <p className="muted">Chargement…</p>;

  return (
    <div>
      <h1>{data.project.name}</h1>

      {data.failedCount > 0 && (
        <div className="error-box">⚠ {data.failedCount} publication(s) nécessitent votre attention (voir Historique).</div>
      )}

      {validation && !validation.valid && (
        <div className="error-box">
          Configuration incomplète avant activation :
          <ul style={{ margin: "6px 0 0 18px" }}>
            {validation.issues.map((i, idx) => <li key={idx}>{i}</li>)}
          </ul>
        </div>
      )}

      <div className="grid">
        <div className="card">
          <h3>Statut Telegram</h3>
          <span className={`badge ${data.telegramStatus === "CONNECTED" ? "ok" : "err"}`}>
            {data.telegramStatus === "CONNECTED" ? `Connecté${data.channelTitle ? " · " + data.channelTitle : ""}` : "Non connecté"}
          </span>
        </div>
        <div className="card">
          <h3>Prochaine publication</h3>
          <p>{data.nextPost ? new Date(data.nextPost.scheduledFor).toLocaleString("fr-FR") : "Aucune"}</p>
          {data.nextPost && <p className="muted">{data.nextPost.messageTemplate?.name}</p>}
        </div>
        <div className="card">
          <h3>Prochaine session</h3>
          <p>{data.nextSession ? new Date(data.nextSession.startTime).toLocaleString("fr-FR") : "Aucune"}</p>
        </div>
        <div className="card">
          <h3>Publications</h3>
          <p><span className="badge muted">{data.scheduledCount} programmées</span> <span className="badge ok">{data.publishedCount} réussies</span> <span className="badge err">{data.failedCount} échouées</span></p>
        </div>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <Link className="btn" href={`/projects/${id}/messages`}>+ Créer un message</Link>
        <Link className="btn secondary" href={`/projects/${id}/sessions`}>+ Créer une session</Link>
        <Link className="btn secondary" href={`/projects/${id}/planning`}>Voir le planning</Link>
        <Link className="btn secondary" href={`/projects/${id}/history`}>Voir l'historique</Link>
      </div>
    </div>
  );
}
