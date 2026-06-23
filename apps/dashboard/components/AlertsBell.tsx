"use client";

import { useEffect, useRef, useState } from "react";
import { useHub } from "./HubProvider";
import { Bell, ShieldAlert, X } from "lucide-react";
import { timeAgo } from "@/lib/format";

type Alert = {
  id: string;
  kind: string;
  severity: string;
  message: string;
  createdAt: string;
  hostname?: string | null;
  label?: string | null;
};

const KIND: Record<string, { label: string; color: string }> = {
  close_attempt: { label: "Tentativa de fechar o agente", color: "text-warn" },
  agent_down: { label: "Agente encerrado (reiniciado)", color: "text-danger" },
  restarted: { label: "Agente reiniciado", color: "text-accent2" },
};

export default function AlertsBell() {
  const hub = useHub();
  const [list, setList] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Alert | null>(null);
  const toastTimer = useRef<any>(null);

  async function load() {
    try {
      const r = await fetch("/api/alerts", { cache: "no-store" });
      const j = await r.json();
      if (j.alerts) {
        setList(j.alerts);
        setUnread(j.unread || 0);
      }
    } catch {}
  }

  useEffect(() => {
    load();
    const off = hub.on("alert", (m: any) => {
      const a: Alert = {
        id: m.id,
        kind: m.kind,
        severity: m.severity,
        message: m.message,
        createdAt: m.createdAt || new Date().toISOString(),
        hostname: m.hostname,
      };
      setList((prev) => [a, ...prev].slice(0, 50));
      setUnread((n) => n + 1);
      setToast(a);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 8000);
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markRead() {
    setUnread(0);
    try {
      await fetch("/api/alerts", { method: "POST" });
    } catch {}
  }

  function name(a: Alert) {
    return a.label || a.hostname || "máquina";
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => {
            setOpen((o) => !o);
            if (!open && unread > 0) markRead();
          }}
          className="relative flex items-center justify-center h-9 w-9 rounded-lg bg-panel2 border border-border text-muted hover:text-white"
          title="Alertas de segurança"
        >
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-danger text-white rounded-full text-[10px] min-w-[18px] h-[18px] px-1 flex items-center justify-center font-semibold">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute top-full mt-2 right-0 w-80 card shadow-2xl z-40 max-h-80 overflow-y-auto">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between sticky top-0 bg-panel">
              <span className="text-xs font-medium">Alertas de segurança</span>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-white">
                <X size={14} />
              </button>
            </div>
            {list.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted text-center">Nenhum alerta.</div>
            ) : (
              list.map((a) => {
                const meta = KIND[a.kind] || { label: a.kind, color: "text-muted" };
                return (
                  <div key={a.id} className="px-3 py-2 border-b border-border/50 last:border-0">
                    <div className={`text-xs font-medium flex items-center gap-1.5 ${meta.color}`}>
                      <ShieldAlert size={12} /> {meta.label}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {name(a)} · {timeAgo(a.createdAt)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Toast ao vivo */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 card border-danger/50 bg-panel shadow-2xl w-80 p-3 animate-in">
          <div className="flex items-start gap-2">
            <ShieldAlert size={18} className="text-danger shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{(KIND[toast.kind] || { label: toast.kind }).label}</div>
              <div className="text-xs text-muted mt-0.5">
                {toast.hostname || "máquina"} · {toast.message}
              </div>
            </div>
            <button onClick={() => setToast(null)} className="text-muted hover:text-white">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
