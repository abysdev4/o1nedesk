"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Monitor, ScrollText, Ticket, LogOut } from "lucide-react";

const nav = [
  { href: "/", label: "Frota", icon: Monitor },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/audit", label: "Auditoria", icon: ScrollText },
];

export default function Sidebar({ user }: { user: { name: string; email: string; role: string } }) {
  const path = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-panel flex flex-col">
      <div className="h-16 flex items-center px-5 border-b border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-white.png" alt="OneDesk" className="h-7 w-auto" />
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {nav.map((item) => {
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "bg-accent/15 text-white" : "text-muted hover:text-white hover:bg-panel2"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="h-8 w-8 rounded-full bg-panel2 border border-border flex items-center justify-center text-sm font-medium">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{user.name}</div>
            <div className="text-xs text-muted truncate">{user.role}</div>
          </div>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="btn-ghost w-full mt-2 justify-start">
            <LogOut size={16} /> Sair
          </button>
        </form>
      </div>
    </aside>
  );
}
