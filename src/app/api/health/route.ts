import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { SOLVERS } from "@/lib/networks/types";
import { solverAvailability } from "@/lib/optimization/solvers";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database: { status: "ok" | "error"; message?: string } = { status: "ok" };
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    database = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const solvers = SOLVERS.map((s) => {
    const availability = solverAvailability(s.id);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      available: availability.available,
      reason: availability.reason,
    };
  });

  return NextResponse.json(
    {
      status: database.status === "ok" ? "ok" : "degraded",
      service: "qa-dnr",
      version: "qa-dnr/0.1.0",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      database,
      queue: { mode: "in-process worker", status: "ok" },
      solvers,
      credentials: {
        DWAVE_API_TOKEN: process.env.DWAVE_API_TOKEN ? "configured" : "not configured",
      },
    },
    { status: database.status === "ok" ? 200 : 503 },
  );
}
