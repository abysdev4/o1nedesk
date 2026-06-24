"use client";

import { useEffect, useState } from "react";
import { useHub } from "./HubProvider";
import { isOutdated } from "@/lib/version";
import { CheckCircle2, RefreshCw, AlertTriangle, BellRing } from "lucide-react";

const PHASE_LABEL: Record<string, string> = {
  checking: "Verificando versão…",
  downloading: "Baixando atualização…",
  applying: "Instalando no cliente…",
  restarting: "Reiniciando agente…",
  already_latest: "Já está na versão mais recente",
  busy: "Atualização já em andamento",
  prompt_shown: "Aguardando clique do usuário no cliente…",
  uac_cancelled: "Permissão de administrador negada no cliente",
};

function labelForPhase(phase: string): string {
  if (PHASE_LABEL[phase]) return PHASE_LABEL[phase];
  if (phase.startsWith("failed:")) return `Falha: ${phase.slice(7)}`;
  return phase;
}

export default function UpdateCard({ machine, online }: { machine: any; online: boolean }) {
  const hub = useHub();
  const [latest, setLatest] = useState<string>("");
  const [current, setCurrent] = useState<string>(machine.agentVersion || "—");
  const [requested, setRequested] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/agent/version", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d.version && setLatest(d.version))
      .catch(() => {});
    const offStatus = hub.on("machine:status", (m: any) => {
      if (m.agentId !== machine.agentId) return;
      if (m.agentVersion) {
        setCurrent(m.agentVersion);
        setRequested(false);
        setPhase("");
        setError("");
      }
    });
    const offUpdate = hub.on("update:status", (m: any) => {
      if (m.agentId !== machine.agentId) return;
      setPhase(m.phase || "");
      if (String(m.phase || "").startsWith("failed:") || m.phase === "uac_cancelled") {
        setError(labelForPhase(m.phase));
        setRequested(false);
      }
      if (m.phase === "already_latest") setRequested(false);
      if (m.phase === "restarting") setRequested(false);
    });
    const offAck = hub.on("agent:update:ack", (m: any) => {
      if (m.agentId !== machine.agentId) return;
      if (!m.ok) {
        setError(m.error || "Não foi possível contatar o agente");
        setRequested(false);
      }
    });
    return () => {
      offStatus();
      offUpdate();
      offAck();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outdated = latest && isOutdated(current, latest);

  function forceUpdate() {
    setError("");
    setPhase("");
    hub.send({ type: "agent:update", agentId: machine.agentId });
    setRequested(true);
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted flex items-center gap-2">
          <RefreshCw size={15} /> Versão do agente
        </h3>
        {outdated ? (
          <span className="badge bg-accent/15 text-accent">desatualizado</span>
        ) : (
          <span className="badge bg-ok/15 text-ok">
            <CheckCircle2 size={12} /> atualizado
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <div className="flex justify-between border-b border-border/50 pb-1.5">
          <span className="text-muted">Instalada</span>
          <span className="font-mono">v{current}</span>
        </div>
        <div className="flex justify-between border-b border-border/50 pb-1.5">
          <span className="text-muted">Disponível</span>
          <span className="font-mono text-accent2">{latest ? `v${latest}` : "…"}</span>
        </div>
      </div>

      {error && (
        <p className="text-xs text-danger mb-2 flex items-start gap-1.5">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}
      {requested && phase && !error && (
        <p className="text-xs text-muted mb-2">{labelForPhase(phase)}</p>
      )}

      <button
        onClick={forceUpdate}
        disabled={!online || requested || !outdated}
        className="btn-primary w-full disabled:opacity-50"
        title={
          outdated
            ? "Envia um aviso sobreposto ao PC do usuário com a nova versão"
            : "Disponível apenas quando o agente está desatualizado"
        }
      >
        <BellRing size={15} /> {requested ? "Aguardando cliente…" : "AVISO UPDATE"}
      </button>
      <p className="text-[11px] text-muted mt-2 leading-relaxed">
        {outdated ? (
          <>
            Abre um <strong>aviso sobreposto</strong> no PC do usuário, por cima de qualquer janela aberta,
            com a nova versão. Ele clica em &quot;Atualizar agora&quot; e o download, instalação e reinício são
            automáticos. A partir da v1.2.0, updates futuros não pedem UAC de novo.
          </>
        ) : (
          <>
            O agente está na versão mais recente. O aviso só pode ser enviado quando há uma versão mais nova
            disponível.
          </>
        )}
      </p>
    </div>
  );
}
