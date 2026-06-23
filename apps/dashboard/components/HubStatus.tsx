"use client";

import { useEffect, useState } from "react";
import { Server, Circle } from "lucide-react";

type Status = { online: boolean; lastSeenSeconds: number | null };

export default function HubStatus() {
  const [s, setS] = useState<Status>({ online: false, lastSeenSeconds: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/hub/status", { cache: "no-store" });
        const j = await r.json();
        if (alive) {
          setS({ online: !!j.online, lastSeenSeconds: j.lastSeenSeconds });
          setLoaded(true);
        }
      } catch {
        if (alive) setLoaded(true);
      }
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const online = s.online;
  return (
    <div
      className="flex items-center gap-2 h-9 px-3 rounded-lg bg-panel2 border border-border text-xs"
      title={
        online
          ? `Servidor (hub) ativo — ultimo sinal ha ${s.lastSeenSeconds ?? 0}s`
          : "Servidor (hub) offline — inicie o OneDesk Server na maquina host"
      }
    >
      <Server size={14} className="text-muted shrink-0" />
      <span className="text-muted hidden sm:inline">Servidor</span>
      {!loaded ? (
        <span className="text-muted">…</span>
      ) : (
        <span className={`flex items-center gap-1.5 font-medium ${online ? "text-ok" : "text-danger"}`}>
          <Circle size={7} className="fill-current" />
          {online ? "online" : "offline"}
        </span>
      )}
    </div>
  );
}
