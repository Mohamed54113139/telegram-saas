"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function Topbar() {
  const { user, logout } = useAuth();
  return (
    <div className="topbar">
      <Link href="/projects" className="brand">📡 Automatisation Telegram</Link>
      {user && (
        <div className="row">
          <span className="muted">{user.email}</span>
          <button className="secondary" onClick={logout}>Déconnexion</button>
        </div>
      )}
    </div>
  );
}
