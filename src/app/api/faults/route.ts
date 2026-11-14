import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { auditWithSession } from "@/lib/server/audit";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { listFaultStudies, runFaultStudy } from "@/lib/server/resilience";
import type { FaultSpec } from "@/lib/power/faults";

export const dynamic = "force-dynamic";

export async function GET() {
  const studies = await listFaultStudies();
  return NextResponse.json({ studies });
}

export async function POST(request: Request) {
  const auth = await requireRole("engineer");
  if (!auth.ok) return auth.response;
  const limited = enforceRateLimit(request, "faults:run", { limit: 20, actor: auth.session.username });
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON", code: "invalid_body" }, { status: 400 });
  }
  const networkId = Number(body.networkId);
  if (!Number.isFinite(networkId)) {
    return NextResponse.json({ error: "networkId is required", code: "invalid_request" }, { status: 400 });
  }
  const rawFaults = Array.isArray(body.faults) ? body.faults : [];
  const faults: FaultSpec[] = rawFaults
    .map((f) => f as Record<string, unknown>)
    .filter((f) => Number.isFinite(Number(f.branch)))
    .map((f) => ({
      branch: Number(f.branch),
      kind: f.kind === "switch-open" || f.kind === "switch-stuck-closed" ? f.kind : "line",
    }));
  try {
    const result = await runFaultStudy({
      networkId,
      label: typeof body.label === "string" ? body.label : undefined,
      faults,
      criticalBuses: Array.isArray(body.criticalBuses) ? body.criticalBuses.map(String) : [],
      limits: (body.limits ?? {}) as Record<string, number>,
      actor: auth.session.username,
    });
    await auditWithSession(auth.session, "fault.study", {
      resource: `network:${networkId}`,
      detail: { mode: faults.length ? "contingency" : "n1-scan", faults: faults.length, studyId: result.studyId },
    });
    return NextResponse.json({ ...result, mode: faults.length ? "contingency" : "n1-scan" }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fault study failed", code: "study_failed" },
      { status: 500 },
    );
  }
}
