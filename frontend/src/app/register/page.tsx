"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(email, password, name || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Inscription impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Créer un compte</h1>
      <p className="muted">Commencez à automatiser vos publications Telegram.</p>
      <form className="card" onSubmit={handleSubmit}>
        <label>Nom (optionnel)</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Mot de passe (8 caractères min.)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        {error && <div className="error-box">{error}</div>}
        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={loading}>{loading ? "Création…" : "Créer mon compte"}</button>
        </div>
      </form>
      <p className="muted">Déjà un compte ? <Link href="/login">Se connecter</Link></p>
    </div>
  );
}
