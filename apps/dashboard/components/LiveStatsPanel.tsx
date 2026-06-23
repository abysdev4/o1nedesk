"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  YAxis,
  XAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useHub } from "./HubProvider";
import LocationCard from "./LocationCard";
import LockCard from "./LockCard";
import UpdateCard from "./UpdateCard";
import { bytes, bytesPerSec, pct, uptime } from "@/lib/format";
import { Cpu, MemoryStick, HardDrive, Network, Boxes, Clock } from "lucide-react";

type Point = { t: string; cpu: number; mem: number };

export default function LiveStatsPanel({
  machine,
  specs,
  online = false,
}: {
  machine: any;
  specs?: any;
  online?: boolean;
}) {
  const hub = useHub();
  const [stat, setStat] = useState<any>(null);
  const [series, setSeries] = useState<Point[]>([]);

  useEffect(() => {
    // historico inicial
    fetch(`/api/machines/${machine.id}/stats`)
      .then((r) => r.json())
      .then((d) => {
        if (d.stats) {
          setSeries(
            d.stats.map((s: any) => ({
              t: new Date(s.capturedAt).toLocaleTimeString().slice(0, 5),
              cpu: Math.round(s.cpu),
              mem: pct(s.memUsed, s.memTotal),
            }))
          );
          if (d.stats.length) setStat(d.stats[d.stats.length - 1]);
        }
      })
      .catch(() => {});

    const off = hub.on("stats", (m) => {
      if (m.agentId !== machine.agentId) return;
      setStat(m);
      setSeries((prev) =>
        [
          ...prev,
          {
            t: new Date().toLocaleTimeString().slice(0, 5),
            cpu: Math.round(m.cpu),
            mem: pct(m.memUsed, m.memTotal),
          },
        ].slice(-60)
      );
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cpu = stat ? Math.round(stat.cpu) : 0;
  const memP = stat ? pct(stat.memUsed, stat.memTotal) : 0;
  const diskP = stat ? pct(stat.diskUsed, stat.diskTotal) : 0;

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <Gauge icon={<Cpu size={16} />} label="CPU" value={`${cpu}%`} bar={cpu} />
        <Gauge icon={<MemoryStick size={16} />} label="Memoria" value={`${memP}%`} bar={memP} />
        <Gauge icon={<HardDrive size={16} />} label="Disco" value={`${diskP}%`} bar={diskP} />
        <Stat
          icon={<Network size={16} />}
          label="Rede"
          value={stat ? `↓${bytesPerSec(stat.netDown)}` : "—"}
          sub={stat ? `↑${bytesPerSec(stat.netUp)}` : ""}
        />
        <Stat
          icon={<Boxes size={16} />}
          label="Processos"
          value={stat ? String(stat.procCount) : "—"}
        />
        <Stat
          icon={<Clock size={16} />}
          label="Uptime"
          value={stat ? uptime(stat.uptime) : "—"}
        />
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-medium text-muted mb-4">CPU & Memoria (%) — ultima hora</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#222b3a" />
              <XAxis dataKey="t" stroke="#7b8aa0" fontSize={11} minTickGap={40} />
              <YAxis stroke="#7b8aa0" fontSize={11} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  background: "#11161f",
                  border: "1px solid #222b3a",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="cpu" stroke="#3b82f6" dot={false} strokeWidth={2} name="CPU" />
              <Line type="monotone" dataKey="mem" stroke="#22d3ee" dot={false} strokeWidth={2} name="RAM" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <InfoCard
          title="Memoria"
          rows={[
            ["Em uso", stat ? bytes(stat.memUsed) : "—"],
            ["Total", stat ? bytes(stat.memTotal) : "—"],
          ]}
        />
        <InfoCard
          title="Disco"
          rows={[
            ["Em uso", stat ? bytes(stat.diskUsed) : "—"],
            ["Total", stat ? bytes(stat.diskTotal) : "—"],
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LocationCard machine={machine} online={online} />
        <LockCard machine={machine} online={online} />
        <UpdateCard machine={machine} online={online} />
      </div>

      <SpecsCard specs={specs} />
    </div>
  );
}

function SpecsCard({ specs }: { specs?: any }) {
  if (!specs || typeof specs !== "object") return null;
  const fmtBytes = (n: number) => {
    if (!n) return "—";
    const gb = n / 1024 ** 3;
    return gb >= 1 ? `${gb.toFixed(0)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`;
  };
  const rows: [string, any][] = [
    ["Sistema", specs.os],
    ["Build", specs.osBuild],
    ["Arquitetura", specs.osArch],
    ["Fabricante", specs.manufacturer],
    ["Modelo", specs.model],
    ["Processador", specs.cpu],
    ["Nucleos / Threads", specs.cpuCores ? `${specs.cpuCores} / ${specs.cpuThreads}` : null],
    ["Clock", specs.cpuClockMhz ? `${(specs.cpuClockMhz / 1000).toFixed(1)} GHz` : null],
    ["Memoria RAM", specs.ramTotal ? `${fmtBytes(specs.ramTotal)}${specs.ramModules ? ` (${specs.ramModules} pente${specs.ramModules > 1 ? "s" : ""})` : ""}` : null],
    ["GPU", specs.gpu],
    ["Armazenamento", Array.isArray(specs.disks) ? specs.disks.join(" · ") : null],
    ["BIOS", specs.bios],
    ["Numero de serie", specs.serial],
    ["Dominio", specs.domain],
  ];
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (shown.length === 0) return null;

  return (
    <div className="card p-4">
      <h3 className="text-sm font-medium text-muted mb-4">Informacoes tecnicas</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5">
        {shown.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-sm border-b border-border/50 pb-2">
            <span className="text-muted shrink-0">{k}</span>
            <span className="text-right truncate" title={String(v)}>{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gauge({ icon, label, value, bar }: any) {
  const color = bar > 85 ? "bg-danger" : bar > 65 ? "bg-warn" : "bg-accent";
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-muted text-xs mb-2">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="h-1.5 rounded-full bg-panel2 overflow-hidden mt-2">
        <div className={`h-full ${color} transition-all`} style={{ width: `${bar}%` }} />
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub }: any) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-muted text-xs mb-2">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}

function InfoCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-medium text-muted mb-3">{title}</h3>
      <div className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-muted">{k}</span>
            <span className="tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
