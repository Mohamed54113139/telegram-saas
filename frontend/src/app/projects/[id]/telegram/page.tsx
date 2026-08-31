"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

interface Status {
  status: string;
  chatId?: string;
  chatTitle?: string;
  botUsername?: string;
  lastCheckedAt?: string;
  lastError?: string;
}

interface ProjectAdminSettings {
  adminNotifyChatId?: string | null;
}

export default function TelegramPage() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<Status | null>(null);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adminNotifyChatId, setAdminNotifyChatId] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);
  const [adminSaving, setAdminSaving] = useState(false);

  async function load() {
    const s = await apiFetch<Status>(`/api/projects/${id}/telegram/status`);
    setStatus(s);
    const project = await apiFetch<ProjectAdminSettings>(`/api/projects/${id}`);
    setAdminNotifyChatId(project.adminNotifyChatId ?? "");
  }

  useEffect(() => { load(); }, [id]);

  async function handleSaveAdminNotify(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    setAdminSuccess(null);
    setAdminSaving(true);
    try {
      await apiFetch(`/api/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ adminNotifyChatId: adminNotifyChatId || null }),
      });
      setAdminSuccess("Enregistré.");
    } catch (err) {
      setAdminError(err instanceof ApiError ? err.message : "Enregistrement impossible.");
    } finally {
      setAdminSaving(false);
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${id}/telegram/connect`, { method: "POST", body: JSON.stringify({ botToken, chatId }) });
      setBotToken("");
      setSuccess("Canal Telegram connecté avec succès.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${id}/telegram/test`, { method: "POST", body: JSON.stringify({}) });
      setSuccess("Message de test envoyé sur le canal.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Déconnecter ce canal Telegram ?")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/projects/${id}/telegram`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Connexion Telegram</h1>
      <p className="muted">
        1. Créez un bot via <a href="https://t.me/BotFather" target="_blank">@BotFather</a> et récupérez son token.<br />
        2. Ajoutez ce bot comme administrateur de votre canal, avec le droit de publier des messages.<br />
        3. Renseignez le token et l'identifiant du canal (ex: @moncanal ou -1001234567890) ci-dessous.
      </p>

      <div className="card">
        <h2>Statut</h2>
        {status?.status === "CONNECTED" ? (
          <div className="stack">
            <span className="badge ok">Connecté</span>
            <p>Canal : <strong>{status.chatTitle}</strong> ({status.chatId})</p>
            <p className="muted">Bot : @{status.botUsername}</p>
            <div className="row">
              <button onClick={handleTest} disabled={busy}>Envoyer un message de test</button>
              <button className="danger" onClick={handleDisconnect} disabled={busy}>Déconnecter</button>
            </div>
          </div>
        ) : (
          <span className="badge err">Non connecté</span>
        )}
        {status?.lastError && <div className="error-box">{status.lastError}</div>}
      </div>

      <div className="card">
        <h2>{status?.status === "CONNECTED" ? "Reconnecter / modifier" : "Connecter un canal"}</h2>
        <form onSubmit={handleConnect}>
          <label>Token du bot Telegram</label>
          <input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456:ABC-..." required />
          <label>Identifiant du canal</label>
          <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="@moncanal ou -1001234567890" required />
          {error && <div className="error-box">{error}</div>}
          {success && <div className="success-box">{success}</div>}
          <div style={{ marginTop: 14 }}>
            <button type="submit" disabled={busy}>{busy ? "Vérification…" : "Connecter"}</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Notifications d'échecs (admin)</h2>
        <p className="muted">
          En cas de {"3"} échecs de publication consécutifs sur ce projet, une alerte est envoyée via ce même bot vers votre chatId personnel — indépendant du canal public ci-dessus.<br />
          Pour trouver votre chatId Telegram : envoyez un message à <a href="https://t.me/userinfobot" target="_blank">@userinfobot</a>, qui vous le renvoie directement. Autre méthode : envoyez un message à votre propre bot, puis ouvrez <code>https://api.telegram.org/bot&lt;VOTRE_TOKEN&gt;/getUpdates</code> dans un navigateur et repérez la valeur <code>chat.id</code> dans la réponse JSON.
        </p>
        <form onSubmit={handleSaveAdminNotify}>
          <label>Votre chatId Telegram personnel</label>
          <input value={adminNotifyChatId} onChange={(e) => setAdminNotifyChatId(e.target.value)} placeholder="123456789" />
          {adminError && <div className="error-box">{adminError}</div>}
          {adminSuccess && <div className="success-box">{adminSuccess}</div>}
          <div style={{ marginTop: 14 }}>
            <button type="submit" disabled={adminSaving}>{adminSaving ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
