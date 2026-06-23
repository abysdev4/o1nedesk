"use client";

import { useCallback, useEffect, useState } from "react";
import WebRtcViewer from "./WebRtcViewer";
import ScreenViewer from "./ScreenViewer";
import { useHub } from "./HubProvider";
import type { RemoteMonitor } from "./remoteMediaCoords";
import { Zap, Image as ImageIcon, Expand, Shrink, RefreshCw, KeyboardOff, EyeOff } from "lucide-react";

export default function RemoteScreen({ machine, online }: { machine: any; online: boolean }) {
  const hub = useHub();
  const [mode, setMode] = useState<"hd" | "basic">("hd");
  const [monitors, setMonitors] = useState<RemoteMonitor[]>([]);
  const [monitor, setMonitor] = useState(0);
  const [fitMode, setFitMode] = useState<"contain" | "cover">("cover");
  const [loadError, setLoadError] = useState("");
  const [blockInput, setBlockInput] = useState(false);
  const [privacyScreen, setPrivacyScreen] = useState(false);
  const [streaming, setStreaming] = useState(false);

  const sendRemoteOptions = useCallback(
    (block: boolean, privacy: boolean) => {
      if (!online) return;
      hub.send({ type: "remote:block-input", agentId: machine.agentId, enabled: block });
      hub.send({ type: "remote:privacy", agentId: machine.agentId, enabled: privacy });
    },
    [hub, machine.agentId, online]
  );

  useEffect(() => {
    if (!online || !streaming) return;
    sendRemoteOptions(blockInput, privacyScreen);
  }, [blockInput, privacyScreen, online, streaming, sendRemoteOptions]);

  useEffect(() => {
    if (streaming) return;
    setBlockInput(false);
    setPrivacyScreen(false);
  }, [streaming]);

  const applyMonitors = useCallback((list: RemoteMonitor[]) => {
    if (!list.length) return;
    setMonitors(list);
    setLoadError("");
    const primary = list.find((x) => x.primary);
    setMonitor(primary?.index ?? list[0].index);
  }, []);

  const requestMonitors = useCallback(() => {
    if (!online) return;
    hub.send({ type: "screen:monitors", agentId: machine.agentId });
  }, [hub, machine.agentId, online]);

  useEffect(() => {
    if (!online) {
      setMonitors([]);
      setLoadError("");
      return;
    }

    const handler = (m: any) => {
      if (m.agentId !== machine.agentId) return;
      if (m.error) {
        setLoadError(String(m.error));
        return;
      }
      const list: RemoteMonitor[] = m.monitors || [];
      if (list.length) applyMonitors(list);
      else setLoadError("Nenhum monitor detectado — reinicie o agente");
    };

    const off = hub.on("screen:monitors", handler);
    requestMonitors();
    const retry = setInterval(requestMonitors, 3000);

    return () => {
      off();
      clearInterval(retry);
    };
  }, [machine.agentId, online, hub, applyMonitors, requestMonitors]);

  function changeMonitor(idx: number) {
    setMonitor(idx);
    hub.send({ type: "screen:config", agentId: machine.agentId, monitor: idx });
  }

  const viewerProps = { machine, online, monitor, fitMode };

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-1.5 border-b border-border bg-bg flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted">Modo:</span>
        <button
          onClick={() => setMode("hd")}
          className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 ${
            mode === "hd" ? "bg-accent/20 text-white" : "text-muted hover:text-white"
          }`}
        >
          <Zap size={13} /> HD (WebRTC)
        </button>
        <button
          onClick={() => setMode("basic")}
          className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 ${
            mode === "basic" ? "bg-accent/20 text-white" : "text-muted hover:text-white"
          }`}
        >
          <ImageIcon size={13} /> Basico (compativel)
        </button>

        <span className="text-border mx-1">|</span>

        <label className="text-muted flex items-center gap-1.5">
          Monitor
          <select
            value={monitor}
            onChange={(e) => changeMonitor(Number(e.target.value))}
            disabled={!online || monitors.length === 0}
            className="bg-panel2 border border-border rounded px-1.5 py-1 text-xs text-white disabled:opacity-40 max-w-[260px]"
          >
            {monitors.length === 0 ? (
              <option value={0}>{loadError || "Carregando..."}</option>
            ) : (
              monitors.map((m) => (
                <option key={m.index} value={m.index}>
                  {m.name}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={requestMonitors}
            disabled={!online}
            className="p-1 rounded text-muted hover:text-white disabled:opacity-40"
            title="Atualizar lista de monitores"
          >
            <RefreshCw size={13} />
          </button>
        </label>

        {loadError && monitors.length === 0 && (
          <span className="text-danger text-[11px]">{loadError}</span>
        )}

        <button
          onClick={() => setFitMode((f) => (f === "cover" ? "contain" : "cover"))}
          className="px-2.5 py-1 rounded-md flex items-center gap-1.5 text-muted hover:text-white"
          title={fitMode === "cover" ? "Preencher tela (pode cortar bordas)" : "Ajustar (mostra tudo)"}
        >
          {fitMode === "cover" ? <Expand size={13} /> : <Shrink size={13} />}
          {fitMode === "cover" ? "Preencher" : "Ajustar"}
        </button>

        <span className="text-border mx-1">|</span>

        <button
          type="button"
          onClick={() => setBlockInput((v) => !v)}
          disabled={!online || !streaming}
          title={
            !streaming
              ? "Disponivel durante a transmissao"
              : "Bloqueia mouse e teclado fisicos do cliente (controle remoto continua funcionando)"
          }
          className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 disabled:opacity-40 ${
            blockInput ? "bg-amber-500/20 text-amber-200" : "text-muted hover:text-white"
          }`}
        >
          <KeyboardOff size={13} />
          Travar input
        </button>
        <button
          type="button"
          onClick={() => setPrivacyScreen((v) => !v)}
          disabled={!online || !streaming}
          title={
            !streaming
              ? "Disponivel durante a transmissao"
              : "Exibe tela de espera para o cliente (tecnico continua vendo o desktop)"
          }
          className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 disabled:opacity-40 ${
            privacyScreen ? "bg-sky-500/20 text-sky-200" : "text-muted hover:text-white"
          }`}
        >
          <EyeOff size={13} />
          Tela de espera
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {mode === "hd" ? (
          <WebRtcViewer key="hd" {...viewerProps} onStreamingChange={setStreaming} />
        ) : (
          <ScreenViewer key="basic" {...viewerProps} onStreamingChange={setStreaming} />
        )}
      </div>
    </div>
  );
}
