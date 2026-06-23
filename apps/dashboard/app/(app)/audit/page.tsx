import { desc, eq } from "drizzle-orm";
import { db, auditLog, users, machines } from "@onedesk/db";
import AuditView from "@/components/AuditView";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      userName: users.name,
      hostname: machines.hostname,
      label: machines.label,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .leftJoin(machines, eq(auditLog.machineId, machines.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(500);

  return (
    <div className="p-6 w-full">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Auditoria</h1>
      <p className="text-sm text-muted mb-5">Registro de acessos, sessões e ações na plataforma.</p>
      <AuditView rows={rows.map((r) => ({ ...r, createdAt: r.createdAt as any }))} />
    </div>
  );
}
