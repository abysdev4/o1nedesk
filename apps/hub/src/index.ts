import { config } from "dotenv";
import { resolve, dirname } from "node:path";
config({ path: resolve(process.cwd(), "../../.env") });

import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { jwtVerify } from "jose";
import { eq, sql } from "drizzle-orm";
import {
  db,
  machines,
  machineStats,
  commands,
  sessions as sessionsTable,
  auditLog,
  alerts,
} from "@onedesk/db";

const PORT = Number(process.env.PORT || process.env.HUB_PORT || 4000);
const ENROLL_TOKEN = process.env.ENROLL_TOKEN || "";
const AUTH_SECRET = new TextEncoder().encode(process.env.AUTH_SECRET || "dev");

// ===================== Estado em memoria =====================
type AgentConn = {
  ws: WebSocket;
  agentId: string;
  machineId: string;
  hostname: string;
  lastStatsPersist: number;
  lastActivity: number;
};

// agentId -> conexao do agente
const agents = new Map<string, AgentConn>();
// agentId -> conjunto de dashboards inscritos
const subscribers = new Map<string, Set<WebSocket>>();
// agentId -> ultima miniatura (base64) para os cards da frota
const thumbs = new Map<string, string>();
// agentId -> lista de monitores reportada pelo agente
const agentMonitors = new Map<string, unknown[]>();

function subsFor(agentId: string): Set<WebSocket> {
  let s = subscribers.get(agentId);
  if (!s) {
    s = new Set();
    subscribers.set(agentId, s);
  }
  return s;
}

function broadcastToDashboards(agentId: string, msg: unknown) {
  const data = JSON.stringify(msg);
  const s = subscribers.get(agentId);
  if (!s) return;
  for (const ws of s) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// Todos os consoles conectados (para alertas globais)
const allConsoles = new Set<WebSocket>();
function broadcastToAllConsoles(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of allConsoles) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// Cria um alerta (tamper/seguranca) e empurra para todos os consoles
async function raiseAlert(
  agentId: string | null,
  kind: string,
  message: string,
  severity = "warn",
  detail?: unknown
) {
  let machineId: string | null = null;
  let hostname = "";
  if (agentId) {
    const m = await db.select().from(machines).where(eq(machines.agentId, agentId));
    if (m[0]) {
      machineId = m[0].id;
      hostname = m[0].label || m[0].hostname || "";
    }
  }
  const inserted = await db
    .insert(alerts)
    .values({ machineId, kind, message, severity, detail: detail ?? null })
    .returning();
  const a = inserted[0];
  broadcastToAllConsoles({
    type: "alert",
    id: a.id,
    machineId,
    agentId,
    hostname,
    kind,
    severity,
    message,
    createdAt: a.createdAt,
  });
  console.log(`[alert] ${kind} ${hostname} — ${message}`);
}

// Auditoria resiliente: nunca deixa uma falha de log interromper a operacao
function safeAudit(fn: () => Promise<unknown>) {
  Promise.resolve()
    .then(fn)
    .catch((e) => console.error("[audit] falha ao registrar:", e?.message || e));
}

function resolveAgentBinaryPath(): string {
  if (process.env.AGENT_BINARY_PATH) return process.env.AGENT_BINARY_PATH;
  const fromCwd = resolve(process.cwd(), "dist", "OneDeskAgent-Setup.exe");
  if (fs.existsSync(fromCwd)) return fromCwd;
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../dist/OneDeskAgent-Setup.exe");
}

function agentBinaryInfo() {
  const path = resolveAgentBinaryPath();
  try {
    const st = fs.statSync(path);
    if (!st.isFile()) return { path, exists: false as const };
    return { path, exists: true as const, size: st.size };
  } catch {
    return { path, exists: false as const };
  }
}

function sendToAgent(agentId: string, msg: unknown): boolean {
  const a = agents.get(agentId);
  if (!a || a.ws.readyState !== WebSocket.OPEN) return false;
  a.ws.send(JSON.stringify(msg));
  return true;
}

// ===================== Servidor HTTP (health) =====================
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ ok: true, agentsOnline: agents.size, ts: new Date().toISOString() })
    );
    return;
  }

  if (req.url === "/debug/agent-binary") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(agentBinaryInfo()));
    return;
  }

  // Download do binario do agente (auto-update) — servido pelo proprio host via tunel
  if (req.url === "/download/agent") {
    const path = resolveAgentBinaryPath();
    fs.stat(path, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404);
        res.end("binario nao encontrado");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(st.size),
        "content-disposition": 'attachment; filename="OneDeskAgent.exe"',
      });
      fs.createReadStream(path).pipe(res);
    });
    return;
  }

  // Ingestao de alertas (agente vivo OU watchdog quando o agente morreu)
  if (req.url === "/alert" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e5) req.destroy();
    });
    req.on("end", () => {
      let msg: any;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (msg.token !== ENROLL_TOKEN) {
        res.writeHead(401);
        res.end();
        return;
      }
      raiseAlert(
        msg.agentId || null,
        String(msg.kind || "tamper"),
        String(msg.message || "").slice(0, 500),
        String(msg.severity || "warn"),
        msg.detail
      ).catch((e) => console.error("[alert] erro:", e?.message || e));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// ===================== WebSocket =====================
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;

  if (path === "/agent") {
    const token = url.searchParams.get("token");
    if (token !== ENROLL_TOKEN) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleAgent(ws, req));
  } else if (path === "/console") {
    const ticket = url.searchParams.get("ticket") || "";
    verifyTicket(ticket)
      .then((claims) => {
        wss.handleUpgrade(req, socket, head, (ws) => handleConsole(ws, claims));
      })
      .catch(() => {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  } else {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  }
});

async function verifyTicket(ticket: string): Promise<{ sub: string; role: string }> {
  const { payload } = await jwtVerify(ticket, AUTH_SECRET);
  return { sub: String(payload.sub), role: String(payload.role || "technician") };
}

// ===================== Conexao do AGENTE =====================
function handleAgent(ws: WebSocket, _req: http.IncomingMessage) {
  let agentId = "";

  const ping = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
  }, 20000);

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Marca atividade (qualquer mensagem) para a varredura de inatividade
    if (agentId) {
      const c = agents.get(agentId);
      if (c) c.lastActivity = Date.now();
    }

    switch (msg.type) {
      case "register": {
        agentId = String(msg.agentId);
        const machineId = await upsertMachine(msg);
        agents.set(agentId, {
          ws,
          agentId,
          machineId,
          hostname: msg.hostname || "",
          lastStatsPersist: 0,
          lastActivity: Date.now(),
        });
        ws.send(JSON.stringify({ type: "registered", machineId }));
        broadcastToDashboards(agentId, {
          type: "machine:status",
          agentId,
          status: "online",
          agentVersion: msg.agentVersion,
        });
        console.log(`[agent] online: ${msg.hostname} (${agentId})`);
        break;
      }
      case "stats": {
        const a = agents.get(agentId);
        if (!a) break;
        // Broadcast ao vivo para os dashboards
        broadcastToDashboards(agentId, { type: "stats", agentId, ...msg });
        // Persiste de forma throttled (a cada 15s) e atualiza last_seen
        const now = Date.now();
        await db
          .update(machines)
          .set({ lastSeen: new Date(), status: "online", username: msg.username ?? undefined })
          .where(eq(machines.id, a.machineId));
        if (now - a.lastStatsPersist > 15000) {
          a.lastStatsPersist = now;
          await db.insert(machineStats).values({
            machineId: a.machineId,
            cpu: Number(msg.cpu) || 0,
            memUsed: Number(msg.memUsed) || 0,
            memTotal: Number(msg.memTotal) || 0,
            diskUsed: Number(msg.diskUsed) || 0,
            diskTotal: Number(msg.diskTotal) || 0,
            netUp: Number(msg.netUp) || 0,
            netDown: Number(msg.netDown) || 0,
            procCount: Number(msg.procCount) || 0,
            uptime: Number(msg.uptime) || 0,
          });
        }
        break;
      }
      case "term:data": {
        broadcastToDashboards(agentId, {
          type: "term:data",
          agentId,
          sessionId: msg.sessionId,
          data: msg.data,
        });
        break;
      }
      case "term:started": {
        broadcastToDashboards(agentId, {
          type: "term:started",
          agentId,
          sessionId: msg.sessionId,
          shell: msg.shell,
        });
        break;
      }
      case "screen:frame": {
        broadcastToDashboards(agentId, { type: "screen:frame", agentId, data: msg.data });
        break;
      }
      case "thumb": {
        thumbs.set(agentId, msg.data);
        broadcastToDashboards(agentId, { type: "thumb", agentId, data: msg.data });
        break;
      }
      case "screenshot": {
        broadcastToDashboards(agentId, { type: "screenshot", agentId, data: msg.data });
        break;
      }
      case "webrtc:answer": {
        broadcastToDashboards(agentId, { type: "webrtc:answer", agentId, sdp: msg.sdp });
        break;
      }
      case "webrtc:ice": {
        broadcastToDashboards(agentId, {
          type: "webrtc:ice",
          agentId,
          candidate: msg.candidate,
          sdpMid: msg.sdpMid,
          sdpMLineIndex: msg.sdpMLineIndex,
        });
        break;
      }
      case "screen:monitors": {
        if (Array.isArray(msg.monitors)) agentMonitors.set(agentId, msg.monitors);
        broadcastToDashboards(agentId, {
          type: "screen:monitors",
          agentId,
          monitors: msg.monitors,
        });
        break;
      }
      case "location:report": {
        const loc = {
          lat: msg.lat,
          lng: msg.lng,
          accuracy: msg.accuracy ?? null,
          source: msg.source || "ip",
          city: msg.city || null,
          at: new Date().toISOString(),
        };
        const a = agents.get(agentId);
        if (a) {
          safeAudit(() =>
            db.update(machines).set({ lastLocation: loc }).where(eq(machines.id, a.machineId))
          );
        }
        broadcastToDashboards(agentId, { type: "location:report", agentId, location: loc });
        break;
      }
      case "lock:state": {
        const a = agents.get(agentId);
        const locked = !!msg.locked;
        if (a) safeAudit(() => db.update(machines).set({ locked }).where(eq(machines.id, a.machineId)));
        broadcastToDashboards(agentId, { type: "lock:state", agentId, locked });
        break;
      }
      case "clipboard:data": {
        broadcastToDashboards(agentId, { type: "clipboard:data", agentId, text: msg.text });
        break;
      }
      case "file:saved": {
        broadcastToDashboards(agentId, { type: "file:saved", agentId, name: msg.name });
        break;
      }
      case "update:status": {
        broadcastToDashboards(agentId, { type: "update:status", agentId, phase: msg.phase });
        break;
      }
      case "notify:ack":
      case "pong":
        break;
    }
  });

  ws.on("close", async () => {
    clearInterval(ping);
    if (agentId) {
      agents.delete(agentId);
      const a = await db.select().from(machines).where(eq(machines.agentId, agentId));
      if (a[0]) {
        await db
          .update(machines)
          .set({ status: "offline", lastSeen: new Date() })
          .where(eq(machines.id, a[0].id));
      }
      broadcastToDashboards(agentId, { type: "machine:status", agentId, status: "offline" });
      console.log(`[agent] offline: ${agentId}`);
    }
  });
}

async function upsertMachine(msg: any): Promise<string> {
  const agentId = String(msg.agentId);
  const existing = await db.select().from(machines).where(eq(machines.agentId, agentId));
  const values = {
    hostname: msg.hostname || "",
    os: msg.os || "Windows",
    osVersion: msg.osVersion || "",
    agentVersion: msg.agentVersion || "",
    localIp: msg.localIp || "",
    username: msg.username || "",
    specs: msg.specs ?? undefined,
    status: "online" as const,
    lastSeen: new Date(),
    consentAt: msg.consentAt ? new Date(msg.consentAt) : undefined,
  };
  if (existing[0]) {
    await db.update(machines).set(values).where(eq(machines.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = await db
    .insert(machines)
    .values({ agentId, ...values })
    .returning({ id: machines.id });
  return inserted[0].id;
}

// ===================== Conexao do CONSOLE (dashboard) =====================
function handleConsole(ws: WebSocket, claims: { sub: string; role: string }) {
  const mySubscriptions = new Set<string>();
  allConsoles.add(ws);

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const agentId: string = msg.agentId;

    switch (msg.type) {
      case "subscribe": {
        subsFor(agentId).add(ws);
        mySubscriptions.add(agentId);
        ws.send(
          JSON.stringify({
            type: "machine:status",
            agentId,
            status: agents.has(agentId) ? "online" : "offline",
          })
        );
        const t = thumbs.get(agentId);
        if (t) ws.send(JSON.stringify({ type: "thumb", agentId, data: t }));
        const mons = agentMonitors.get(agentId);
        if (mons?.length)
          ws.send(JSON.stringify({ type: "screen:monitors", agentId, monitors: mons }));
        break;
      }
      case "unsubscribe": {
        subscribers.get(agentId)?.delete(ws);
        mySubscriptions.delete(agentId);
        break;
      }
      case "term:start": {
        const sessionId = randomUUID();
        const machineId = agents.get(agentId)?.machineId;
        // Auditoria nao pode bloquear a acao: encaminha primeiro, registra depois.
        sendToAgent(agentId, { type: "term:start", sessionId, shell: msg.shell || "cmd" });
        if (machineId) {
          safeAudit(() =>
            db.insert(sessionsTable).values({ machineId, userId: claims.sub, kind: "terminal" })
          );
          safeAudit(() =>
            db.insert(auditLog).values({
              userId: claims.sub,
              machineId,
              action: "terminal:open",
              detail: { shell: msg.shell },
            })
          );
        }
        break;
      }
      case "term:input": {
        sendToAgent(agentId, {
          type: "term:input",
          sessionId: msg.sessionId,
          data: msg.data,
        });
        // Auditoria: registra comandos completos (quando termina com Enter)
        if (typeof msg.data === "string" && /[\r\n]/.test(msg.data) && msg.line) {
          const machineId = agents.get(agentId)?.machineId;
          if (machineId) {
            safeAudit(() =>
              db.insert(commands).values({
                machineId,
                userId: claims.sub,
                shell: msg.shell || "cmd",
                command: String(msg.line).slice(0, 4000),
              })
            );
          }
        }
        break;
      }
      case "term:resize": {
        sendToAgent(agentId, {
          type: "term:resize",
          sessionId: msg.sessionId,
          cols: msg.cols,
          rows: msg.rows,
        });
        break;
      }
      case "term:stop": {
        sendToAgent(agentId, { type: "term:stop", sessionId: msg.sessionId });
        break;
      }
      case "screen:start": {
        const machineId = agents.get(agentId)?.machineId;
        sendToAgent(agentId, {
          type: "screen:start",
          fps: msg.fps || 4,
          quality: msg.quality || 50,
          monitor: msg.monitor ?? -1,
        });
        if (machineId) {
          safeAudit(() =>
            db.insert(auditLog).values({ userId: claims.sub, machineId, action: "screen:start" })
          );
        }
        break;
      }
      case "screen:stop": {
        sendToAgent(agentId, { type: "screen:stop" });
        break;
      }
      case "screen:config": {
        sendToAgent(agentId, {
          type: "screen:config",
          fps: msg.fps,
          quality: msg.quality,
          monitor: msg.monitor,
        });
        break;
      }
      case "screen:monitors": {
        const cached = agentMonitors.get(agentId);
        if (cached?.length) {
          ws.send(JSON.stringify({ type: "screen:monitors", agentId, monitors: cached }));
        }
        if (sendToAgent(agentId, { type: "screen:monitors" })) break;
        if (!cached?.length) {
          ws.send(JSON.stringify({
            type: "screen:monitors",
            agentId,
            monitors: [],
            error: "agente offline ou desatualizado — reinicie o OneDesk Agent",
          }));
        }
        break;
      }
      case "webrtc:offer": {
        sendToAgent(agentId, {
          type: "webrtc:offer",
          sdp: msg.sdp,
          fps: msg.fps || 20,
          monitor: msg.monitor ?? -1,
        });
        break;
      }
      case "webrtc:ice": {
        sendToAgent(agentId, {
          type: "webrtc:ice",
          candidate: msg.candidate,
          sdpMid: msg.sdpMid,
          sdpMLineIndex: msg.sdpMLineIndex,
        });
        break;
      }
      case "webrtc:stop": {
        sendToAgent(agentId, { type: "webrtc:stop" });
        break;
      }
      case "screenshot": {
        const machineId = agents.get(agentId)?.machineId;
        sendToAgent(agentId, { type: "screenshot" });
        if (machineId)
          safeAudit(() =>
            db.insert(auditLog).values({ userId: claims.sub, machineId, action: "screenshot" })
          );
        break;
      }
      case "notify": {
        const machineId = agents.get(agentId)?.machineId;
        sendToAgent(agentId, {
          type: "notify",
          title: msg.title || "OneDesk",
          message: msg.message || "",
          popup: !!msg.popup,
        });
        if (machineId)
          safeAudit(() =>
            db.insert(auditLog).values({
              userId: claims.sub,
              machineId,
              action: "notify",
              detail: { title: msg.title, message: String(msg.message || "").slice(0, 500) },
            })
          );
        break;
      }
      case "input:mouse": {
        sendToAgent(agentId, {
          type: "input:mouse",
          x: msg.x,
          y: msg.y,
          button: msg.button,
          action: msg.action,
        });
        break;
      }
      case "input:key": {
        sendToAgent(agentId, {
          type: "input:key",
          key: msg.key,
          down: msg.down,
          ctrl: !!msg.ctrl,
          alt: !!msg.alt,
          meta: !!msg.meta,
          shift: !!msg.shift,
        });
        break;
      }
      case "input:release": {
        sendToAgent(agentId, { type: "input:release" });
        break;
      }
      case "remote:block-input": {
        sendToAgent(agentId, { type: "remote:block-input", enabled: !!msg.enabled });
        break;
      }
      case "remote:privacy": {
        sendToAgent(agentId, { type: "remote:privacy", enabled: !!msg.enabled });
        break;
      }
      case "location:request": {
        const machineId = agents.get(agentId)?.machineId;
        sendToAgent(agentId, { type: "location:request" });
        if (machineId)
          safeAudit(() =>
            db.insert(auditLog).values({ userId: claims.sub, machineId, action: "location:request" })
          );
        break;
      }
      case "agent:update": {
        const machineId = agents.get(agentId)?.machineId;
        const ok = sendToAgent(agentId, { type: "agent:update" });
        ws.send(JSON.stringify({
          type: "agent:update:ack",
          agentId,
          ok,
          error: ok ? null : "agente offline ou desconectado",
        }));
        if (machineId)
          safeAudit(() =>
            db.insert(auditLog).values({ userId: claims.sub, machineId, action: "agent:update" })
          );
        break;
      }
      case "clipboard:set": {
        sendToAgent(agentId, { type: "clipboard:set", text: msg.text });
        break;
      }
      case "clipboard:get": {
        sendToAgent(agentId, { type: "clipboard:get" });
        break;
      }
      case "file:chunk": {
        sendToAgent(agentId, {
          type: "file:chunk",
          id: msg.id,
          name: msg.name,
          seq: msg.seq,
          last: msg.last,
          data: msg.data,
          paste: !!msg.paste,
        });
        if (msg.last) {
          const machineId = agents.get(agentId)?.machineId;
          if (machineId)
            safeAudit(() =>
              db.insert(auditLog).values({
                userId: claims.sub,
                machineId,
                action: msg.paste ? "clipboard:paste-file" : "file:push",
                detail: { name: msg.name },
              })
            );
        }
        break;
      }
      case "clipboard:paste-text": {
        sendToAgent(agentId, { type: "clipboard:paste-text", text: msg.text });
        break;
      }
      case "clipboard:paste-commit": {
        sendToAgent(agentId, { type: "clipboard:paste-commit" });
        break;
      }
      case "lock:setpass": {
        sendToAgent(agentId, { type: "lock:setpass", password: msg.password });
        break;
      }
      case "lock:on":
      case "lock:off": {
        const locked = msg.type === "lock:on";
        const machineId = agents.get(agentId)?.machineId;
        sendToAgent(agentId, { type: msg.type });
        if (machineId) {
          safeAudit(() => db.update(machines).set({ locked }).where(eq(machines.id, machineId)));
          safeAudit(() =>
            db.insert(auditLog).values({ userId: claims.sub, machineId, action: locked ? "lock:on" : "lock:off" })
          );
        }
        broadcastToDashboards(agentId, { type: "lock:state", agentId, locked });
        break;
      }
    }
  });

  ws.on("close", () => {
    allConsoles.delete(ws);
    for (const agentId of mySubscriptions) {
      subscribers.get(agentId)?.delete(ws);
    }
  });
}

// Varredura de inatividade: se um agente parar de enviar dados (queda "suja" do
// tunel), derruba a conexao em ate ~25s -> dispara o close -> marca offline.
// Evita maquina "online fantasma" no dashboard.
const AGENT_TIMEOUT_MS = 25000;
setInterval(() => {
  const now = Date.now();
  for (const a of agents.values()) {
    if (now - a.lastActivity > AGENT_TIMEOUT_MS) {
      console.log(`[agent] inativo > ${AGENT_TIMEOUT_MS}ms, derrubando: ${a.hostname} (${a.agentId})`);
      try {
        a.ws.terminate();
      } catch {}
    }
  }
}, 8000);

server.listen(PORT, () => {
  console.log(`\n  OneDesk Hub rodando em :${PORT}`);
  console.log(`  - Agentes:   ws://localhost:${PORT}/agent?token=...`);
  console.log(`  - Console:   ws://localhost:${PORT}/console?ticket=...`);
  console.log(`  - Health:    http://localhost:${PORT}/health\n`);
});
