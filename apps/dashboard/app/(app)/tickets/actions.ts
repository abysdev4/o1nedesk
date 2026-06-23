"use server";

import { db, tickets, auditLog } from "@onedesk/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function createTicket(formData: FormData) {
  const s = await getSession();
  if (!s) return;

  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const description = String(formData.get("description") || "");
  const priority = String(formData.get("priority") || "normal");
  const machineId = String(formData.get("machineId") || "") || null;

  await db.insert(tickets).values({
    title,
    description,
    priority,
    machineId,
    assignedTo: s.sub,
  });

  await db.insert(auditLog).values({
    userId: s.sub,
    machineId,
    action: "ticket:create",
    detail: { title },
  });

  revalidatePath("/tickets");
}
