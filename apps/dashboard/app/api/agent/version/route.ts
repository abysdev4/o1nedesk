import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, agentRelease } from "@onedesk/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GITHUB_REPO = process.env.GITHUB_RELEASE_REPO || "abysdev4/o1nedesk";

function githubDownloadUrl(version: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/OneDeskAgent-Setup.exe`;
}

// Manifesto de versao do agente (publico — o agente consulta para auto-update)
export async function GET() {
  const rows = await db.select().from(agentRelease).where(eq(agentRelease.id, "latest"));
  const r = rows[0];
  const version = r?.version || "1.0.0";
  const downloadUrl = r?.downloadUrl || githubDownloadUrl(version);
  return NextResponse.json({
    version,
    sha256: r?.sha256 || null,
    notes: r?.notes || null,
    downloadUrl,
    // Fallback quando GitHub estiver bloqueado na rede do cliente
    downloadPath: "/download/agent",
  });
}
