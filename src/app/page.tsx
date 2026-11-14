import Link from "next/link";
import { PageHeader, Panel, Stat, StatusBadge, fmt, fmtInt, pct, since } from "@/components/ui";
import { QuickBenchmarkButton } from "@/components/client";
import { listNetworks } from "@/lib/server/data";
import { listRuns, runCounts } from "@/lib/server/runs";
import { listBenchmarks } from "@/lib/server/benchmarks";
import { SOLVERS } from "@/lib/networks/types";
import { solverAvailability } from "@/lib/optimization/solvers";

export const dynamic = "force-dynamic";

const pipeline = ["preprocess", "qubo", "solve", "repair", "ac validate", "recommend"];

export default async function OverviewPage() {
  const [networks, runs, counts, benchmarks] = await Promise.all([
    listNetworks(),
    listRuns(8),
    runCounts(),
    listBenchmarks(3),
  ]);

  const completed = runs.filter((r) => r.status === "completed" && r.finalLossKw !== null);
  const best = completed.reduce<typeof completed[number] | null>((acc, run) => {
    if (!acc) return run;
    return (run.lossReductionPct ?? 0) > (acc.lossReductionPct ?? 0) ? run : acc;
  }, null);
  const avgRuntime = completed.length
    ? completed.reduce((a, r) => a + (r.runtimeMs ?? 0), 0) / completed.length
    : null;
  const availableSolvers = SOLVERS.filter((s) => solverAvailability(s.id).available).length;

  return (
    <div>
      <PageHeader
        eyebrow="QA-DNR · hybrid quantum-classical lab"
        title="Distribution reconfiguration, validated by AC power flow"
        description="Loop-based QUBO proposals from quantum-inspired and gate-model solvers, repaired to radial configurations and scored with an exact backward/forward sweep. Every recommendation is feasible before it is published — the pipeline is advisory only."
        actions={
          <>
            <QuickBenchmarkButton />
            <Link className="btn btn-primary" href="/runs/new">
              New optimisation run
            </Link>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <Stat
          label="Best loss reduction"
          value={best ? pct(best.lossReductionPct) : "—"}
          hint={best ? `${best.networkName} · ${best.solver.replace(/-/g, " ")}` : "Run a benchmark to populate"}
          tone="green"
        />
        <Stat
          label="Lowest validated loss"
          value={best?.finalLossKw !== undefined && best?.finalLossKw !== null ? fmt(best.finalLossKw) : "—"}
          unit="kW"
          hint={best?.initialLossKw ? `from ${fmt(best.initialLossKw)} kW initial` : "awaiting runs"}
          tone="cyan"
        />
        <Stat
          label="Gap to reference"
          value={best?.gapToBestKnownPct !== undefined && best?.gapToBestKnownPct !== null ? pct(best.gapToBestKnownPct) : "—"}
          hint="0% on the IEEE 33-bus benchmark is achievable"
          tone="violet"
        />
        <Stat
          label="Mean time to solution"
          value={avgRuntime ? fmtInt(avgRuntime) : "—"}
          unit="ms"
          hint={`${counts?.completed ?? 0} completed · ${counts?.running ?? 0} active · ${counts?.failed ?? 0} failed`}
          tone="amber"
        />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <Panel
          title="Hybrid pipeline"
          subtitle="Quantum proposal → classical adjudication"
          actions={<span className="badge ok">AC-validated</span>}
        >
          <div className="pipeline" style={{ marginBottom: 14 }}>
            {pipeline.map((step, i) => (
              <span key={step} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="pipeline-step">{step}</span>
                {i < pipeline.length - 1 ? <span className="pipeline-arrow">→</span> : null}
              </span>
            ))}
          </div>
          <div style={{ display: "grid", gap: 10, fontSize: 12, color: "#8ba0b8", lineHeight: 1.6 }}>
            <p style={{ margin: 0 }}>
              <strong style={{ color: "#e6edf6" }}>Formulation.</strong> One binary per candidate open switch inside each
              fundamental loop. The objective is a LinDistFlow quadratic active-loss surrogate with cross-loop interaction
              terms; the one-hot radiality constraint enters as a penalty with an auto-tuned weight.
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: "#e6edf6" }}>Adjudication.</strong> Solvers return the top-k samples. Each one is
              repaired to a spanning tree and validated with an exact AC power flow that reports true losses, minimum
              voltage and maximum line loading. Infeasible configurations never become the recommendation.
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: "#e6edf6" }}>Honest comparison.</strong> {availableSolvers} of {SOLVERS.length} solver
              adapters are available in this deployment. Classical branch-exchange and brute-force baselines run on identical
              inputs and seeds.
            </p>
          </div>
        </Panel>

        <Panel
          title="Test feeders"
          subtitle="Public benchmarks plus custom imports"
          actions={<Link className="btn btn-ghost" href="/networks">Library →</Link>}
          noBody
        >
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Feeder</th>
                  <th className="num">Buses</th>
                  <th className="num">Switches</th>
                  <th className="num">Reference</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {networks.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <Link href={`/networks/${n.id}`} style={{ color: "#dffcef" }}>
                        {n.name}
                      </Link>
                      <div className="helper mono">{n.source}</div>
                    </td>
                    <td className="num">{n.busCount}</td>
                    <td className="num">{n.switchCount}</td>
                    <td className="num">{n.bestKnownLossKw ? `${fmt(n.bestKnownLossKw)} kW` : "—"}</td>
                    <td className="num">
                      <Link className="badge info" href={`/runs/new?network=${n.id}`}>
                        optimize
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-body" style={{ borderTop: "1px solid var(--line-soft)" }}>
            <dl>
              <div className="kv"><dt>Base voltage</dt><dd>{networks[0] ? `${networks[0].baseKv} kV` : "—"}</dd></div>
              <div className="kv"><dt>Base power</dt><dd>{networks[0] ? `${networks[0].baseMva} MVA` : "—"}</dd></div>
              <div className="kv"><dt>Radiality encoding</dt><dd>loop one-hot + lazy check</dd></div>
              <div className="kv"><dt>Validation</dt><dd>backward/forward sweep AC</dd></div>
            </dl>
          </div>
        </Panel>
      </div>

      <div className="grid grid-2">
        <Panel
          title="Recent runs"
          subtitle="Every run stores its seed, parameters and solver version"
          actions={<Link className="btn btn-ghost" href="/runs">History →</Link>}
          noBody
        >
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Network</th>
                  <th>Solver</th>
                  <th className="num">Loss kW</th>
                  <th className="num">Δ</th>
                  <th className="num">ms</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ color: "#8ba0b8" }}>
                      No runs yet. Start with the IEEE 33-bus benchmark.
                    </td>
                  </tr>
                ) : null}
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="mono">#{run.id}</td>
                    <td>{run.networkName}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{run.solver}</td>
                    <td className="num">{run.finalLossKw !== null ? fmt(run.finalLossKw) : "—"}</td>
                    <td className="num" style={{ color: (run.lossReductionPct ?? 0) > 0 ? "#8af3c4" : "#8ba0b8" }}>
                      {run.lossReductionPct !== null ? pct(run.lossReductionPct) : "—"}
                    </td>
                    <td className="num">{run.runtimeMs ?? "—"}</td>
                    <td className="num">
                      <Link className="badge" href={`/runs/${run.id}`}>
                        {run.status}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Benchmark suites"
          subtitle="Solver and baseline comparison on identical inputs"
          actions={<Link className="btn btn-ghost" href="/benchmarks">Benchmarks →</Link>}
          noBody
        >
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Suite</th>
                  <th>Status</th>
                  <th className="num">Entries</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: "#8ba0b8" }}>
                      No benchmark suites yet — the button above runs solvers plus classical baselines.
                    </td>
                  </tr>
                ) : null}
                {benchmarks.map((b) => {
                  const perNetwork = (b.summary as { perNetwork?: { networkName: string; bestSolver: string; bestLossKw: number }[] })
                    ?.perNetwork;
                  return (
                    <tr key={b.id}>
                      <td>
                        <div>{b.name}</div>
                        <div className="helper">
                          {perNetwork?.map((p) => `${p.networkName.replace("IEEE ", "")}: ${p.bestLossKw.toFixed(1)} kW`).join(" · ") ?? "aggregating"}
                        </div>
                      </td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="num">{(b.summary as { entries?: number })?.entries ?? "—"}</td>
                      <td className="helper">{since(b.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid grid-4" style={{ marginTop: 14 }}>
        {[
          { href: "/resilience", title: "Resilience", copy: "Line and switch failures, restoration search, N-1 scans with AC validation." },
          { href: "/scenarios", title: "Scenarios", copy: "Solar/wind variability, weather sets, curtailment and robust comparison." },
          { href: "/benchmarks", title: "Benchmarks", copy: "Solver versus classical baselines on identical inputs and seeds." },
          { href: "/progress", title: "Program status", copy: "154 checklist items mapped to implementation evidence." },
        ].map((card) => (
          <Link key={card.href} href={card.href} className="panel" style={{ display: "block", padding: "14px 16px" }}>
            <div className="panel-title">{card.title} →</div>
            <p className="panel-sub" style={{ marginTop: 6 }}>{card.copy}</p>
          </Link>
        ))}
      </div>

      <div style={{ marginTop: 14 }} className="callout info">
        <strong>Operator note.</strong> Recommendations are advisory and require engineering review. Every published plan has
        passed AC power flow with the configured voltage and loading limits; outputs, seeds and solver versions are stored for
        audit. There is no write path to SCADA or field switches.
      </div>

      <div className="site-foot">
        <span>QA-DNR v0.1 · advisory output only · no SCADA write path</span>
        <span className="mono">{completed.length > 0 ? `last validated run #${completed[0].id}` : "awaiting first run"}</span>
      </div>
    </div>
  );
}
