import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env") });

import bcrypt from "bcryptjs";
import { db, users } from "./index";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.ADMIN_EMAIL || "henrique@onedata.com";
  const password = process.env.ADMIN_PASSWORD || "henrique21";
  const name = process.env.ADMIN_NAME || "Henrique";

  const hash = await bcrypt.hash(password, 10);

  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    await db
      .update(users)
      .set({ passwordHash: hash, name, role: "admin", active: true })
      .where(eq(users.email, email));
    console.log(`✓ Admin atualizado: ${email}`);
  } else {
    await db.insert(users).values({
      email,
      passwordHash: hash,
      name,
      role: "admin",
    });
    console.log(`✓ Admin criado: ${email}`);
  }

  console.log("Seed concluido.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
