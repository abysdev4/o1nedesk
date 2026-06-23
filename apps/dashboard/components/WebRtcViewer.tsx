"use client";

import { useEffect, useRef, useState } from "react";
import { useHub } from "./HubProvider";
import { useFullscreen } from "./useFullscreen";
import { useRemotePaste } from "@/lib/useRemotePaste";
import { MonitorPlay, Play, Square, MousePointer2, MousePointerClick, Loader2, Maximize, Minimize } from "lucide-react";

import { remoteMediaCoords } from "./remoteMediaCoords";

type ViewerProps = {
  machine: any;
  online: boolean;
  monitor: number;
  fitMode: "contain" | "cover";
  onStreamingChange?: (streaming: boolean) => void;
};

export default function WebRtcViewer({ machine, online, monitor, fitMode, onStreamingChange }: ViewerProps) {
  const hub = useHub();
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [state, setState] = useState<string>("");
  const [control, setControl] = useState(false);
  const [fps, setFps] = useState(20);
  const { ref: fsRef, isFull, toggle: toggleFull } = useFullscreen<HTMLDivElement>();
  const lastMove = useRef(0);
  const [pasteMsg, setPasteMsg] = useState("");
  const streamingRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const monitorRef = useRef(monitor);
  const fpsRef = useRef(fps);

  useEffect(() => { monitorRef.current = monitor; }, [monitor]);
  useEffect(() => { fpsRef.current = fps; }, [fps]);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);
  useEffect(() => { onStreamingChange?.(streaming); }, [streaming, onStreamingChange]);
  useEffect(() => () => { onStreamingChange?.(false); }, [onStreamingChange]);

  useRemotePaste(hub, machine.agentId, control, (m) => {
    setPasteMsg(m);
    setTimeout(() => setPasteMsg(""), 2600);
  });

  function clearReconnectTimer() {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  }

  async function start(fromReconnect = false) {
    clearReconnectTimer();
    if (!fromReconnect) reconnectAttempts.current = 0;
    setStreaming(true);
    setState("conectando");
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;
    pc.addTransceiver("video", { direction: "recvonly" });

    pc.ontrack = (e) => {
      if (videoRef.current) videoRef.current.srcObject = e.streams[0];
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        hub.send({
          type: "webrtc:ice",
          agentId: machine.agentId,
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        });
      }
    };
    pc.onconnectionstatechange = () => {
      setState(pc.connectionState);
      if (pc.connectionState === "connected") reconnectAttempts.current = 0;
      if (
        streamingRef.current &&
        (pc.connectionState === "disconnected" || pc.connectionState === "failed")
      ) {
        scheduleReconnect();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    hub.send({
      type: "webrtc:offer",
      agentId: machine.agentId,
      sdp: offer.sdp,
      fps: fpsRef.current,
      monitor: monitorRef.current,
    });
  }

  function scheduleReconnect() {
    if (!streamingRef.current || reconnectAttempts.current >= 6) return;
    clearReconnectTimer();
    reconnectTimer.current = setTimeout(async () => {
      if (!streamingRef.current) return;
      reconnectAttempts.current += 1;
      setState("reconectando");
      try {
        pcRef.current?.close();
      } catch {}
      pcRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      await start(true);
    }, 1200 + reconnectAttempts.current * 400);
  }

  function stop() {
    clearReconnectTimer();
    reconnectAttempts.current = 0;
    hub.send({ type: "webrtc:stop", agentId: machine.agentId });
    hub.send({ type: "input:release", agentId: machine.agentId });
    pcRef.current?.close();
    pcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
    setState("");
  }

  useEffect(() => {
    const offAnswer = hub.on("webrtc:answer", async (m) => {
      if (m.agentId !== machine.agentId || !pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription({ type: "answer", sdp: m.sdp });
      } catch {}
    });
    const offIce = hub.on("webrtc:ice", async (m) => {
      if (m.agentId !== machine.agentId || !pcRef.current) return;
      try {
        await pcRef.current.addIceCandidate({
          candidate: m.candidate,
          sdpMid: m.sdpMid,
          sdpMLineIndex: m.sdpMLineIndex,
        });
      } catch {}
    });
    return () => {
      offAnswer();
      offIce();
      clearReconnectTimer();
      pcRef.current?.close();
      if (streamingRef.current) {
        hub.send({ type: "webrtc:stop", agentId: machine.agentId });
        hub.send({ type: "input:release", agentId: machine.agentId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeFps(v: number) {
    setFps(v);
    if (streaming) hub.send({ type: "screen:config", agentId: machine.agentId, fps: v, monitor });
  }

  function relayMouse(e: React.MouseEvent, action: "move" | "down" | "up") {
    if (!control || !videoRef.current) return;
    // throttle dos movimentos (~33/s) para nao inundar o WebSocket
    if (action === "move") {
      const now = performance.now();
      if (now - lastMove.current < 30) return;
      lastMove.current = now;
    }
    const v = videoRef.current;
    const coords = remoteMediaCoords(e, v, v.videoWidth || v.clientWidth, v.videoHeight || v.clientHeight, fitMode);
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
      // Ctrl+V: deixa o navegador disparar o evento "paste" (redirecionamento de clipboard)
      if (e.ctrlKey && (e.key === "v" || e.key === "V")) return;
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

  const connected = state === "connected";

  return (
    <div ref={fsRef} className="h-full w-full flex flex-col bg-black">
      <div className="px-4 py-2 border-b border-border bg-panel flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {!streaming ? (
            <button onClick={start} className="btn-primary">
              <Play size={16} /> Iniciar (HD)
            </button>
          ) : (
            <button onClick={stop} className="btn-ghost text-danger">
              <Square size={16} /> Parar
            </button>
          )}
          <button
            onClick={() => setControl((c) => !c)}
            disabled={!connected}
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
              value={fps}
              onChange={(e) => changeFps(Number(e.target.value))}
              className="bg-panel2 border border-border rounded px-1.5 py-1 text-xs text-white"
            >
              <option value={15}>15</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
            </select>
          </label>
          <span className="text-xs text-accent2 flex items-center gap-1.5">
            <MonitorPlay size={14} />
            {streaming ? (connected ? "ao vivo (H.264/VP8)" : state === "reconectando" ? "reconectando..." : state || "negociando") : "parado"}
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
        {streaming && !connected && (
          <div className="absolute inset-0 flex items-center justify-center text-muted gap-2 z-10">
            <Loader2 className="animate-spin" size={18} /> estabelecendo conexao P2P...
          </div>
        )}
        {control && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-panel/90 border border-border rounded-full px-3 py-1 text-[11px] text-muted backdrop-blur">
            {pasteMsg || "Ctrl+V cola arquivo/texto da sua máquina no cliente"}
          </div>
        )}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full ${fitMode === "cover" ? "object-cover" : "object-contain"} ${control ? "cursor-none" : ""} ${streaming ? "" : "hidden"}`}
          onMouseMove={(e) => relayMouse(e, "move")}
          onMouseDown={(e) => relayMouse(e, "down")}
          onMouseUp={(e) => relayMouse(e, "up")}
          onDoubleClick={() => { if (!control) toggleFull(); }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {!streaming && (
          <div className="text-center text-muted">
            <MonitorPlay className="mx-auto mb-3 opacity-50" size={40} />
            <p className="text-sm">Clique em "Iniciar (HD)" para transmitir a tela em video.</p>
            <p className="text-xs mt-1">Conexao P2P direta (WebRTC) — o cliente ve o indicador de sessao.</p>
          </div>
        )}
      </div>
    </div>
  );
}
