"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, users, auditLog } from "@onedesk/db";
import { createSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Informe e-mail e senha." };
  }

  const found = await db.select().from(users).where(eq(users.email, email));
  const user = found[0];
  if (!user || !user.active) {
    return { error: "Credenciais invalidas." };
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return { error: "Credenciais invalidas." };
  }

  await db.insert(auditLog).values({
    userId: user.id,
    action: "auth:login",
    detail: { email },
  });

  await createSession({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  redirect("/");
}
