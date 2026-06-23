"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";

type Handler = (msg: any) => void;

type HubCtx = {
  connected: boolean;
  send: (msg: any) => void;
  subscribe: (agentId: string) => void;
  unsubscribe: (agentId: string) => void;
  on: (type: string, handler: Handler) => () => void;
};

const Ctx = createContext<HubCtx | null>(null);

export function useHub() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useHub fora do HubProvider");
  return c;
}

export function HubProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef<Map<string, Set<Handler>>>(new Map());
  const subs = useRef<Set<string>>(new Set());
  const queue = useRef<any[]>([]);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<any>(null);

  const flush = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (queue.current.length) {
      ws.send(JSON.stringify(queue.current.shift()));
    }
  }, []);

  const send = useCallback(
    (msg: any) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        queue.current.push(msg);
      }
    },
    []
  );

  const connect = useCallback(async () => {
    try {
      const res = await fetch("/api/realtime-ticket", { cache: "no-store" });
      if (!res.ok) return;
      const { ticket, hubWs } = await res.json();
      const ws = new WebSocket(`${hubWs}/console?ticket=${encodeURIComponent(ticket)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        // re-inscreve nas maquinas
        for (const a of subs.current) ws.send(JSON.stringify({ type: "subscribe", agentId: a }));
        flush();
      };
      ws.onclose = () => {
        setConnected(false);
        scheduleReconnect();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        const set = listeners.current.get(msg.type);
        if (set) for (const h of set) h(msg);
        const all = listeners.current.get("*");
        if (all) for (const h of all) h(msg);
      };
    } catch {
      scheduleReconnect();
    }
  }, [flush]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) return;
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      connect();
    }, 2000);
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribe = useCallback(
    (agentId: string) => {
      subs.current.add(agentId);
      send({ type: "subscribe", agentId });
    },
    [send]
  );

  const unsubscribe = useCallback(
    (agentId: string) => {
      subs.current.delete(agentId);
      send({ type: "unsubscribe", agentId });
    },
    [send]
  );

  const on = useCallback((type: string, handler: Handler) => {
    let set = listeners.current.get(type);
    if (!set) {
      set = new Set();
      listeners.current.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }, []);

  return (
    <Ctx.Provider value={{ connected, send, subscribe, unsubscribe, on }}>
      {children}
    </Ctx.Provider>
  );
}
