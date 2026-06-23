"use client";

import { usePathname } from "next/navigation";
import AlertsBell from "./AlertsBell";
import HubStatus from "./HubStatus";

const TITLES: Record<string, string> = {
  "/": "Frota",
  "/tickets": "Tickets",
  "/audit": "Auditoria",
};

export default function Header() {
  const path = usePathname();
  const title =
    path.startsWith("/machines") ? "Máquina" : TITLES[path] || "OneDesk";

  return (
    <header className="h-14 shrink-0 border-b border-border bg-panel/60 backdrop-blur flex items-center justify-between px-5">
      <div className="text-sm font-medium text-muted">{title}</div>
      <div className="flex items-center gap-3">
        <HubStatus />
        <AlertsBell />
      </div>
    </header>
  );
}
