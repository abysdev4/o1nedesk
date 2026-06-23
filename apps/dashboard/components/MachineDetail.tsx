"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useHub } from "./HubProvider";
import LiveStatsPanel from "./LiveStatsPanel";
import RemoteTerminal from "./RemoteTerminal";
import RemoteScreen from "./RemoteScreen";
import NotifyModal from "./NotifyModal";
import { renameMachine, deleteMachine } from "@/app/(app)/actions";
import {
  ArrowLeft, Circle, Activity, TerminalSquare, MonitorPlay, History,
  Bell, Camera, Pencil, Trash2,
} from "lucide-react";
import { timeAgo } from "@/lib/format";

type Tab = "overview" | "terminal" | "screen" | "history";

export default function MachineDetail({
  machine,
  recentCommands,
}: {
  machine: any;
  recentCommands: any[];
}) {
  const hub = useHub();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const [status, setStatus] = useState(machine.status);
  const [name, setName] = useState(machine.label || machine.hostname);
  const [notify, setNotify] = useState(false);

  useEffect(() => {
    hub.subscribe(machine.agentId);
    const offS = hub.on("machine:status", (m) => m.agentId === machine.agentId && setStatus(m.status));
    const offStat = hub.on("stats", (m) => m.agentId === machine.agentId && setStatus("online"));
    // screenshot vindo do agente -> download
    const offShot = hub.on("screenshot", (m) => {
      if (m.agentId !== machine.agentId) return;
      const a = document.createElement("a");
      a.href = `data:image/jpeg;base64,${m.data}`;
      a.download = `${machine.hostname || "screenshot"}-${Date.now()}.jpg`;
      a.click();
    });
    return () => {
      offS(); offStat(); offShot();
      hub.unsubscribe(machine.agentId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const online = status === "online";

  function takeScreenshot() {
    hub.send({ type: "screenshot", agentId: machine.agentId });
  }
  function doRename() {
    const n = window.prompt("Novo nome:", name);
    if (n === null) return;
    setName(n);
    renameMachine(machine.id, n);
  }
  function doDelete() {
    if (!window.confirm(`Excluir "${name}" da frota?`)) return;
    deleteMachine(machine.id).then(() => router.push("/"));
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Visao geral", icon: Activity },
    { id: "terminal", label: "Terminal", icon: TerminalSquare },
    { id: "screen", label: "Tela remota", icon: MonitorPlay },
    { id: "history", label: "Historico", icon: History },
  ];

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border px-6 py-4">
        <Link href="/" className="text-xs text-muted hover:text-white flex items-center gap-1 mb-2">
          <ArrowLeft size={14} /> Frota
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
              <span className={`badge ${online ? "bg-ok/15 text-ok" : "bg-panel2 text-muted"}`}>
                <Circle size={8} className="fill-current" />
                {online ? "online" : "offline"}
              </span>
            </div>
            <div className="text-sm text-muted mt-1">
              {machine.os} {machine.osVersion} · {machine.username || "—"} · {machine.localIp || "—"}
              {!online && ` · visto ${timeAgo(machine.lastSeen)}`}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setNotify(true)} disabled={!online} className="btn-ghost disabled:opacity-40">
              <Bell size={16} /> Aviso
            </button>
            <button onClick={takeScreenshot} disabled={!online} className="btn-ghost disabled:opacity-40">
              <Camera size={16} /> Screenshot
            </button>
            <button onClick={doRename} className="btn-ghost">
              <Pencil size={16} /> Renomear
            </button>
            <button onClick={doDelete} className="btn-ghost text-danger">
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <nav className="flex gap-1 mt-4 -mb-4">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-3 py-2 text-sm rounded-t-lg border-b-2 transition-colors ${
                  tab === t.id ? "border-accent text-white" : "border-transparent text-muted hover:text-white"
                }`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="flex-1 overflow-hidden">
        {tab === "overview" && <LiveStatsPanel machine={machine} specs={machine.specs} online={online} />}
        {tab === "terminal" && <RemoteTerminal machine={machine} online={online} />}
        {tab === "screen" && <RemoteScreen machine={machine} online={online} />}
        {tab === "history" && <HistoryTab commands={recentCommands} />}
      </div>

      {notify && (
        <NotifyModal agentId={machine.agentId} machineName={name} onClose={() => setNotify(false)} />
      )}
    </div>
  );
}

function HistoryTab({ commands }: { commands: any[] }) {
  return (
    <div className="p-6 w-full">
      <h2 className="text-sm font-medium text-muted mb-3">Comandos recentes (auditoria)</h2>
      {commands.length === 0 ? (
        <p className="text-sm text-muted">Nenhum comando executado ainda.</p>
      ) : (
        <div className="card divide-y divide-border">
          {commands.map((c) => (
            <div key={c.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span className="badge bg-panel2 text-accent2 shrink-0">{c.shell}</span>
              <code className="font-mono text-xs flex-1 truncate">{c.command}</code>
              <span className="text-xs text-muted shrink-0">{timeAgo(c.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
