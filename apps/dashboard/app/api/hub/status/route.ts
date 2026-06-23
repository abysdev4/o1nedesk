import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, hubRegistry } from "@onedesk/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Descoberta dinamica do hub — verifica se o tunel responde de fato (nao so heartbeat)
export async function GET() {
  const rows = await db.select().from(hubRegistry).where(eq(hubRegistry.id, "main"));
  const r = rows[0];
  if (!r || !r.url) {
    return NextResponse.json({ url: "", online: false, lastSeenSeconds: null, reachable: false });
  }
  const ageSec = Math.floor((Date.now() - new Date(r.updatedAt).getTime()) / 1000);
  const registered = ageSec < 40;
  let reachable = false;
  try {
    const http = r.url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const res = await fetch(`${http}/health`, { signal: AbortSignal.timeout(10_000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  return NextResponse.json({
    url: r.url,
    online: registered && reachable,
    reachable,
    registered,
    lastSeenSeconds: ageSec,
  });
}
