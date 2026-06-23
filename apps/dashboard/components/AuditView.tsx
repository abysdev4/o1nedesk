"use client";

import { useMemo, useState } from "react";
import {
  LogIn, TerminalSquare, MonitorPlay, Camera, Bell, MapPin, Lock, LockOpen, KeyRound,
  Pencil, Trash2, Ticket, ArrowUpCircle, FileUp, Activity, Search, Filter,
} from "lucide-react";
import { timeAgo } from "@/lib/format";

type Sev = "info" | "warn" | "danger";
type Row = {
  id: string;
  action: string;
  detail: any;
  createdAt: string;
  userName: string | null;
  hostname: string | null;
  label: string | null;
};

const META: Record<string, { label: string; sev: Sev; Icon: any }> = {
  "auth:login": { label: "Login", sev: "info", Icon: LogIn },
  "terminal:open": { label: "Terminal aberto", sev: "warn", Icon: TerminalSquare },
  "screen:start": { label: "Tela remota iniciada", sev: "warn", Icon: MonitorPlay },
  screenshot: { label: "Screenshot", sev: "info", Icon: Camera },
  notify: { label: "Aviso enviado", sev: "info", Icon: Bell },
  "location:request": { label: "Localização solicitada", sev: "info", Icon: MapPin },
  "lock:on": { label: "Dispositivo bloqueado", sev: "danger", Icon: Lock },
  "lock:off": { label: "Dispositivo desbloqueado", sev: "warn", Icon: LockOpen },
  "lock:setpass": { label: "Senha de bloqueio definida", sev: "warn", Icon: KeyRound },
  "machine:rename": { label: "Máquina renomeada", sev: "info", Icon: Pencil },
  "machine:delete": { label: "Máquina excluída", sev: "danger", Icon: Trash2 },
  "ticket:create": { label: "Ticket criado", sev: "info", Icon: Ticket },
  "agent:update": { label: "Atualização forçada", sev: "warn", Icon: ArrowUpCircle },
  "file:push": { label: "Arquivo enviado", sev: "info", Icon: FileUp },
};

function meta(action: string) {
  return META[action] || { label: action, sev: "info" as Sev, Icon: Activity };
}

const SEV_STYLE: Record<Sev, { border: string; chip: string; icon: string; label: string }> = {
  info: { border: "border-l-accent2/60", chip: "bg-accent2/15 text-accent2", icon: "text-accent2", label: "Info" },
  warn: { border: "border-l-warn/70", chip: "bg-warn/15 text-warn", icon: "text-warn", label: "Atenção" },
  danger: { border: "border-l-danger/70", chip: "bg-danger/15 text-danger", icon: "text-danger", label: "Crítico" },
};

export default function AuditView({ rows }: { rows: Row[] }) {
  const [sev, setSev] = useState<Sev | "all">("all");
  const [action, setAction] = useState<string>("all");
  const [q, setQ] = useState("");

  const actions = useMemo(() => Array.from(new Set(rows.map((r) => r.action))).sort(), [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      const m = meta(r.action);
      if (sev !== "all" && m.sev !== sev) return false;
      if (action !== "all" && r.action !== action) return false;
      if (query) {
        const hay = [
          m.label, r.action, r.userName, r.label, r.hostname,
          r.detail ? JSON.stringify(r.detail) : "",
        ].join(" ").toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [rows, sev, action, q]);

  const counts = useMemo(() => {
    const c = { info: 0, warn: 0, danger: 0 };
    rows.forEach((r) => c[meta(r.action).sev]++);
    return c;
  }, [rows]);

  return (
    <>
      {/* Controles */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="flex items-center gap-1 bg-panel2 border border-border rounded-lg p-1">
          {(["all", "info", "warn", "danger"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSev(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                sev === s ? "bg-panel text-white" : "text-muted hover:text-white"
              }`}
            >
              {s === "all" ? `Todos (${rows.length})` : `${SEV_STYLE[s].label} (${counts[s]})`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Filter size={14} />
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="bg-panel2 border border-border rounded-lg px-2 py-1.5 text-xs text-white"
          >
            <option value="all">Todas as ações</option>
            {actions.map((a) => (
              <option key={a} value={a}>{meta(a).label}</option>
            ))}
          </select>
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por usuário, máquina, ação, detalhe…"
            className="input pl-9"
          />
        </div>
      </div>

      {/* Lista */}
      <div className="card divide-y divide-border/60 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-sm text-muted text-center">Nenhum evento para os filtros aplicados.</div>
        ) : (
          filtered.map((r) => {
            const m = meta(r.action);
            const st = SEV_STYLE[m.sev];
            const where = r.label || r.hostname;
            return (
              <div key={r.id} className={`px-4 py-2.5 flex items-center gap-3 border-l-2 ${st.border} hover:bg-panel2/40`}>
                <m.Icon size={16} className={`${st.icon} shrink-0`} />
                <span className="text-sm font-medium w-52 shrink-0 truncate">{m.label}</span>
                <span className={`badge ${st.chip} shrink-0`}>{st.label}</span>
                <span className="flex-1 text-xs text-muted truncate">
                  {r.userName || "sistema"}
                  {where ? ` · ${where}` : ""}
                  {r.detail ? ` · ${formatDetail(r.detail)}` : ""}
                </span>
                <span className="text-xs text-muted shrink-0">{timeAgo(r.createdAt)}</span>
              </div>
            );
          })
        )}
      </div>
      <p className="text-xs text-muted mt-3">{filtered.length} de {rows.length} eventos</p>
    </>
  );
}

function formatDetail(d: any): string {
  if (!d || typeof d !== "object") return String(d);
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ")
    .slice(0, 120);
}
