"use client";

import { useEffect, useState, useTransition } from "react";
import { useHub } from "./HubProvider";
import { setLockPassword } from "@/app/(app)/actions";
import { Lock, LockOpen, KeyRound, ShieldAlert } from "lucide-react";

export default function LockCard({ machine, online }: { machine: any; online: boolean }) {
  const hub = useHub();
  const [locked, setLocked] = useState(!!machine.locked);
  const [hasPass, setHasPass] = useState(!!machine.lockPasswordHash);
  const [pass, setPass] = useState("");
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const off = hub.on("lock:state", (m: any) => {
      if (m.agentId === machine.agentId) setLocked(!!m.locked);
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function savePassword() {
    if (pass.length < 4) return;
    hub.send({ type: "lock:setpass", agentId: machine.agentId, password: pass });
    startTransition(async () => {
      await setLockPassword(machine.id, pass);
      setHasPass(true);
      setSaved(true);
      setPass("");
      setTimeout(() => setSaved(false), 2000);
    });
  }

  function lock() {
    if (!confirm(`Bloquear "${machine.label || machine.hostname}"? A tela será coberta até desbloquear.`)) return;
    hub.send({ type: "lock:on", agentId: machine.agentId });
    setLocked(true);
  }
  function unlock() {
    hub.send({ type: "lock:off", agentId: machine.agentId });
    setLocked(false);
  }

  return (
    <div className={`card p-4 ${locked ? "border-warn/50" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted flex items-center gap-2">
          {locked ? <Lock size={15} className="text-warn" /> : <LockOpen size={15} />}
          Bloqueio de segurança
        </h3>
        <span className={`badge ${locked ? "bg-warn/15 text-warn" : "bg-panel2 text-muted"}`}>
          {locked ? "bloqueado" : "desbloqueado"}
        </span>
      </div>

      {locked && (
        <div className="flex items-center gap-2 text-xs text-warn bg-warn/10 border border-warn/30 rounded-lg px-3 py-2 mb-3">
          <ShieldAlert size={14} /> Dispositivo bloqueado — a tela está coberta para o usuário.
        </div>
      )}

      {/* Senha por dispositivo */}
      <div className="space-y-2 mb-4">
        <label className="text-xs text-muted flex items-center gap-1.5">
          <KeyRound size={13} /> Senha de desbloqueio {hasPass && <span className="text-ok">(definida)</span>}
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={hasPass ? "Alterar senha…" : "Defina a senha (mín. 4)"}
            className="input flex-1"
          />
          <button onClick={savePassword} disabled={pass.length < 4 || !online} className="btn-ghost disabled:opacity-40">
            {saved ? "Salvo ✓" : "Salvar"}
          </button>
        </div>
        {!online && <p className="text-[11px] text-muted">Máquina offline — a senha será aplicada quando reconectar.</p>}
      </div>

      {/* Ações */}
      <div className="flex gap-2">
        {!locked ? (
          <button onClick={lock} disabled={!online || !hasPass} className="btn-primary flex-1 disabled:opacity-40"
            title={!hasPass ? "Defina uma senha primeiro" : ""}>
            <Lock size={15} /> Bloquear
          </button>
        ) : (
          <button onClick={unlock} disabled={!online} className="btn-primary flex-1 bg-warn hover:bg-amber-500 disabled:opacity-40">
            <LockOpen size={15} /> Desbloquear
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted mt-2">
        O bloqueio cobre a tela em todos os monitores e persiste reinícios. O usuário desbloqueia com a senha,
        ou você remotamente aqui.
      </p>
    </div>
  );
}
