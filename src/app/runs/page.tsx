import Link from "next/link";
import { PageHeader, Panel, Stat, StatusBadge, fmt, pct, since } from "@/components/ui";
import { listRuns, runCounts } from "@/lib/server/runs";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const [runs, counts] = await Promise.all([listRuns(60), runCounts()]);
  const completed = runs.filter((r) => r.status === "completed" && r.finalLossKw !== null);
  const bestReduction = completed.reduce((a, r) => Math.max(a, r.lossReductionPct ?? 0), 0);
  const bestGap = completed.reduce<number | null>((acc, r) => {
    if (r.gapToBestKnownPct === null || r.gapToBestKnownPct === undefined) return acc;
    return acc === null ? r.gapToBestKnownPct : Math.min(acc, r.gapToBestKnownPct);
  }, null);

  return (
    <div>
      <PageHeader
        eyebrow="Run history"
        title="Every optimisation, reproducible"
        description="Each run stores its network snapshot, solver, seed, penalty weights, candidate set and AC validation output. Open a run to inspect the before/after topology, switching plan and comparison against baselines, or export the raw results."
        actions={<Link className="btn btn-primary" href="/runs/new">New run</Link>}
      />

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <Stat label="Total runs" value={counts?.total ?? 0} hint="queued + running + finished" />
        <Stat label="Completed" value={counts?.completed ?? 0} hint="validated recommendations" tone="cyan" />
        <Stat label="Best reduction" value={bestReduction ? pct(bestReduction) : "—"} hint="loss vs initial configuration" tone="violet" />
        <Stat label="Tightest gap" value={bestGap !== null ? pct(bestGap) : "—"} hint="to stored reference optimum" tone="amber" />
      </div>

      <Panel title="Runs" subtitle="Newest first" noBody>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th className="num">Run</th>
                <th>Network</th>
                <th>Solver</th>
                <th>Status</th>
                <th className="num">Initial kW</th>
                <th className="num">Final kW</th>
                <th className="num">Δ %</th>
                <th className="num">Feasibility</th>
                <th className="num">Gap</th>
                <th className="num">Runtime</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ color: "#8ba0b8" }}>
                    No runs yet — the IEEE 33-bus benchmark takes under a second.
                  </td>
                </tr>
              ) : null}
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="num">
                    <Link href={`/runs/${run.id}`} style={{ color: "#a5e3ff" }}>#{run.id}</Link>
                  </td>
                  <td>{run.networkName}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{run.solver}</td>
                  <td><StatusBadge status={run.status} /></td>
                  <td className="num">{fmt(run.initialLossKw)}</td>
                  <td className="num" style={{ color: "#dffcef" }}>{fmt(run.finalLossKw)}</td>
                  <td className="num" style={{ color: (run.lossReductionPct ?? 0) > 0 ? "#8af3c4" : "#8ba0b8" }}>
                    {run.lossReductionPct !== null ? pct(run.lossReductionPct) : "—"}
                  </td>
                  <td className="num">{run.feasibilityRate !== null ? pct(run.feasibilityRate * 100) : "—"}</td>
                  <td className="num">{run.gapToBestKnownPct !== null ? pct(run.gapToBestKnownPct) : "—"}</td>
                  <td className="num">{run.runtimeMs !== null ? `${run.runtimeMs} ms` : "—"}</td>
                  <td className="helper">{since(run.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
