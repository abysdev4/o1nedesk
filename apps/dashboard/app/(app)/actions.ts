"use server";

import { eq } from "drizzle-orm";
import { db, machines, auditLog } from "@onedesk/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function renameMachine(id: string, label: string) {
  const s = await getSession();
  if (!s) return { error: "unauthorized" };
  const clean = label.trim().slice(0, 120);
  await db.update(machines).set({ label: clean || null }).where(eq(machines.id, id));
  await db.insert(auditLog).values({
    userId: s.sub,
    machineId: id,
    action: "machine:rename",
    detail: { label: clean },
  });
  revalidatePath("/");
  revalidatePath(`/machines/${id}`);
  return { ok: true };
}

export async function setLockPassword(id: string, password: string) {
  const s = await getSession();
  if (!s) return { error: "unauthorized" };
  if (!password || password.length < 4) return { error: "senha muito curta" };
  const bcrypt = (await import("bcryptjs")).default;
  const hash = await bcrypt.hash(password, 10);
  await db.update(machines).set({ lockPasswordHash: hash }).where(eq(machines.id, id));
  await db.insert(auditLog).values({ userId: s.sub, machineId: id, action: "lock:setpass" });
  revalidatePath(`/machines/${id}`);
  return { ok: true };
}

export async function deleteMachine(id: string) {
  const s = await getSession();
  if (!s || s.role !== "admin") return { error: "forbidden" };
  await db.insert(auditLog).values({
    userId: s.sub,
    action: "machine:delete",
    detail: { machineId: id },
  });
  await db.delete(machines).where(eq(machines.id, id));
  revalidatePath("/");
  return { ok: true };
}
