import { NextResponse } from "next/server";
import { listBenchmarks, runBenchmarkSuite } from "@/lib/server/benchmarks";
import { requireRole } from "@/lib/server/auth";
import { auditWithSession } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const rows = await listBenchmarks();
  return NextResponse.json({ benchmarks: rows });
}

export async function POST(request: Request) {
  const auth = await requireRole("engineer");
  if (!auth.ok) return auth.response;
  const limited = enforceRateLimit(request, "benchmarks:run", { limit: 6, actor: auth.session.username });
  if (limited) return limited;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  try {
    const result = await runBenchmarkSuite({
      name: typeof body.name === "string" ? body.name : undefined,
      networkIds: Array.isArray(body.networkIds)
        ? body.networkIds.map(Number).filter((n) => Number.isFinite(n))
        : undefined,
      solvers: Array.isArray(body.solvers) ? body.solvers.map(String) : undefined,
      includeBaselines: body.includeBaselines !== false,
    });
    await auditWithSession(auth.session, "benchmark.run", { detail: { ...body, ...result } });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Benchmark suite failed" },
      { status: 500 },
    );
  }
}
