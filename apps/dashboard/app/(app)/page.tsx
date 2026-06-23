import { desc, eq } from "drizzle-orm";
import { db, machines, agentRelease } from "@onedesk/db";
import FleetGrid from "@/components/FleetGrid";

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const list = await db
    .select()
    .from(machines)
    .orderBy(desc(machines.status), desc(machines.lastSeen));

  const rel = await db.select().from(agentRelease).where(eq(agentRelease.id, "latest"));
  const latestVersion = rel[0]?.version || "1.0.0";

  const online = list.filter((m) => m.status === "online").length;

  return (
    <div className="p-6 w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Frota de maquinas</h1>
          <p className="text-sm text-muted mt-0.5">
            {list.length} maquina(s) · <span className="text-ok">{online} online</span>
          </p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-muted">
            Nenhuma maquina cadastrada. Instale o agente OneDesk em um cliente para ve-lo
            aparecer aqui automaticamente.
          </p>
        </div>
      ) : (
        <FleetGrid initial={list.map((m) => ({ machine: m }))} latestVersion={latestVersion} />
      )}
    </div>
  );
}
