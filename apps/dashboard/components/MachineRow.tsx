"use client";

import { useState } from "react";
import { MoreVertical, Info, MonitorPlay, Bell, Pencil, Trash2, Circle, Lock, ArrowUpCircle } from "lucide-react";
import { pct, timeAgo } from "@/lib/format";
import type { MachineCardActions } from "./MachineCard";

type Stat = { cpu: number; memUsed: number; memTotal: number; diskUsed: number; diskTotal: number } | null;

export default function MachineRow({
  machine, stat, online, outdated, actions,
}: {
  machine: any; stat: Stat; online: boolean; outdated?: boolean; actions: MachineCardActions;
}) {
  const [menu, setMenu] = useState(false);
  const cpu = stat ? Math.round(stat.cpu) : 0;
  const memP = stat ? pct(stat.memUsed, stat.memTotal) : 0;
  const diskP = stat ? pct(stat.diskUsed, stat.diskTotal) : 0;
  const bar = (v: number) => (v > 85 ? "bg-danger" : v > 65 ? "bg-warn" : "bg-accent");

  return (
    <div className={`flex items-center gap-4 px-4 py-2.5 hover:bg-panel2/40 ${online ? "" : "opacity-70"}`}>
      <Circle size={9} className={`shrink-0 fill-current ${online ? "text-ok" : "text-muted"}`} />

      <button onClick={actions.onOpen} className="min-w-0 w-48 text-left shrink-0">
        <div className="font-medium truncate flex items-center gap-1.5">
          {machine.locked && <Lock size={12} className="text-warn" />}
          {machine.label || machine.hostname || "Sem nome"}
        </div>
        <div className="text-xs text-muted truncate">
          {online ? machine.username || machine.localIp || "—" : `visto ${timeAgo(machine.lastSeen)}`}
        </div>
      </button>

      <Mini label="CPU" v={online ? cpu : 0} cls={bar(cpu)} />
      <Mini label="RAM" v={memP} cls={bar(memP)} />
      <Mini label="Disco" v={diskP} cls={bar(diskP)} />

      <div className="hidden xl:block w-20 text-xs text-muted font-mono shrink-0">
        v{machine.agentVersion || "—"}
      </div>

      {outdated && online && (
        <button onClick={actions.onUpdate} className="badge bg-accent/15 text-accent hover:bg-accent/25 shrink-0">
          <ArrowUpCircle size={11} /> atualizar
        </button>
      )}

      <div className="flex-1" />

      <button onClick={actions.onRemote} disabled={!online} className="btn-ghost py-1.5 shrink-0 disabled:opacity-40">
        <MonitorPlay size={14} /> Acesso
      </button>

      <div className="relative shrink-0">
        <button onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}
          className={`p-1.5 rounded-lg hover:bg-panel2 ${menu ? "text-white bg-panel2" : "text-muted hover:text-white"}`}>
          <MoreVertical size={16} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-full mt-1 w-44 card shadow-2xl z-30 py-1">
              <Item icon={<Info size={14} />} label="Informações" onClick={() => { setMenu(false); actions.onOpen(); }} />
              <Item icon={<MonitorPlay size={14} />} label="Acesso remoto" onClick={() => { setMenu(false); actions.onRemote(); }} />
              <Item icon={<Bell size={14} />} label="Enviar aviso" disabled={!online} onClick={() => { setMenu(false); actions.onNotify(); }} />
              {outdated && <Item icon={<ArrowUpCircle size={14} />} label="Forçar atualização" disabled={!online} onClick={() => { setMenu(false); actions.onUpdate(); }} />}
              <div className="my-1 border-t border-border" />
              <Item icon={<Pencil size={14} />} label="Renomear" onClick={() => { setMenu(false); actions.onRename(); }} />
              <Item icon={<Trash2 size={14} />} label="Excluir" danger onClick={() => { setMenu(false); actions.onDelete(); }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Mini({ label, v, cls }: { label: string; v: number; cls: string }) {
  return (
    <div className="hidden md:block w-24 shrink-0">
      <div className="flex justify-between text-[11px] text-muted mb-1">
        <span>{label}</span>
        <span className="tabular-nums">{v}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-panel2 overflow-hidden">
        <div className={`h-full ${cls} transition-all`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function Item({ icon, label, onClick, danger, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors disabled:opacity-40 ${
        danger ? "text-danger hover:bg-danger/10" : "text-muted hover:text-white hover:bg-panel2"
      }`}>
      {icon}{label}
    </button>
  );
}
