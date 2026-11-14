/** Performance harness: runtime, memory and solver overhead by network size. */
import { IEEE33 } from "../src/lib/networks/ieee33";
import { IEEE69 } from "../src/lib/networks/ieee69";
import { synthetic119 } from "../src/lib/networks/synthetic";
import type { NetworkDraft, SolverId } from "../src/lib/networks/types";
import { DEFAULT_RUN_PARAMS } from "../src/lib/networks/types";
import { buildModel, initialOpenSet, type NetworkRows } from "../src/lib/power/model";
import { findLoops } from "../src/lib/power/topology";
import { runAcPowerFlow } from "../src/lib/power/powerflow";
import { buildQubo } from "../src/lib/optimization/qubo";
import { runPipeline } from "../src/lib/optimization/pipeline";
import { writeFileSync } from "node:fs";

const rowsOf = (draft: NetworkDraft): NetworkRows => ({
  name: draft.name,
  source: draft.source,
  baseMva: draft.baseMva,
  baseKv: draft.baseKv,
  bestKnownLossKw: draft.bestKnownLossKw ?? null,
  buses: draft.buses.map((b) => ({ name: b.name, kind: b.kind ?? "pq", loadPkw: b.loadPkw, loadQkvar: b.loadQkvar })),
  lines: draft.lines.map((l) => ({
    branch: l.branch, fromBus: l.from, toBus: l.to, rOhm: l.rOhm, xOhm: l.xOhm, ratingA: l.ratingA,
    isSwitch: l.switchType !== "fixed", switchType: l.switchType, initialOpen: l.initialOpen ?? false,
  })),
  ders: draft.ders.map((d) => ({ bus: d.bus, pKw: d.pKw, kind: d.kind })),
});

async function main() {
  const rows: { label: string; rows: NetworkRows }[] = [
    { label: "IEEE 33-bus", rows: rowsOf(IEEE33) },
    { label: "IEEE 69-bus", rows: rowsOf(IEEE69) },
    { label: "Synthetic 119-bus", rows: rowsOf(synthetic119()) },
  ];
  const out: Record<string, unknown>[] = [];
  for (const entry of rows) {
    const model = buildModel(entry.rows, 0);
    const loops = findLoops(model).loops;
    const open = initialOpenSet(model);
    const pfStart = performance.now();
    for (let i = 0; i < 20; i += 1) runAcPowerFlow(model, open);
    const pfMs = (performance.now() - pfStart) / 20;
    const quboStart = performance.now();
    const qubo = buildQubo(model, loops, null);
    const quboMs = performance.now() - quboStart;
    const solverRows: Record<string, unknown>[] = [];
    for (const solver of ["simulated-annealing", "quantum-inspired", "genetic-algorithm", "qaoa-simulator"] as SolverId[]) {
      const memBefore = process.memoryUsage().heapUsed;
      const started = Date.now();
      try {
        const result = await runPipeline({
          rows: entry.rows,
          solver,
          params: { ...DEFAULT_RUN_PARAMS, iterations: 4000, restarts: 2, timeoutMs: 30000 },
          seed: 42,
        });
        solverRows.push({
          solver,
          runtimeMs: result.runtimeMs,
          wallMs: Date.now() - started,
          finalLossKw: Number(result.recommendedLoss.toFixed(2)),
          reductionPct: Number(result.lossReductionPct.toFixed(2)),
          feasible: result.recommended.isFeasible,
          heapDeltaMb: Number(((process.memoryUsage().heapUsed - memBefore) / 1048576).toFixed(1)),
        });
      } catch (error) {
        solverRows.push({ solver, error: error instanceof Error ? error.message : String(error) });
      }
    }
    out.push({
      network: entry.label,
      buses: model.buses.length,
      branches: model.lines.length,
      switches: model.lines.filter((l) => l.isSwitch).length,
      loops: loops.length,
      quboVariables: qubo.stats.variables,
      quboQuadraticTerms: qubo.stats.quadraticTerms,
      quboBuildMs: Number(quboMs.toFixed(1)),
      powerFlowMs: Number(pfMs.toFixed(2)),
      solverRuns: solverRows,
    });
    console.log(entry.label, "done");
  }
  const memory = process.memoryUsage();
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    rssMb: Number((memory.rss / 1048576).toFixed(1)),
    heapUsedMb: Number((memory.heapUsed / 1048576).toFixed(1)),
    results: out,
  };
  writeFileSync("/tmp/qa-dnr-bench.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

void main();
