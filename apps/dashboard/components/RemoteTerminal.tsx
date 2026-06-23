"use client";

import { useEffect, useRef, useState } from "react";
import { useHub } from "./HubProvider";
import { TerminalSquare, Play } from "lucide-react";

function b64ToText(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}
function textToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export default function RemoteTerminal({ machine, online }: { machine: any; online: boolean }) {
  const hub = useHub();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const sessionRef = useRef<string | null>(null);
  const lineRef = useRef<string>("");
  const inputBuffer = useRef<string[]>([]);
  const [shell, setShell] = useState<"cmd" | "powershell">("cmd");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    let disposed = false;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        fontFamily: "ui-monospace, Consolas, monospace",
        fontSize: 13,
        cursorBlink: true,
        theme: { background: "#0a0d14", foreground: "#e6edf6", cursor: "#22d3ee" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      term.writeln("\x1b[36mOneDesk — conectando ao terminal remoto...\x1b[0m");

      hub.send({ type: "term:start", agentId: machine.agentId, shell });

      term.onData((data: string) => {
        // auditoria de linha
        for (const ch of data) {
          if (ch === "\r") {
            if (lineRef.current.trim()) {
              hub.send({
                type: "term:input",
                agentId: machine.agentId,
                sessionId: sessionRef.current,
                data: textToB64(data),
                shell,
                line: lineRef.current,
              });
              lineRef.current = "";
              return;
            }
            lineRef.current = "";
          } else if (ch === "\x7f") {
            lineRef.current = lineRef.current.slice(0, -1);
          } else {
            lineRef.current += ch;
          }
        }
        const payload = {
          type: "term:input",
          agentId: machine.agentId,
          sessionId: sessionRef.current,
          data: textToB64(data),
          shell,
        };
        if (sessionRef.current) hub.send(payload);
        else inputBuffer.current.push(textToB64(data));
      });

      const onResize = () => {
        try {
          fit.fit();
          hub.send({
            type: "term:resize",
            agentId: machine.agentId,
            sessionId: sessionRef.current,
            cols: term.cols,
            rows: term.rows,
          });
        } catch {}
      };
      window.addEventListener("resize", onResize);

      const offStarted = hub.on("term:started", (m) => {
        if (m.agentId !== machine.agentId) return;
        sessionRef.current = m.sessionId;
        // envia o que foi digitado antes da sessao existir
        for (const data of inputBuffer.current) {
          hub.send({ type: "term:input", agentId: machine.agentId, sessionId: m.sessionId, data, shell });
        }
        inputBuffer.current = [];
        onResize();
      });

      const offData = hub.on("term:data", (m) => {
        if (m.agentId !== machine.agentId) return;
        term.write(b64ToText(m.data));
      });

      return () => {
        window.removeEventListener("resize", onResize);
        offStarted();
        offData();
      };
    })();

    return () => {
      disposed = true;
      if (sessionRef.current) {
        hub.send({ type: "term:stop", agentId: machine.agentId, sessionId: sessionRef.current });
      }
      termRef.current?.dispose?.();
      termRef.current = null;
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  if (!online) {
    return (
      <div className="p-6">
        <div className="card p-10 text-center text-muted">
          Maquina offline — o terminal estara disponivel quando o agente reconectar.
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="p-6">
        <div className="card p-8 text-center max-w-md mx-auto">
          <TerminalSquare className="mx-auto text-accent2 mb-3" size={32} />
          <h3 className="font-medium mb-1">Terminal remoto</h3>
          <p className="text-sm text-muted mb-4">
            Abra um shell interativo na maquina do cliente. Todos os comandos sao registrados na
            auditoria.
          </p>
          <div className="flex items-center gap-2 justify-center mb-4">
            <button
              onClick={() => setShell("cmd")}
              className={`btn ${shell === "cmd" ? "btn-primary" : "btn-ghost"}`}
            >
              CMD
            </button>
            <button
              onClick={() => setShell("powershell")}
              className={`btn ${shell === "powershell" ? "btn-primary" : "btn-ghost"}`}
            >
              PowerShell
            </button>
          </div>
          <button onClick={() => setStarted(true)} className="btn-primary w-full">
            <Play size={16} /> Iniciar sessao
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs text-muted flex items-center gap-2">
          <TerminalSquare size={14} /> {shell} · {machine.hostname}
        </span>
        <button onClick={() => setStarted(false)} className="text-xs text-danger hover:underline">
          Encerrar
        </button>
      </div>
      <div ref={containerRef} className="flex-1 p-2 overflow-hidden" />
    </div>
  );
}
