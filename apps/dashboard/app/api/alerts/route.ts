import { NextResponse } from "next/server";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db, alerts, machines } from "@onedesk/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: alerts.id,
      kind: alerts.kind,
      severity: alerts.severity,
      message: alerts.message,
      createdAt: alerts.createdAt,
      readAt: alerts.readAt,
      hostname: machines.hostname,
      label: machines.label,
      machineId: alerts.machineId,
    })
    .from(alerts)
    .leftJoin(machines, eq(alerts.machineId, machines.id))
    .orderBy(desc(alerts.createdAt))
    .limit(50);

  const unread = await db
    .select({ n: sql<number>`count(*)` })
    .from(alerts)
    .where(isNull(alerts.readAt));

  return NextResponse.json({ alerts: rows, unread: Number(unread[0]?.n || 0) });
}

// Marca todos como lidos
export async function POST() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await db.update(alerts).set({ readAt: new Date() }).where(isNull(alerts.readAt));
  return NextResponse.json({ ok: true });
}
