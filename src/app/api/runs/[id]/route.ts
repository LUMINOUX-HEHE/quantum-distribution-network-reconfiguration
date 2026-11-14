import { NextResponse } from "next/server";
import { getRunDetail } from "@/lib/server/runs";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel } from "@/lib/power/model";
import { findLoops } from "@/lib/power/topology";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  const detail = await getRunDetail(runId);
  if (!detail) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const rows = await loadNetworkRows(detail.run.networkId);
  const model = rows ? buildModel(rows, 0) : null;
  const topology = model ? findLoops(model) : null;

  return NextResponse.json({
    run: detail.run,
    network: rows
      ? {
          id: detail.run.networkId,
          name: rows.name,
          source: rows.source,
          baseMva: rows.baseMva,
          baseKv: rows.baseKv,
          bestKnownLossKw: rows.bestKnownLossKw,
          buses: model?.buses ?? [],
          lines: model?.lines ?? [],
          loops:
            topology?.loops.map((l) => ({
              index: l.index,
              label: l.label,
              options: l.options.map((i) => model?.lines[i].branch ?? i),
            })) ?? [],
        }
      : null,
    candidates: detail.candidates,
    result: detail.result,
  });
}
