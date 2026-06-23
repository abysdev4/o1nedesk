import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  index,
  boolean,
} from "drizzle-orm/pg-core";

// ===== Usuarios (admin / tecnicos) =====
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("technician"), // admin | technician
  mfaSecret: text("mfa_secret"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Maquinas (clientes com agente instalado) =====
export const machines = pgTable(
  "machines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: text("agent_id").notNull().unique(), // gerado pelo agente na 1a execucao
    hostname: text("hostname").notNull().default(""),
    label: text("label"), // nome amigavel definido pelo tecnico
    os: text("os").notNull().default(""),
    osVersion: text("os_version").notNull().default(""),
    agentVersion: text("agent_version").notNull().default(""),
    publicIp: text("public_ip"),
    localIp: text("local_ip"),
    username: text("username"), // usuario logado na maquina
    specs: jsonb("specs"), // informacoes tecnicas (CPU, modelo, RAM, GPU, etc.)
    lastLocation: jsonb("last_location"), // { lat, lng, accuracy, source, city, at }
    lockPasswordHash: text("lock_password_hash"), // senha de bloqueio (bcrypt), por dispositivo
    locked: boolean("locked").notNull().default(false),
    status: text("status").notNull().default("offline"), // online | offline
    consentAt: timestamp("consent_at", { withTimezone: true }), // quando o usuario aceitou na instalacao
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("machines_status_idx").on(t.status),
  })
);

// ===== Estatisticas (serie temporal) =====
export const machineStats = pgTable(
  "machine_stats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    cpu: doublePrecision("cpu").notNull().default(0), // %
    memUsed: bigint("mem_used", { mode: "number" }).notNull().default(0), // bytes
    memTotal: bigint("mem_total", { mode: "number" }).notNull().default(0),
    diskUsed: bigint("disk_used", { mode: "number" }).notNull().default(0),
    diskTotal: bigint("disk_total", { mode: "number" }).notNull().default(0),
    netUp: bigint("net_up", { mode: "number" }).notNull().default(0), // bytes/s
    netDown: bigint("net_down", { mode: "number" }).notNull().default(0),
    procCount: integer("proc_count").notNull().default(0),
    uptime: bigint("uptime", { mode: "number" }).notNull().default(0), // segundos
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    machineTimeIdx: index("stats_machine_time_idx").on(t.machineId, t.capturedAt),
  })
);

// ===== Sessoes remotas =====
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  machineId: uuid("machine_id")
    .notNull()
    .references(() => machines.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // terminal | screen | control | file
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// ===== Comandos executados (auditoria do terminal) =====
export const commands = pgTable(
  "commands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => machines.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    shell: text("shell").notNull().default("cmd"), // cmd | powershell
    command: text("command").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    machineIdx: index("commands_machine_idx").on(t.machineId),
  })
);

// ===== Log de auditoria geral =====
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  detail: jsonb("detail"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Tickets de helpdesk =====
export const tickets = pgTable("tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("open"), // open | in_progress | resolved | closed
  priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Alertas (tamper/seguranca: tentativa de fechar, queda, restart) =====
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    machineId: uuid("machine_id").references(() => machines.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // close_attempt | agent_down | restarted | location
    severity: text("severity").notNull().default("warn"), // info | warn | danger
    message: text("message").notNull().default(""),
    detail: jsonb("detail"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("alerts_created_idx").on(t.createdAt),
  })
);

// ===== Release do agente (auto-update) =====
export const agentRelease = pgTable("agent_release", {
  id: text("id").primaryKey().default("latest"),
  version: text("version").notNull().default("1.0.0"),
  sha256: text("sha256"),
  downloadUrl: text("download_url"),
  notes: text("notes"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Registro do hub (descoberta dinamica da URL publica + heartbeat) =====
export const hubRegistry = pgTable("hub_registry", {
  id: text("id").primaryKey().default("main"),
  url: text("url").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Machine = typeof machines.$inferSelect;
export type MachineStat = typeof machineStats.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
