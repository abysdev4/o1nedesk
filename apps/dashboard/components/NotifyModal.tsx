"use client";

import { useState } from "react";
import { useHub } from "./HubProvider";
import { Bell, X } from "lucide-react";

export default function NotifyModal({
  agentId,
  machineName,
  onClose,
}: {
  agentId: string;
  machineName: string;
  onClose: () => void;
}) {
  const hub = useHub();
  const [title, setTitle] = useState("Mensagem do suporte");
  const [message, setMessage] = useState("");
  const [popup, setPopup] = useState(true);
  const [sent, setSent] = useState(false);

  function send() {
    if (!message.trim()) return;
    hub.send({ type: "notify", agentId, title, message, popup });
    setSent(true);
    setTimeout(onClose, 900);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium flex items-center gap-2">
            <Bell size={18} className="text-accent2" /> Enviar aviso
          </h3>
          <button onClick={onClose} className="text-muted hover:text-white">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-muted mb-3">
          Sera exibido no computador <span className="text-white">{machineName}</span>.
        </p>
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titulo"
            className="input"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escreva a mensagem para o usuario..."
            rows={3}
            className="input"
            autoFocus
          />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={popup} onChange={(e) => setPopup(e.target.checked)} />
            Exibir como janela (popup). Desmarcado = notificacao discreta na bandeja.
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={send} disabled={!message.trim() || sent} className="btn-primary disabled:opacity-50">
            {sent ? "Enviado ✓" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
