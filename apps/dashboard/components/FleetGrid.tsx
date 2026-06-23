"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useHub } from "./HubProvider";
import NotifyModal from "./NotifyModal";
import MachineCard from "./MachineCard";
import MachineRow from "./MachineRow";
import { isOutdated } from "@/lib/version";
import { ArrowUpCircle, LayoutGrid, List } from "lucide-react";
import { renameMachine, deleteMachine } from "@/app/(app)/actions";

type M = {
  id: string;
  agentId: string;
  hostname: string;
  label: string | null;
  username: string | null;
  localIp: string | null;
  status: string;
  lastSeen: string | null;
  locked?: boolean;
  agentVersion?: string | null;
};

export default function FleetGrid({
  initial,
  latestVersion,
}: {
  initial: { machine: any }[];
  latestVersion: string;
}) {
  const hub = useHub();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [machines, setMachines] = useState<Record<string, M>>(() =>
    Object.fromEntries(initial.map((r) => [r.machine.agentId, r.machine]))
  );
  const [stats, setStats] = useState<Record<string, any>>({});
  const [notify, setNotify] = useState<M | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    const v = localStorage.getItem("fleetView");
    if (v === "list" || v === "grid") setView(v);
  }, []);
  function changeView(v: "grid" | "list") {
    setView(v);
    localStorage.setItem("fleetView", v);
  }

  useEffect(() => {
    for (const r of initial) hub.subscribe(r.machine.agentId);
    const offStatus = hub.on("machine:status", (m) =>
      setMachines((p) =>
        p[m.agentId]
          ? {
              ...p,
              [m.agentId]: {
                ...p[m.agentId],
                status: m.status,
                agentVersion: m.agentVersion ?? p[m.agentId].agentVersion,
              },
            }
          : p
      )
    );
    const offStats = hub.on("stats", (m) => {
      setStats((p) => ({ ...p, [m.agentId]: m }));
      setMachines((p) =>
        p[m.agentId]
          ? { ...p, [m.agentId]: { ...p[m.agentId], status: "online", lastSeen: new Date().toISOString() } }
          : p
      );
    });
    return () => { offStatus(); offStats(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doRename(m: M) {
    const name = window.prompt("Novo nome para esta maquina:", m.label || m.hostname || "");
    if (name === null) return;
    setMachines((p) => ({ ...p, [m.agentId]: { ...p[m.agentId], label: name } }));
    startTransition(() => renameMachine(m.id, name));
  }
  function doDelete(m: M) {
    if (!window.confirm(`Excluir "${m.label || m.hostname}" da frota? Isso remove o historico desta maquina.`)) return;
    setMachines((p) => { const c = { ...p }; delete c[m.agentId]; return c; });
    startTransition(() => deleteMachine(m.id));
  }

  const list = Object.values(machines);
  const outdated = list.filter((m) => m.status === "online" && isOutdated(m.agentVersion, latestVersion));

  function updateAll() {
    if (!confirm(`Solicitar atualização em ${outdated.length} máquina(s)? O usuário precisa clicar em Atualizar no PC.`)) return;
    for (const m of outdated) hub.send({ type: "agent:update", agentId: m.agentId });
  }

  const actionsFor = (m: M) => ({
    onOpen: () => router.push(`/machines/${m.id}`),
    onRemote: () => router.push(`/machines/${m.id}?tab=screen`),
    onRename: () => doRename(m),
    onDelete: () => doDelete(m),
    onNotify: () => setNotify(m),
    onUpdate: () => hub.send({ type: "agent:update", agentId: m.agentId }),
  });

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {outdated.length > 0 ? (
          <div className="card border-accent/40 bg-accent/5 px-4 py-2.5 flex items-center gap-3 flex-1">
            <ArrowUpCircle size={16} className="text-accent shrink-0" />
            <span className="text-sm flex-1">
              <span className="font-medium">{outdated.length}</span> desatualizada(s) — última{" "}
              <span className="font-mono text-accent2">v{latestVersion}</span>
            </span>
            <button onClick={updateAll} className="btn-primary py-1.5">
              <ArrowUpCircle size={15} /> Atualizar
            </button>
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-1 bg-panel2 border border-border rounded-lg p-1 shrink-0">
          <button onClick={() => changeView("grid")} title="Grade"
            className={`p-1.5 rounded-md ${view === "grid" ? "bg-panel text-white" : "text-muted hover:text-white"}`}>
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => changeView("list")} title="Lista"
            className={`p-1.5 rounded-md ${view === "list" ? "bg-panel text-white" : "text-muted hover:text-white"}`}>
            <List size={16} />
          </button>
        </div>
      </div>

      {view === "grid" ? (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {list.map((m) => (
            <MachineCard
              key={m.agentId}
              machine={m}
              stat={stats[m.agentId] || null}
              online={m.status === "online"}
              outdated={isOutdated(m.agentVersion, latestVersion)}
              actions={actionsFor(m)}
            />
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-border/60 overflow-hidden">
          {list.map((m) => (
            <MachineRow
              key={m.agentId}
              machine={m}
              stat={stats[m.agentId] || null}
              online={m.status === "online"}
              outdated={isOutdated(m.agentVersion, latestVersion)}
              actions={actionsFor(m)}
            />
          ))}
        </div>
      )}

      {notify && (
        <NotifyModal agentId={notify.agentId} machineName={notify.label || notify.hostname} onClose={() => setNotify(null)} />
      )}
    </>
  );
}
