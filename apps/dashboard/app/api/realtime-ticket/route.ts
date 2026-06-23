import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, hubRegistry } from "@onedesk/db";
import { getSession, mintHubTicket } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ticket = await mintHubTicket(s);

  // URL dinamica do hub (registrada pelo servidor local); fallback para env
  let hubWs = process.env.NEXT_PUBLIC_HUB_WS || "ws://localhost:4000";
  try {
    const rows = await db.select().from(hubRegistry).where(eq(hubRegistry.id, "main"));
    if (rows[0]?.url) hubWs = rows[0].url;
  } catch {}

  return NextResponse.json({ ticket, hubWs });
}
