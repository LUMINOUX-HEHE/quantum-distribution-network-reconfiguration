import { NextResponse } from "next/server";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel, initialOpenSet } from "@/lib/power/model";
import { findLoops } from "@/lib/power/topology";
import { evaluateConfiguration } from "@/lib/optimization/baselines";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const networkId = Number(id);
  if (!Number.isFinite(networkId)) {
    return NextResponse.json({ error: "Invalid network id" }, { status: 400 });
  }
  const rows = await loadNetworkRows(networkId);
  if (!rows) return NextResponse.json({ error: "Network not found" }, { status: 404 });
  const model = buildModel(rows, 0);
  const topology = findLoops(model);
  const initial = evaluateConfiguration(model, initialOpenSet(model), {
    voltageMin: 0.9,
    voltageMax: 1.05,
    maxLoadingPct: 100,
  });
  return NextResponse.json({
    network: {
      id: networkId,
      name: rows.name,
      source: rows.source,
      baseMva: rows.baseMva,
      baseKv: rows.baseKv,
      bestKnownLossKw: rows.bestKnownLossKw,
    },
    buses: model.buses,
    lines: model.lines,
    derCount: rows.ders.length,
    loops: topology.loops.map((l) => ({
      index: l.index,
      label: l.label,
      options: l.options.map((i) => model.lines[i].branch),
    })),
    initial: {
      lossKw: initial.lossKw,
      vMin: initial.vMin,
      maxLoadingPct: initial.maxLoadingPct,
      feasible: initial.feasible,
      openSwitches: model.lines.filter((l) => l.initialOpen).map((l) => l.branch),
    },
  });
}
