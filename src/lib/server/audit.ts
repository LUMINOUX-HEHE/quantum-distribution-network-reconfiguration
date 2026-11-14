import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import type { Session } from "./auth";

export async function writeAudit(input: {
  actor: string;
  role: string;
  action: string;
  resource?: string;
  outcome?: "success" | "failure";
  detail?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actor: input.actor,
      role: input.role,
      action: input.action,
      resource: input.resource ?? "",
      outcome: input.outcome ?? "success",
      detail: input.detail ?? {},
      ip: input.ip ?? "",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        scope: "audit",
        message: "failed to persist audit entry",
        action: input.action,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function auditWithSession(
  session: Session | null,
  action: string,
  extra: { resource?: string; outcome?: "success" | "failure"; detail?: Record<string, unknown>; ip?: string } = {},
) {
  return writeAudit({
    actor: session?.username ?? "anonymous",
    role: session?.role ?? "none",
    action,
    ...extra,
  });
}

export async function recentAudit(limit = 50) {
  return db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(limit);
}
