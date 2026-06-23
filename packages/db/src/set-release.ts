import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env") });

import { db, agentRelease } from "./index";

async function main() {
  const version = process.argv[2];
  const sha = process.argv[3] || null;
  const downloadUrl = process.argv[4] || null;
  const notes = process.argv.slice(5).join(" ") || null;
  if (!version) {
    console.error("uso: release <version> <sha256> [downloadUrl] [notes]");
    process.exit(1);
  }
  await db
    .insert(agentRelease)
    .values({ id: "latest", version, sha256: sha, downloadUrl, notes })
    .onConflictDoUpdate({
      target: agentRelease.id,
      set: { version, sha256: sha, downloadUrl, notes, publishedAt: new Date() },
    });
  console.log(`✓ release publicado: v${version} (sha ${sha?.slice(0, 12)}…)`);
  if (downloadUrl) console.log(`  download: ${downloadUrl}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
