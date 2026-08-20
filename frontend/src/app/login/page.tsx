"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Connexion impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Connexion</h1>
      <p className="muted">Accédez à votre plateforme d'automatisation Telegram.</p>
      <form className="card" onSubmit={handleSubmit}>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Mot de passe</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="error-box">{error}</div>}
        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={loading}>{loading ? "Connexion…" : "Se connecter"}</button>
        </div>
      </form>
      <p className="muted">Pas encore de compte ? <Link href="/register">Créer un compte</Link></p>
    </div>
  );
}
