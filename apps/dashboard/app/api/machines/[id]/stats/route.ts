import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, machineStats } from "@onedesk/db";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const since = new Date(Date.now() - 1000 * 60 * 60); // ultima hora

  const rows = await db
    .select()
    .from(machineStats)
    .where(and(eq(machineStats.machineId, id), gte(machineStats.capturedAt, since)))
    .orderBy(desc(machineStats.capturedAt))
    .limit(120);

  return NextResponse.json({ stats: rows.reverse() });
}
