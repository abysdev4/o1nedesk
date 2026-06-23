import { desc, eq } from "drizzle-orm";
import { db, tickets, machines, users } from "@onedesk/db";
import { timeAgo } from "@/lib/format";
import { createTicket } from "./actions";

export const dynamic = "force-dynamic";

const statusColors: Record<string, string> = {
  open: "bg-accent/15 text-accent",
  in_progress: "bg-warn/15 text-warn",
  resolved: "bg-ok/15 text-ok",
  closed: "bg-panel2 text-muted",
};

export default async function TicketsPage() {
  const rows = await db
    .select({
      id: tickets.id,
      title: tickets.title,
      status: tickets.status,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      hostname: machines.hostname,
      assignee: users.name,
    })
    .from(tickets)
    .leftJoin(machines, eq(tickets.machineId, machines.id))
    .leftJoin(users, eq(tickets.assignedTo, users.id))
    .orderBy(desc(tickets.createdAt))
    .limit(100);

  const machineList = await db
    .select({ id: machines.id, hostname: machines.hostname, label: machines.label })
    .from(machines);

  return (
    <div className="p-6 w-full">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Tickets</h1>
      <p className="text-sm text-muted mb-6">Chamados de suporte vinculados as maquinas.</p>

      <form action={createTicket} className="card p-4 mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input name="title" required placeholder="Titulo do chamado" className="input md:col-span-2" />
        <select name="machineId" className="input">
          <option value="">— maquina (opcional) —</option>
          {machineList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label || m.hostname}
            </option>
          ))}
        </select>
        <select name="priority" className="input">
          <option value="normal">Normal</option>
          <option value="low">Baixa</option>
          <option value="high">Alta</option>
          <option value="urgent">Urgente</option>
        </select>
        <textarea
          name="description"
          placeholder="Descricao"
          className="input md:col-span-3"
          rows={2}
        />
        <button className="btn-primary">Abrir ticket</button>
      </form>

      <div className="card divide-y divide-border">
        {rows.length === 0 && <div className="p-6 text-sm text-muted">Nenhum ticket aberto.</div>}
        {rows.map((t) => (
          <div key={t.id} className="px-4 py-3 flex items-center gap-3 text-sm">
            <span className={`badge shrink-0 ${statusColors[t.status] || "bg-panel2 text-muted"}`}>
              {t.status}
            </span>
            <div className="flex-1 min-w-0">
              <div className="truncate">{t.title}</div>
              <div className="text-xs text-muted truncate">
                {t.hostname || "sem maquina"} · prioridade {t.priority}
              </div>
            </div>
            <span className="text-xs text-muted shrink-0">{timeAgo(t.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
