import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel } from "@/lib/power/model";
import { analyseTopology } from "@/lib/power/topology";
import { checkLimits, runAcPowerFlow } from "@/lib/power/powerflow";

export const dynamic = "force-dynamic";

/**
 * Live evaluation for the interactive switch editor. Accepts an explicit open
 * branch list, checks radiality, runs the exact AC sweep and reports violations
 * so an operator can see the physical consequence of every toggle before any
 * plan is submitted.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required", code: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;
  const networkId = Number(id);
  if (!Number.isFinite(networkId)) {
    return NextResponse.json({ error: "Invalid network id", code: "invalid_request" }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON", code: "invalid_body" }, { status: 400 });
  }
  const rows = await loadNetworkRows(networkId);
  if (!rows) return NextResponse.json({ error: "Network not found", code: "not_found" }, { status: 404 });

  const branchNumbers = Array.isArray(body.openBranches) ? body.openBranches.map(Number) : [];
  const model = buildModel(rows, Number(body.derPenetrationPct ?? 0));
  const openSet = new Set(
    model.lines.filter((l) => branchNumbers.includes(l.branch)).map((l) => l.index),
  );
  const limits = {
    voltageMin: Number(body.voltageMin ?? 0.9),
    voltageMax: Number(body.voltageMax ?? 1.05),
    maxLoadingPct: Number(body.maxLoadingPct ?? 100),
  };

  const topology = analyseTopology(model, openSet);
  const pf = runAcPowerFlow(model, openSet);
  const check = checkLimits(pf, limits);

  return NextResponse.json({
    radial: topology.isRadial,
    edgesClosed: topology.edgesClosed,
    expectedEdges: model.buses.length - 1,
    components: topology.components,
    openBranches: model.lines.filter((l) => openSet.has(l.index)).map((l) => l.branch),
    converged: pf.converged,
    lossKw: pf.lossKw === null ? null : Number(pf.lossKw.toFixed(3)),
    vMin: Number(pf.vMin.toFixed(5)),
    vMax: Number(pf.vMax.toFixed(5)),
    vMinBus: pf.vMinBus,
    maxLoadingPct: Number(pf.maxLoadingPct.toFixed(2)),
    voltageProfile: pf.voltageProfile,
    loadingProfile: pf.loadingProfile,
    feasible: check.feasible,
    violation: check.violation,
    message: topology.isRadial ? null : "Configuration is not a radial spanning tree",
  });
}
