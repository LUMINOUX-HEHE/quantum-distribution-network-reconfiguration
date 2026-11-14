import { NextResponse } from "next/server";
import { getRunDetail } from "@/lib/server/runs";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel } from "@/lib/power/model";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (!Number.isFinite(runId)) {
    return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
  }
  const detail = await getRunDetail(runId);
  if (!detail) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const rows = await loadNetworkRows(detail.run.networkId);
  const model = rows ? buildModel(rows, 0) : null;

  if (format === "csv") {
    const header = [
      "rank",
      "origin",
      "open_switches",
      "qubo_energy",
      "approx_loss_kw",
      "is_radial",
      "repaired",
      "is_feasible",
      "loss_kw",
      "v_min",
      "v_max",
      "max_loading_pct",
      "violation",
    ];
    const lines = [header.join(",")];
    for (const c of detail.candidates) {
      lines.push(
        [
          c.rank,
          c.origin,
          `"${(c.openSwitches ?? [])
            .map((idx) => model?.lines[idx]?.branch ?? idx)
            .join(" ")}"`,
          c.quboEnergy ?? "",
          c.approxLossKw ?? "",
          c.isRadial,
          c.repaired,
          c.isFeasible,
          c.lossKw ?? "",
          c.vMin ?? "",
          c.vMax ?? "",
          c.maxLoadingPct ?? "",
          `"${(c.violation ?? "").replace(/"/g, "'")}"`,
        ].join(","),
      );
    }
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="qa-dnr-run-${runId}-candidates.csv"`,
      },
    });
  }

  if (format === "json") {
    const payload = {
      schema: "qa-dnr/run-export/v1",
      exportedAt: new Date().toISOString(),
      run: detail.run,
      result: detail.result,
      candidates: detail.candidates,
      network: rows
        ? {
            name: rows.name,
            baseMva: rows.baseMva,
            baseKv: rows.baseKv,
            buses: model?.buses,
            lines: model?.lines,
          }
        : null,
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="qa-dnr-run-${runId}.json"`,
      },
    });
  }

  return NextResponse.json(
    { error: "Unsupported format. Use format=csv or format=json (PDF via the printable report)." },
    { status: 400 },
  );
}
