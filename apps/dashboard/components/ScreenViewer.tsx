"use client";

import { useEffect, useRef, useState } from "react";
import { useHub } from "./HubProvider";
import { useFullscreen } from "./useFullscreen";
import { useRemotePaste } from "@/lib/useRemotePaste";
import { MonitorPlay, Play, Square, MousePointer2, MousePointerClick, Maximize, Minimize } from "lucide-react";

import { remoteMediaCoords } from "./remoteMediaCoords";

type ViewerProps = {
  machine: any;
  online: boolean;
  monitor: number;
  fitMode: "contain" | "cover";
  onStreamingChange?: (streaming: boolean) => void;
};

export default function ScreenViewer({ machine, online, monitor, fitMode, onStreamingChange }: ViewerProps) {
  const hub = useHub();
  const imgRef = useRef<HTMLImageElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [control, setControl] = useState(false);
  const [fps, setFps] = useState(0);
  const [targetFps, setTargetFps] = useState(10);
  const [quality, setQuality] = useState(50);
  const frameCount = useRef(0);
  const lastMove = useRef(0);
  const { ref: fsRef, isFull, toggle: toggleFull } = useFullscreen<HTMLDivElement>();
  const [pasteMsg, setPasteMsg] = useState("");

  useRemotePaste(hub, machine.agentId, control, (m) => {
    setPasteMsg(m);
    setTimeout(() => setPasteMsg(""), 2600);
  });

  useEffect(() => { onStreamingChange?.(streaming); }, [streaming, onStreamingChange]);
  useEffect(() => () => { onStreamingChange?.(false); }, [onStreamingChange]);

  useEffect(() => {
    const off = hub.on("screen:frame", (m) => {
      if (m.agentId !== machine.agentId || !imgRef.current) return;
      // data = base64 jpeg
      imgRef.current.src = `data:image/jpeg;base64,${m.data}`;
      frameCount.current++;
    });
    const interval = setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);
    return () => {
      off();
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    hub.send({ type: "screen:start", agentId: machine.agentId, fps: targetFps, quality, monitor });
    setStreaming(true);
  }
  function stop() {
    hub.send({ type: "screen:stop", agentId: machine.agentId });
    hub.send({ type: "input:release", agentId: machine.agentId });
    setStreaming(false);
  }
  function changeFps(v: number) {
    setTargetFps(v);
    if (streaming) hub.send({ type: "screen:config", agentId: machine.agentId, fps: v, quality, monitor });
  }
  function changeQuality(v: number) {
    setQuality(v);
    if (streaming) hub.send({ type: "screen:config", agentId: machine.agentId, fps: targetFps, quality: v, monitor });
  }
  useEffect(() => () => {
    if (streaming) {
      hub.send({ type: "screen:stop", agentId: machine.agentId });
      hub.send({ type: "input:release", agentId: machine.agentId });
    }
  }, []); // eslint-disable-line

  function relayMouse(e: React.MouseEvent, action: "move" | "down" | "up") {
    if (!control || !imgRef.current) return;
    if (action === "move") {
      const now = performance.now();
      if (now - lastMove.current < 30) return;
      lastMove.current = now;
    }
    const img = imgRef.current;
    const coords = remoteMediaCoords(
      e,
      img,
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      fitMode
    );
    if (!coords) return;
    hub.send({
      type: "input:mouse",
      agentId: machine.agentId,
      x: coords.x,
      y: coords.y,
      button: e.button === 2 ? "right" : "left",
      action,
    });
  }

  useEffect(() => {
    if (!control) {
      hub.send({ type: "input:release", agentId: machine.agentId });
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "v" || e.key === "V")) return; // Ctrl+V -> evento paste (clipboard)
      e.preventDefault();
      hub.send({
        type: "input:key",
        agentId: machine.agentId,
        key: e.key,
        down: e.type === "keydown",
        ctrl: e.ctrlKey,
        alt: e.altKey,
        meta: e.metaKey,
        shift: e.shiftKey,
      });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [control]);

  if (!online) {
    return (
      <div className="p-6">
        <div className="card p-10 text-center text-muted">
          Maquina offline — a tela remota estara disponivel quando o agente reconectar.
        </div>
      </div>
    );
  }

  return (
    <div ref={fsRef} className="h-full w-full flex flex-col bg-black">
      <div className="px-4 py-2 border-b border-border bg-panel flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {!streaming ? (
            <button onClick={start} className="btn-primary">
              <Play size={16} /> Iniciar tela
            </button>
          ) : (
            <button onClick={stop} className="btn-ghost text-danger">
              <Square size={16} /> Parar
            </button>
          )}
          <button
            onClick={() => setControl((c) => !c)}
            disabled={!streaming}
            className={`btn ${control ? "btn-primary" : "btn-ghost"} disabled:opacity-40`}
          >
            {control ? <MousePointerClick size={16} /> : <MousePointer2 size={16} />}
            {control ? "Controle ativo" : "Apenas visualizar"}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted flex items-center gap-1.5">
            FPS
            <select
              value={targetFps}
              onChange={(e) => changeFps(Number(e.target.value))}
              className="bg-panel2 border border-border rounded px-1.5 py-1 text-xs text-white"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={20}>20</option>
            </select>
          </label>
          <label className="text-xs text-muted flex items-center gap-1.5">
            Qualidade
            <select
              value={quality}
              onChange={(e) => changeQuality(Number(e.target.value))}
              className="bg-panel2 border border-border rounded px-1.5 py-1 text-xs text-white"
            >
              <option value={30}>Baixa</option>
              <option value={50}>Media</option>
              <option value={75}>Alta</option>
            </select>
          </label>
          <span className="text-xs text-accent2 flex items-center gap-1.5 tabular-nums w-16 justify-end">
            <MonitorPlay size={14} /> {streaming ? `${fps} fps` : "parado"}
          </span>
          <button
            onClick={toggleFull}
            className="btn-ghost px-2 py-1.5"
            title={isFull ? "Sair da tela cheia (Esc)" : "Tela cheia"}
          >
            {isFull ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex items-center justify-center relative">
        {control && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-panel/90 border border-border rounded-full px-3 py-1 text-[11px] text-muted backdrop-blur">
            {pasteMsg || "Ctrl+V cola arquivo/texto da sua máquina no cliente"}
          </div>
        )}
        {streaming ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            alt="Tela remota"
            className={`w-full h-full ${fitMode === "cover" ? "object-cover" : "object-contain"} ${control ? "cursor-none" : ""}`}
            onMouseMove={(e) => relayMouse(e, "move")}
            onMouseDown={(e) => relayMouse(e, "down")}
            onMouseUp={(e) => relayMouse(e, "up")}
            onDoubleClick={() => { if (!control) toggleFull(); }}
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
          />
        ) : (
          <div className="text-center text-muted">
            <MonitorPlay className="mx-auto mb-3 opacity-50" size={40} />
            <p className="text-sm">Clique em "Iniciar tela" para visualizar a area de trabalho.</p>
            <p className="text-xs mt-1">O cliente vera um indicador de sessao ativa.</p>
          </div>
        )}
      </div>
    </div>
  );
}
