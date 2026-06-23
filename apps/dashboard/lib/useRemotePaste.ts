"use client";

import { useEffect } from "react";
import { sendFileChunks, MAX_FILE } from "./fileChunks";

type Hub = { send: (m: any) => void };

/**
 * Redirecionamento de clipboard durante a conexao remota.
 * Quando ativo (controle ligado), intercepta o Ctrl+V do operador: o conteudo da
 * area de transferencia LOCAL (texto ou arquivos) e enviado ao cliente e colado la.
 */
export function useRemotePaste(
  hub: Hub,
  agentId: string,
  active: boolean,
  onActivity?: (msg: string) => void
) {
  useEffect(() => {
    if (!active) return;

    const onPaste = async (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;

      // Arquivos
      if (dt.files && dt.files.length > 0) {
        e.preventDefault();
        const files = Array.from(dt.files);
        for (const f of files) {
          if (f.size > MAX_FILE) {
            onActivity?.(`Arquivo "${f.name}" muito grande (máx. 100 MB)`);
            continue;
          }
          onActivity?.(`Colando ${f.name}…`);
          await sendFileChunks(hub, agentId, f, { paste: true });
        }
        hub.send({ type: "clipboard:paste-commit", agentId });
        onActivity?.(`Colado no cliente (${files.length} arquivo${files.length > 1 ? "s" : ""})`);
        return;
      }

      // Texto
      const text = dt.getData("text/plain");
      if (text) {
        e.preventDefault();
        hub.send({ type: "clipboard:paste-text", agentId, text });
        onActivity?.("Texto colado no cliente");
      }
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [hub, agentId, active, onActivity]);
}
