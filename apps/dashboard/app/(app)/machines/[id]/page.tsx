import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, machines, commands } from "@onedesk/db";
import MachineDetail from "@/components/MachineDetail";

export const dynamic = "force-dynamic";

export default async function MachinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const found = await db.select().from(machines).where(eq(machines.id, id));
  const machine = found[0];
  if (!machine) notFound();

  const recentCommands = await db
    .select()
    .from(commands)
    .where(eq(commands.machineId, id))
    .orderBy(desc(commands.createdAt))
    .limit(20);

  return <MachineDetail machine={machine} recentCommands={recentCommands} />;
}
