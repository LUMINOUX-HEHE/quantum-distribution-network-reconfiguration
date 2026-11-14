import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { networks, runs } from "@/db/schema";
import { createRun, enqueueRun, listRuns } from "@/lib/server/runs";
import { isSolverId, normaliseRunParams } from "@/lib/networks/types";
import { solverAvailability } from "@/lib/optimization/solvers";
import { getSettings } from "@/lib/server/data";
import { requireRole } from "@/lib/server/auth";
import { auditWithSession } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40)));
  const rows = await listRuns(limit);
  return NextResponse.json({ runs: rows });
}

export async function POST(request: Request) {
  const auth = await requireRole("engineer");
  if (!auth.ok) return auth.response;
  const limited = enforceRateLimit(request, "runs:create", { limit: 30, actor: auth.session.username });
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const networkId = Number(body.networkId);
  if (!Number.isFinite(networkId)) {
    return NextResponse.json({ error: "networkId is required" }, { status: 400 });
  }
  const [network] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
  if (!network) return NextResponse.json({ error: "Network not found" }, { status: 404 });

  const solverRaw = body.solver;
  if (!isSolverId(solverRaw)) {
    return NextResponse.json({ error: "Unknown solver" }, { status: 400 });
  }
  const availability = solverAvailability(solverRaw);
  if (!availability.available) {
    return NextResponse.json(
      { error: `Solver unavailable: ${availability.reason}` },
      { status: 400 },
    );
  }

  const defaults = await getSettings();
  const params = normaliseRunParams(body.params ?? defaults);
  const seed = Number.isFinite(Number(body.seed)) ? Math.floor(Number(body.seed)) : Date.now() % 1_000_000;
  const signature = JSON.stringify({ networkId, solver: solverRaw, params, seed });

  // Result caching: an identical experiment (network + solver + params + seed)
  // returns the stored run instead of recomputing it.
  if (body.reuseCached !== false) {
    const [cached] = await db
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(and(eq(runs.signature, signature), eq(runs.status, "completed")))
      .limit(1);
    if (cached) {
      await auditWithSession(auth.session, "run.cache_hit", { resource: `run:${cached.id}`, detail: { signature } });
      return NextResponse.json(
        { run: { id: cached.id, status: cached.status, seed }, cached: true },
        { status: 200 },
      );
    }
  }

  const run = await createRun({
    signature,
    networkId,
    solver: solverRaw,
    params,
    seed,
    label: typeof body.label === "string" ? body.label.slice(0, 120) : "",
  });
  enqueueRun(run.id);
  await auditWithSession(auth.session, "run.create", {
    resource: `run:${run.id}`,
    detail: { networkId, solver: solverRaw, seed, params },
  });
  return NextResponse.json({ run: { id: run.id, status: run.status, seed: run.seed }, cached: false }, { status: 202 });
}
