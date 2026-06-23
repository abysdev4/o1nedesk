import { NextResponse } from "next/server";
import { db, hubRegistry } from "@onedesk/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Recebe a URL publica atual do hub (chamado pelo servidor local a cada ~30s)
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}) as any);
  const secret = body.secret || req.headers.get("x-hub-secret");
  if (!secret || secret !== process.env.HUB_INTERNAL_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = String(body.url || "").trim();
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  await db
    .insert(hubRegistry)
    .values({ id: "main", url, updatedAt: new Date() })
    .onConflictDoUpdate({ target: hubRegistry.id, set: { url, updatedAt: new Date() } });

  return NextResponse.json({ ok: true });
}
