"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import Topbar from "@/components/Topbar";

const TABS = [
  { href: "", label: "Dashboard" },
  { href: "/messages", label: "Messages" },
  { href: "/sources", label: "Sources" },
  { href: "/variables", label: "Variables" },
  { href: "/schedules", label: "Programmation" },
  { href: "/sessions", label: "Sessions" },
  { href: "/planning", label: "Planning" },
  { href: "/history", label: "Historique" },
  { href: "/telegram", label: "Telegram" },
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const id = params.id as string;
  const base = `/projects/${id}`;

  return (
    <RequireAuth>
      <Topbar />
      <div className="container">
        <Link href="/projects" className="muted">← Mes projets</Link>
        <nav className="tabs" style={{ marginTop: 10 }}>
          {TABS.map((tab) => {
            const href = `${base}${tab.href}`;
            const active = pathname === href || (tab.href === "" && pathname === base);
            return (
              <Link key={tab.href} href={href} className={active ? "active" : ""}>
                {tab.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </RequireAuth>
  );
}
