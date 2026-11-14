import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { requireRole } from "@/lib/server/auth";
import { rateLimitSnapshot } from "@/lib/server/ratelimit";
import { runCounts } from "@/lib/server/runs";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("engineer");
  if (!auth.ok) return auth.response;
  const counts = await runCounts();
  const [duration] = await db
    .select({
      avgMs: sql<number>`coalesce(cast(avg(runtime_ms) as double precision), 0)`,
      p95Ms: sql<number>`coalesce(cast(percentile_disc(0.95) within group (order by runtime_ms) as double precision), 0)`,
      maxMs: sql<number>`coalesce(cast(max(runtime_ms) as double precision), 0)`,
    })
    .from(sql`run_results`);
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const [stageRows] = await db
    .select({ counts: sql<Record<string, number>>`jsonb_object_agg(stage, n)` })
    .from(sql`(select stage, cast(count(*) as int) as n from runs group by stage) s`);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    process: {
      uptimeSec: Math.round(process.uptime()),
      rssMb: Number((memory.rss / 1048576).toFixed(1)),
      heapUsedMb: Number((memory.heapUsed / 1048576).toFixed(1)),
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      node: process.version,
    },
    runs: counts,
    duration,
    stages: stageRows?.counts ?? {},
    rateLimit: rateLimitSnapshot(),
    queue: { mode: "in-process worker", active: counts?.running ?? 0 },
  });
}
