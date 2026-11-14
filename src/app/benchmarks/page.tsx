import Link from "next/link";
import { PageHeader, Panel, Stat, StatusBadge, fmt, pct, since } from "@/components/ui";
import { SolverComparison, ScalingChart } from "@/components/charts";
import { BenchmarkRunner } from "@/components/client";
import { getBenchmark, listBenchmarks } from "@/lib/server/benchmarks";
import { listNetworks } from "@/lib/server/data";

export const dynamic = "force-dynamic";

const solverLabel: Record<string, string> = {
  "simulated-annealing": "Simulated annealing",
  "quantum-inspired": "Quantum-inspired",
  "qaoa-simulator": "QAOA simulator",
  "baseline:branch-exchange": "Branch exchange (classical)",
  "baseline:brute-force": "Brute force (classical)",
};

export default async function BenchmarksPage() {
  const [benchmarks, networks] = await Promise.all([listBenchmarks(8), listNetworks()]);
  const latestCompleted = benchmarks.find((b) => b.status === "completed");
  const latest = latestCompleted ? await getBenchmark(latestCompleted.id) : null;
  const history = await Promise.all(
    benchmarks.filter((b) => b.id !== latest?.benchmark.id).slice(0, 3).map((b) => getBenchmark(b.id)),
  );

  const entries = latest?.entries ?? [];
  const allEntries = [...entries, ...history.flatMap((h) => h?.entries ?? [])];
  const bestEntry = entries.reduce<typeof entries[number] | null>((acc, entry) => {
    if (entry.lossKw === null) return acc;
    if (!acc || (acc.lossKw ?? Infinity) > entry.lossKw) return entry;
    return acc;
  }, null);
  const solverEntries = entries.filter((e) => !e.solver.startsWith("baseline:"));
  const fastest = solverEntries.reduce<typeof entries[number] | null>((acc, entry) => {
    if (entry.runtimeMs === null) return acc;
    if (!acc || (acc.runtimeMs ?? Infinity) > entry.runtimeMs) return entry;
    return acc;
  }, null);

  return (
    <div>
      <PageHeader
        eyebrow="Benchmark harness"
        title="Solver and baseline comparison"
        description="Every suite runs each available solver on the same network snapshot, seed and formulation parameters, then compares losses, feasibility, gap and time-to-solution against classical branch exchange and brute-force enumeration. No quantum-advantage claim is made."
        actions={<Link className="btn" href="/runs/new">Custom run</Link>}
      />

      <Panel title="Run a new comparison suite" subtitle="One run per network × solver, plus classical baselines" actions={<span className="badge info">real AC validation</span>}>
        <BenchmarkRunner networks={networks.map((n) => ({ id: n.id, name: n.name }))} />
      </Panel>

      {latest ? (
        <>
          <div className="grid grid-4" style={{ marginTop: 14 }}>
            <Stat label="Suite entries" value={entries.length} hint={`benchmark #${latest.benchmark.id} · ${latest.benchmark.status}`} />
            <Stat label="Best loss" value={bestEntry?.lossKw ? fmt(bestEntry.lossKw) : "—"} unit="kW" hint={bestEntry ? `${bestEntry.networkName} · ${solverLabel[bestEntry.solver] ?? bestEntry.solver}` : undefined} tone="cyan" />
            <Stat label="Closest to reference" value={pct(Math.min(...entries.map((e) => e.gapPct ?? 100)))} hint="gap to stored optimum" tone="violet" />
            <Stat label="Fastest solver" value={fastest?.runtimeMs ? `${fastest.runtimeMs}` : "—"} unit="ms" hint={fastest ? `${fastest.networkName} · ${solverLabel[fastest.solver] ?? fastest.solver}` : undefined} tone="amber" />
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <Panel title="Loss by method" subtitle="Lower is better — validated AC losses in kW">
              <SolverComparison entries={entries.map((e) => ({ solver: e.solver, lossKw: e.lossKw, networkName: e.networkName }))} />
            </Panel>
            <Panel title="Time to solution vs network size" subtitle="Single worker, cold start">
              <ScalingChart
                entries={allEntries
                  .filter((e) => e.runtimeMs !== null)
                  .map((e) => ({ solver: e.solver, busCount: e.busCount ?? 0, runtimeMs: e.runtimeMs, networkName: e.networkName }))}
              />
            </Panel>
          </div>

          <div style={{ marginTop: 14 }}>
            <Panel
              title={`Suite #${latest.benchmark.id} results`}
              subtitle={latest.benchmark.name}
              actions={<StatusBadge status={latest.benchmark.status} />}
              noBody
            >
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Network</th>
                      <th>Method</th>
                      <th>Status</th>
                      <th className="num">Loss kW</th>
                      <th className="num">Reduction</th>
                      <th className="num">Gap</th>
                      <th className="num">Feasibility</th>
                      <th className="num">Vmin</th>
                      <th className="num">Runtime</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.networkName}<div className="helper mono">{entry.busCount} buses</div></td>
                        <td>{solverLabel[entry.solver] ?? entry.solver}</td>
                        <td><StatusBadge status={entry.status} /></td>
                        <td className="num" style={{ color: "#dffcef" }}>{fmt(entry.lossKw)}</td>
                        <td className="num" style={{ color: (entry.lossReductionPct ?? 0) > 0 ? "#8af3c4" : "#8ba0b8" }}>{entry.lossReductionPct !== null ? pct(entry.lossReductionPct) : "—"}</td>
                        <td className="num">{entry.gapPct !== null ? pct(entry.gapPct) : "—"}</td>
                        <td className="num">{entry.feasibilityRate !== null ? pct(entry.feasibilityRate * 100) : "—"}</td>
                        <td className="num">{entry.voltageMin !== null ? entry.voltageMin.toFixed(4) : "—"}</td>
                        <td className="num">{entry.runtimeMs} ms</td>
                        <td className="num">
                          {entry.runId ? <Link className="badge info" href={`/runs/${entry.runId}`}>inspect</Link> : <span className="badge">baseline</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 14 }}>
          <Panel title="No completed suite yet">
            <p className="helper">
              Run a comparison suite above. It creates one optimisation run per network and solver, executes the classical
              baselines on identical inputs and aggregates the results here. Expect roughly 10–30 seconds depending on
              network size and solver selection.
            </p>
          </Panel>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <Panel title="Suite history" subtitle="Configuration and aggregate results" noBody>
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Suite</th>
                  <th>Status</th>
                  <th className="num">Entries</th>
                  <th>Best per network</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.length === 0 ? (
                  <tr><td colSpan={5} className="helper">No suites recorded.</td></tr>
                ) : null}
                {benchmarks.map((b) => {
                  const perNetwork = (b.summary as { perNetwork?: { networkName: string; bestSolver: string; bestLossKw: number }[] })?.perNetwork;
                  return (
                    <tr key={b.id}>
                      <td>#{b.id} · {b.name}</td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="num">{(b.summary as { entries?: number })?.entries ?? "—"}</td>
                      <td className="helper">
                        {perNetwork?.map((p) => `${p.networkName.replace("IEEE ", "")}: ${p.bestLossKw.toFixed(1)} kW (${solverLabel[p.bestSolver] ?? p.bestSolver})`).join(" · ") ?? "—"}
                      </td>
                      <td className="helper">{since(b.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
