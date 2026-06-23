"use client";

import { useState } from "react";
import {
  MoreVertical, Info, MonitorPlay, Bell, Pencil, Trash2,
  Circle, Lock, ArrowUpCircle,
} from "lucide-react";
import { bytes, pct, uptime, timeAgo } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";

type Stat = {
  cpu: number; memUsed: number; memTotal: number;
  diskUsed: number; diskTotal: number; netUp: number; netDown: number; uptime: number;
} | null;

export type MachineCardActions = {
  onOpen: () => void;
  onRemote: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNotify: () => void;
  onUpdate: () => void;
};

// ---- gauge de pontos em arco (semicirculo) ----
function lerpHex(a: string, b: string, t: number) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((x, i) => Math.round(x + (pb[i] - x) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function ArcGauge({ value, online }: { value: number; online: boolean }) {
  const rings = [94, 81, 68, 55];
  const N = 26;
  const frac = Math.max(0, Math.min(1, value / 100));
  const cx = 110, cy = 120;
  const dots: JSX.Element[] = [];
  rings.forEach((R, ri) => {
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const ang = Math.PI - f * Math.PI;
      const x = cx + R * Math.cos(ang);
      const y = cy - R * Math.sin(ang);
      const on = online && f <= frac;
      const color = on ? lerpHex("#3b82f6", "#22c55e", f) : "#1b2433";
      const op = on ? 1 - ri * 0.14 : 0.55 - ri * 0.08;
      dots.push(<circle key={`${ri}-${i}`} cx={x} cy={y} r={3.1} fill={color} opacity={op} />);
    }
  });
  return (
    <svg viewBox="0 0 220 132" className="w-full">
      {dots}
    </svg>
  );
}

export default function MachineCard({
  machine, stat, online, outdated, actions,
}: {
  machine: any; stat: Stat; online: boolean; outdated?: boolean; actions: MachineCardActions;
}) {
  const [menu, setMenu] = useState(false);
  const cpu = stat ? Math.round(stat.cpu) : 0;
  const cpuAnim = Math.round(useCountUp(online && stat ? cpu : 0));
  const memP = stat ? pct(stat.memUsed, stat.memTotal) : 0;
  const diskP = stat ? pct(stat.diskUsed, stat.diskTotal) : 0;

  return (
    <div className={`card p-4 flex flex-col relative transition-colors ${online ? "hover:border-accent/40" : "opacity-75"}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <button onClick={actions.onOpen} className="flex items-center gap-2 min-w-0 text-left">
          {machine.locked && <Lock size={14} className="text-warn shrink-0" />}
          <div className="min-w-0">
            <div className="font-medium truncate leading-tight">{machine.label || machine.hostname || "Sem nome"}</div>
            <div className="text-xs text-muted truncate">
              {online ? machine.username || machine.localIp || "—" : `visto ${timeAgo(machine.lastSeen)}`}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {outdated && online && (
            <button onClick={actions.onUpdate} className="badge bg-accent/15 text-accent hover:bg-accent/25" title="Atualizar agente">
              <ArrowUpCircle size={11} /> atualizar
            </button>
          )}
          <span className={`badge ${online ? "bg-ok/15 text-ok" : "bg-panel2 text-muted"}`}>
            <Circle size={7} className="fill-current" />
            {online ? "online" : "offline"}
          </span>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
              className={`p-1.5 rounded-lg hover:bg-panel2 ${menu ? "text-white bg-panel2" : "text-muted hover:text-white"}`}
            >
              <MoreVertical size={16} />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-44 card shadow-2xl z-30 py-1">
                  <MenuItem icon={<Info size={14} />} label="Informações" onClick={() => { setMenu(false); actions.onOpen(); }} />
                  <MenuItem icon={<MonitorPlay size={14} />} label="Acesso remoto" onClick={() => { setMenu(false); actions.onRemote(); }} />
                  <MenuItem icon={<Bell size={14} />} label="Enviar aviso" disabled={!online} onClick={() => { setMenu(false); actions.onNotify(); }} />
                  {outdated && <MenuItem icon={<ArrowUpCircle size={14} />} label="Forçar atualização" disabled={!online} onClick={() => { setMenu(false); actions.onUpdate(); }} />}
                  <div className="my-1 border-t border-border" />
                  <MenuItem icon={<Pencil size={14} />} label="Renomear" onClick={() => { setMenu(false); actions.onRename(); }} />
                  <MenuItem icon={<Trash2 size={14} />} label="Excluir" danger onClick={() => { setMenu(false); actions.onDelete(); }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Gauge + valor central */}
      <div className="relative">
        <ArcGauge value={cpu} online={online} />
        <div className="absolute left-0 right-0 bottom-1 text-center pointer-events-none">
          <div className="text-[11px] text-muted tracking-widest font-medium">USO DE CPU</div>
          <div className="text-4xl font-bold tracking-tight tabular-nums leading-none mt-0.5">
            {cpuAnim}
            <span className="text-xl text-muted font-semibold">%</span>
          </div>
        </div>
      </div>

      {/* Duas metricas */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Metric color="#3b82f6" label="Memória" value={`${memP}%`} sub={stat ? bytes(stat.memUsed) : "—"} />
        <Metric color="#22c55e" label="Disco" value={`${diskP}%`} sub={stat ? bytes(stat.diskUsed) : "—"} />
      </div>

      {/* Acao */}
      <button onClick={actions.onRemote} disabled={!online} className="btn-ghost w-full mt-4 disabled:opacity-40">
        <MonitorPlay size={15} /> Acesso remoto
      </button>
    </div>
  );
}

function Metric({ color, label, value, sub }: { color: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-1 h-9 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: color }} />
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
        <div className="text-[11px] text-muted truncate">{sub}</div>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? "text-danger hover:bg-danger/10" : "text-muted hover:text-white hover:bg-panel2"
      }`}>
      {icon}{label}
    </button>
  );
}
