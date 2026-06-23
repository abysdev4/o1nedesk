import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

// Carrega o .env da raiz do monorepo quando rodando fora do Next (hub, seed, drizzle-kit)
if (!process.env.DATABASE_URL) {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    loadEnv({ path: resolve(here, "../../../.env") });
  } catch {
    /* em ambientes sem dotenv (Next), as envs ja vem do .env.local */
  }
}

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL nao definido no ambiente");
}

// Pool global reaproveitado entre hot-reloads (Next.js) e no hub
const globalForDb = globalThis as unknown as { __onedeskPool?: pg.Pool };

export const pool =
  globalForDb.__onedeskPool ??
  new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__onedeskPool = pool;
}

export const db = drizzle(pool, { schema });
export * from "./schema";
export { schema };
