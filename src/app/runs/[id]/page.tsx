import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel, Stat, StatusBadge, OriginBadge, fmt, pct, Callout, since } from "@/components/ui";
import { NetworkGraph } from "@/components/network-graph";
import { VoltageChart, LoadingBars, LossComparison } from "@/components/charts";
import { ExportButtons, RunMonitor } from "@/components/client";
import { getRunDetail } from "@/lib/server/runs";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel } from "@/lib/power/model";
import type { SwitchingStep } from "@/db/schema";

export const dynamic = "force-dynamic";

type LoopSummary = {
  count?: number;
  requiredOpenCount?: number;
  switchableCount?: number;
  contractedCount?: number;
  loops?: {
    index: number;
    label: string;
    chord: number;
    options: {
      branch: number;
      from: string;
      to: string;
      switchType: string;
      linearKw: number | null;
      initialOpen: boolean;
      recommendedOpen: boolean;
    }[];
  }[];
};

type BaselineSummary = {
  baselines?: {
    id: string;
    label: string;
    evaluations: number;
    powerFlows: number;
    runtimeMs: number;
    truncated: boolean;
    bestLossKw: number | null;
    note: string;
  }[];
  refinement?: {
    passes: number;
    powerFlows: number;
    bestLossKw: number | null;
    note: string;
  } | null;
};

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) notFound();
  const detail = await getRunDetail(runId);
  if (!detail) notFound();
  const { run, candidates, result } = detail;
  const rows = await loadNetworkRows(run.networkId);
  if (!rows) notFound();
  const model = buildModel(rows, Number((run.params as { derPenetrationPct?: number })?.derPenetrationPct ?? 0));
  const initialOpenBranches = model.lines.filter((l) => l.initialOpen).map((l) => l.branch);
  const recommendedCandidate =
    candidates.find((c) => c.id === result?.recommendedCandidateId) ??
    candidates.filter((c) => c.isFeasible).sort((a, b) => (a.lossKw ?? 1e9) - (b.lossKw ?? 1e9))[0] ??
    null;
  const recommendedOpenBranches = (recommendedCandidate?.openSwitches ?? [])
    .map((lineIndex) => model.lines[lineIndex]?.branch)
    .filter((b): b is number => typeof b === "number");
  const changed = [
    ...new Set([
      ...initialOpenBranches.filter((b) => !recommendedOpenBranches.includes(b)),
      ...recommendedOpenBranches.filter((b) => !initialOpenBranches.includes(b)),
    ]),
  ];
  const loopSummary = (result?.loopSummary ?? {}) as LoopSummary;
  const baselineSummary = (result?.baselineSummary ?? {}) as BaselineSummary;
  const qubo = (result?.quboSummary ?? {}) as Record<string, unknown>;
  const solver = (result?.solverSummary ?? {}) as Record<string, unknown>;
  const plan = (result?.switchingPlan ?? []) as SwitchingStep[];
  const completed = run.status === "completed" && result;

  return (
    <div>
      <PageHeader
        eyebrow={`Run #${run.id} · ${rows.name} · seed ${run.seed}`}
        title={`${run.solver.replace(/-/g, " ")} reconfiguration`}
        description={
          completed
            ? `Recommended configuration ${recommendedOpenBranches.length} open switches, validated by AC power flow. ${result?.lossReductionPct.toFixed(2)}% active-loss reduction against the current configuration.`
            : "The optimisation worker is running the hybrid pipeline. Results appear when AC validation completes."
        }
        actions={
          <>
            <StatusBadge status={run.status} />
            {completed ? <ExportButtons runId={run.id} /> : null}
            <Link className="btn" href="/runs">All runs</Link>
            <Link className="btn btn-primary" href={`/runs/new?network=${run.networkId}`}>Re-run</Link>
          </>
        }
      />

      <RunMonitor
        runId={run.id}
        status={run.status}
        stage={run.stage}
        progress={run.progress}
        logs={run.logs ?? []}
      />

      {run.error ? (
        <div style={{ marginTop: 14 }}>
          <Callout>Run failed: {run.error}. Adjust solver parameters or choose an available backend.</Callout>
        </div>
      ) : null}

      {completed && result ? (
        <>
          <div className="grid grid-4" style={{ marginTop: 14 }}>
            <Stat label="Initial loss" value={fmt(result.initialLossKw)} unit="kW" hint={result.initialVmin ? `Vmin ${result.initialVmin.toFixed(4)} pu` : undefined} tone="rose" />
            <Stat label="Recommended loss" value={fmt(result.finalLossKw)} unit="kW" hint={result.finalVmin ? `Vmin ${result.finalVmin.toFixed(4)} pu` : undefined} />
            <Stat
              label="Reduction"
              value={pct(result.lossReductionPct)}
              hint={`${fmt(result.initialLossKw - result.finalLossKw)} kW saved`}
              tone="cyan"
            />
            <Stat
              label="Gap to reference"
              value={result.gapToBestKnownPct !== null ? pct(result.gapToBestKnownPct) : "—"}
              hint={rows.bestKnownLossKw ? `reference ${fmt(rows.bestKnownLossKw)} kW` : "no reference"}
              tone="violet"
            />
          </div>

          <div className="grid grid-4" style={{ marginTop: 14 }}>
            <Stat
              label="Raw sample feasibility"
              value={pct(result.feasibilityRate * 100)}
              hint={`post-repair ${candidates.filter((c) => c.isFeasible).length}/${candidates.length} feasible`}
              tone="amber"
            />
            <Stat label="Peak loading" value={fmt(result.finalMaxLoadingPct, 1)} unit="%" hint="after reconfiguration" />
            <Stat label="Runtime" value={result.runtimeMs} unit="ms" hint="cold start, single worker" tone="cyan" />
            <Stat label="Switch operations" value={plan.length} hint={`${recommendedOpenBranches.length} open in plan`} tone="violet" />
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <Panel
              title="Current configuration"
              subtitle={`${fmt(result.initialLossKw)} kW · Vmin ${result.initialVmin?.toFixed(4)} pu`}
              actions={<span className="badge warn">{initialOpenBranches.length} open</span>}
            >
              <NetworkGraph
                buses={model.buses.map((b) => ({ name: b.name, loadPkw: b.loadPkw, isSlack: b.isSlack }))}
                lines={model.lines.map((l) => ({ branch: l.branch, from: l.from, to: l.to, switchType: l.switchType, isSwitch: l.isSwitch }))}
                openBranches={initialOpenBranches}
                width={800}
                height={430}
              />
            </Panel>
            <Panel
              title="Recommended configuration"
              subtitle={`${fmt(result.finalLossKw)} kW · Vmin ${result.finalVmin?.toFixed(4)} pu${recommendedCandidate ? ` · ${recommendedCandidate.origin}` : ""}`}
              actions={<span className="badge ok">{recommendedOpenBranches.length} open</span>}
            >
              <NetworkGraph
                buses={model.buses.map((b) => ({ name: b.name, loadPkw: b.loadPkw, isSlack: b.isSlack }))}
                lines={model.lines.map((l) => ({ branch: l.branch, from: l.from, to: l.to, switchType: l.switchType, isSwitch: l.isSwitch }))}
                openBranches={recommendedOpenBranches}
                changedBranches={changed}
                width={800}
                height={430}
              />
            </Panel>
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <Panel title="Voltage profile" subtitle="Recommended (solid) vs current (dashed)">
              <VoltageChart
                profile={result.finalVoltageProfile ?? []}
                compare={result.initialVoltageProfile ?? []}
                vmin={Number((run.params as { voltageMin?: number })?.voltageMin ?? 0.9)}
              />
            </Panel>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Panel title="Loss comparison">
                <LossComparison initial={result.initialLossKw} final={result.finalLossKw} />
              </Panel>
              <Panel title="Peak line loading" subtitle={`Limit ${(run.params as { maxLoadingPct?: number })?.maxLoadingPct ?? 100}% of ampacity`}>
                <LoadingBars
                  profile={result.finalLoadingProfile ?? []}
                  limit={Number((run.params as { maxLoadingPct?: number })?.maxLoadingPct ?? 100)}
                />
              </Panel>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <Panel title="Switching plan" subtitle="Ordered operations from the current state to the recommendation" actions={<span className="badge info">advisory</span>}>
              {plan.length === 0 ? (
                <div className="helper">No switching operations required — the current configuration is already the best feasible option.</div>
              ) : (
                plan.map((step) => (
                  <div key={`${step.step}-${step.branch}`} className="plan-step">
                    <span className="plan-num">{step.step}</span>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span className={`chip ${step.action === "open" ? "open" : "close"}`}>{step.action}</span>
                        <span className="mono" style={{ fontSize: 12 }}>
                          branch {step.branch} · {step.fromBus}–{step.toBus}
                        </span>
                        <span className="badge">{step.switchType}</span>
                      </div>
                      <div className="helper" style={{ marginTop: 3 }}>{step.reason}</div>
                    </div>
                  </div>
                ))
              )}
            </Panel>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Panel title="Formulation & solver" subtitle="Reproducibility record">
                <dl>
                  <div className="kv"><dt>Solver</dt><dd>{String(solver.label ?? run.solver)}</dd></div>
                  <div className="kv"><dt>Seed</dt><dd>{run.seed}</dd></div>
                  <div className="kv"><dt>Solver version</dt><dd>{run.solverVersion}</dd></div>
                  <div className="kv"><dt>QUBO variables</dt><dd>{String(qubo.variables ?? "—")}</dd></div>
                  <div className="kv"><dt>Quadratic terms</dt><dd>{String(qubo.quadraticTerms ?? "—")}</dd></div>
                  <div className="kv"><dt>One-hot penalty</dt><dd>{typeof qubo.penaltyWeight === "number" ? qubo.penaltyWeight.toFixed(1) : "—"} {qubo.autoTuned ? "(auto)" : "(manual)"}</dd></div>
                  <div className="kv"><dt>Approximation</dt><dd style={{ maxWidth: 260 }}>{String(qubo.approximation ?? "—")}</dd></div>
                  <div className="kv"><dt>Energy evaluations</dt><dd>{typeof solver.iterations === "number" ? solver.iterations.toLocaleString() : "—"}</dd></div>
                  <div className="kv"><dt>Distinct samples</dt><dd>{String(solver.samples ?? "—")}</dd></div>
                  <div className="kv"><dt>DER penetration</dt><dd>{String((run.params as { derPenetrationPct?: number })?.derPenetrationPct ?? 0)}%</dd></div>
                  <div className="kv"><dt>Finished</dt><dd>{since(run.finishedAt)}</dd></div>
                </dl>
                {solver.note ? <div className="helper" style={{ marginTop: 8 }}>{String(solver.note)}</div> : null}
              </Panel>

              <Panel title="Baseline comparison" subtitle="Same inputs, same validation">
                <div className="scroll-x">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th className="num">Best kW</th>
                        <th className="num">Power flows</th>
                        <th className="num">ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Hybrid recommendation</td>
                        <td className="num">{fmt(result.finalLossKw)}</td>
                        <td className="num">{candidates.filter((c) => c.isFeasible).length} validations</td>
                        <td className="num">{result.runtimeMs}</td>
                      </tr>
                      {(baselineSummary.baselines ?? []).map((b) => (
                        <tr key={b.id}>
                          <td>
                            {b.label}
                            {b.truncated ? <span className="badge warn" style={{ marginLeft: 6 }}>truncated</span> : null}
                          </td>
                          <td className="num">{fmt(b.bestLossKw)}</td>
                          <td className="num">{b.powerFlows}</td>
                          <td className="num">{b.runtimeMs}</td>
                        </tr>
                      ))}
                      {baselineSummary.refinement ? (
                        <tr>
                          <td>Iterative refinement</td>
                          <td className="num">{fmt(baselineSummary.refinement.bestLossKw)}</td>
                          <td className="num">{baselineSummary.refinement.powerFlows}</td>
                          <td className="num">—</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {baselineSummary.baselines?.map((b) => (
                  <div key={`note-${b.id}`} className="helper" style={{ marginTop: 8 }}>{b.label}: {b.note}</div>
                ))}
              </Panel>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <Panel
              title="Top-k candidates"
              subtitle="Ranked by reference energy; true losses from AC power flow"
              noBody
            >
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="num">Rank</th>
                      <th>Origin</th>
                      <th>Open switches (branch:bus–bus)</th>
                      <th className="num">QUBO energy</th>
                      <th className="num">Surrogate kW</th>
                      <th>Radial</th>
                      <th>Repaired</th>
                      <th>Feasible</th>
                      <th className="num">Loss kW</th>
                      <th className="num">Vmin</th>
                      <th className="num">Load %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr key={c.id} style={c.id === result.recommendedCandidateId ? { background: "rgba(61,220,151,0.07)" } : undefined}>
                        <td className="num">{c.rank}</td>
                        <td><OriginBadge origin={c.origin} /></td>
                        <td className="mono" style={{ fontSize: 10.5, maxWidth: 320 }}>
                          {(c.openSwitches ?? [])
                            .map((lineIndex) => {
                              const line = model.lines[lineIndex];
                              return line ? `${line.branch}:${model.buses[line.from].name}–${model.buses[line.to].name}` : `?${lineIndex}`;
                            })
                            .join("  ")}
                        </td>
                        <td className="num">{fmt(c.quboEnergy, 1)}</td>
                        <td className="num">{fmt(c.approxLossKw, 1)}</td>
                        <td>{c.isRadial ? <span className="badge ok">yes</span> : <span className="badge bad">no</span>}</td>
                        <td>{c.repaired ? <span className="badge warn">repaired</span> : <span className="badge">as sampled</span>}</td>
                        <td>{c.isFeasible ? <span className="badge ok">feasible</span> : <span className="badge bad" title={c.violation ?? ""}>rejected</span>}</td>
                        <td className="num" style={{ color: c.id === result.recommendedCandidateId ? "#8af3c4" : undefined }}>{fmt(c.lossKw)}</td>
                        <td className="num">{c.vMin ? c.vMin.toFixed(4) : "—"}</td>
                        <td className="num">{fmt(c.maxLoadingPct, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div style={{ marginTop: 14 }}>
            <Panel title="Loop encoding" subtitle={`${loopSummary.count ?? 0} fundamental loops · one open switch per loop in the QUBO`} actions={<span className="badge violet">{loopSummary.switchableCount ?? 0} switchable branches</span>}>
              <div className="grid grid-2">
                {(loopSummary.loops ?? []).map((loop) => (
                  <div key={loop.index} className="loop-card">
                    <div className="loop-title">
                      <span>Loop {loop.index + 1} · chord {loop.chord} ({loop.label})</span>
                      <span>{loop.options.length} options</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                      {loop.options.map((option) => (
                        <span
                          key={option.branch}
                          className={`chip ${option.recommendedOpen ? "open" : option.initialOpen ? "close" : ""}`}
                          title={`surrogate Δ ${option.linearKw?.toFixed(2) ?? "—"} kW`}
                        >
                          {option.branch}:{option.from}–{option.to}
                          {option.linearKw !== null ? ` · ${option.linearKw.toFixed(1)} kW` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </>
      ) : null}

      <div className="site-foot">
        <span>Run #{run.id} · {run.status} · created {since(run.createdAt)}</span>
        <span className="mono">seed {run.seed} · {run.solverVersion}</span>
      </div>
    </div>
  );
}
