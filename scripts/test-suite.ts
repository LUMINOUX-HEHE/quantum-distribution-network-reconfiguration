/**
 * QA-DNR regression harness. Pure-core tests: no database or HTTP server needed.
 * Run: npx tsx scripts/test-suite.ts
 */
import assert from "node:assert/strict";
import { IEEE33 } from "../src/lib/networks/ieee33";
import { IEEE69 } from "../src/lib/networks/ieee69";
import { synthetic119 } from "../src/lib/networks/synthetic";
import type { NetworkDraft } from "../src/lib/networks/types";
import { DEFAULT_RUN_PARAMS } from "../src/lib/networks/types";
import { validateNetworkDraft } from "../src/lib/networks/validate";
import { buildModel, initialOpenSet, type NetworkRows } from "../src/lib/power/model";
import { analyseTopology, findLoops, repairConfiguration } from "../src/lib/power/topology";
import { approxCurrentPerBranch, checkLimits, runAcPowerFlow } from "../src/lib/power/powerflow";
import { branchExchange, bruteForceBaseline, evaluateConfiguration, milpAssignmentBaseline } from "../src/lib/optimization/baselines";
import { buildQubo, quboEnergy } from "../src/lib/optimization/qubo";
import { runSolver } from "../src/lib/optimization/solvers";
import { runPipeline } from "../src/lib/optimization/pipeline";
import { analyseContingency, n1Scan } from "../src/lib/power/faults";
import { evaluateScenario, loadFactor, solarFactor, windFactor } from "../src/lib/power/profiles";

const rowsOf = (draft: NetworkDraft): NetworkRows => ({
  name: draft.name,
  source: draft.source,
  baseMva: draft.baseMva,
  baseKv: draft.baseKv,
  bestKnownLossKw: draft.bestKnownLossKw ?? null,
  buses: draft.buses.map((b) => ({ name: b.name, kind: b.kind ?? "pq", loadPkw: b.loadPkw, loadQkvar: b.loadQkvar })),
  lines: draft.lines.map((l) => ({
    branch: l.branch,
    fromBus: l.from,
    toBus: l.to,
    rOhm: l.rOhm,
    xOhm: l.xOhm,
    ratingA: l.ratingA,
    isSwitch: l.switchType !== "fixed",
    switchType: l.switchType,
    initialOpen: l.initialOpen ?? false,
  })),
  ders: draft.ders.map((d) => ({ bus: d.bus, pKw: d.pKw, kind: d.kind })),
});

const limits = { voltageMin: 0.9, voltageMax: 1.05, maxLoadingPct: 100 };
let passed = 0;
const failures: string[] = [];
const results: { name: string; detail: string }[] = [];

async function test(name: string, fn: () => Promise<string> | string) {
  try {
    const detail = await fn();
    passed += 1;
    results.push({ name, detail });
    console.log(`PASS ${name} — ${detail}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const rows33 = rowsOf(IEEE33);
  const rows69 = rowsOf(IEEE69);
  const rows119 = rowsOf(synthetic119());
  const model33 = buildModel(rows33, 0);
  const model69 = buildModel(rows69, 0);
  const model119 = buildModel(rows119, 0);

  await test("AC power flow reproduces IEEE 33-bus reference", () => {
    const pf = runAcPowerFlow(model33, initialOpenSet(model33));
    assert.ok(pf.converged, "power flow must converge");
    assert.ok(Math.abs((pf.lossKw ?? 0) - 202.677) < 0.15, `loss ${pf.lossKw}`);
    assert.ok(Math.abs(pf.vMin - 0.9131) < 0.001, `vmin ${pf.vMin}`);
    return `${(pf.lossKw ?? 0).toFixed(3)} kW, Vmin ${pf.vMin.toFixed(4)} pu`;
  });

  await test("AC power flow reproduces IEEE 69-bus reference", () => {
    const pf = runAcPowerFlow(model69, initialOpenSet(model69));
    assert.ok(Math.abs((pf.lossKw ?? 0) - 224.992) < 0.2, `loss ${pf.lossKw}`);
    assert.ok(Math.abs(pf.vMin - 0.9092) < 0.001, `vmin ${pf.vMin}`);
    return `${(pf.lossKw ?? 0).toFixed(3)} kW, Vmin ${pf.vMin.toFixed(4)} pu`;
  });

  await test("Loop discovery finds five independent loops on both benchmarks", () => {
    assert.equal(findLoops(model33).loops.length, 5);
    assert.equal(findLoops(model69).loops.length, 5);
    return "5 loops each; one-hot groups sized by switchable branches";
  });

  await test("Topology validation rejects non-radial configurations", () => {
    const open = initialOpenSet(model33);
    const extra = [...open][0];
    const closed = new Set(open);
    closed.delete(extra);
    assert.equal(analyseTopology(model33, closed).isRadial, false);
    assert.equal(analyseTopology(model33, open).isRadial, true);
    return "tie closure without an opening is rejected";
  });

  await test("Repair restores a spanning tree from an invalid candidate", () => {
    const loops = findLoops(model33).loops;
    const broken = [...initialOpenSet(model33)].filter((_, i) => i !== 0).concat([0]);
    const repaired = repairConfiguration(model33, broken, loops, (set) => approxCurrentPerBranch(model33, set));
    assert.equal(repaired.radial, true);
    return `${repaired.actions.length} repair action(s)`;
  });

  await test("Import validator rejects disconnected networks", () => {
    const bad = validateNetworkDraft({
      name: "Broken",
      baseMva: 10,
      baseKv: 12.66,
      buses: [{ name: "1", kind: "slack" }, { name: "2", loadPkw: 100 }, { name: "3", loadPkw: 100 }],
      lines: [
        { branch: 1, from: "1", to: "2", rOhm: 0.1, xOhm: 0.1, ratingA: 300, switchType: "sectionalizing" },
        { branch: 2, from: "2", to: "3", rOhm: 0.1, xOhm: 0.1, ratingA: 300, switchType: "tie", initialOpen: true },
      ],
    });
    assert.equal(bad.draft, null);
    assert.ok(bad.errors.some((e) => e.includes("open branch")));
    return `${bad.errors.length} validation error(s) reported`;
  });

  await test("QUBO construction is complete and one-hot penalised", () => {
    const loops = findLoops(model33).loops;
    const qubo = buildQubo(model33, loops, null);
    assert.equal(qubo.stats.variables, loops.reduce((a, l) => a + l.options.length, 0));
    assert.ok(qubo.penalty > 0);
    const selection = loops.map((l) => l.options[0]);
    assert.ok(Number.isFinite(quboEnergy(qubo, selection)));
    return `${qubo.stats.variables} variables, ${qubo.stats.quadraticTerms} quadratic terms, λ=${qubo.penalty.toFixed(1)}`;
  });

  await test("Simulated annealing, genetic algorithm and quantum-inspired solvers return decodable samples", () => {
    const loops = findLoops(model33).loops;
    const qubo = buildQubo(model33, loops, null);
    for (const solver of ["simulated-annealing", "genetic-algorithm", "quantum-inspired"] as const) {
      const outcome = runSolver(solver, qubo, { iterations: 1200, restarts: 2, topK: 5, seed: 7 });
      assert.ok(outcome.samples.length > 0, `${solver} returned no samples`);
      for (const sample of outcome.samples) assert.equal(sample.selection.length, loops.length);
    }
    return "three solvers produce one selection per loop";
  });

  await test("QAOA simulator respects its qubit budget and decodes answers", () => {
    const loops = findLoops(model33).loops;
    const qubo = buildQubo(model33, loops, null);
    const outcome = runSolver("qaoa-simulator", qubo, { iterations: 2000, restarts: 1, topK: 5, seed: 3 });
    assert.ok(outcome.samples.length > 0);
    assert.ok(Number(outcome.meta.qubits) <= 10);
    return `${String(outcome.meta.qubits)} qubits, ${String(outcome.meta.evaluations)} parameter evaluations`;
  });

  await test("Hybrid pipeline reproduces the IEEE 33-bus optimum", async () => {
    const result = await runPipeline({ rows: rows33, solver: "simulated-annealing", params: { ...DEFAULT_RUN_PARAMS, iterations: 4000, restarts: 2 }, seed: 42 });
    assert.ok(result.recommended.isFeasible, "recommendation must be feasible");
    assert.ok(result.recommendedLoss < 145, `loss ${result.recommendedLoss.toFixed(2)}`);
    assert.ok(result.lossReductionPct > 25, `reduction ${result.lossReductionPct}`);
    return `${result.initial.lossKw?.toFixed(2)} → ${result.recommendedLoss.toFixed(2)} kW (${result.lossReductionPct.toFixed(1)}%), gap ${result.gapToBestKnownPct?.toFixed(2)}%`;
  });

  await test("Optimisation is reproducible for a fixed seed", async () => {
    const params = { ...DEFAULT_RUN_PARAMS, iterations: 1500, restarts: 2 };
    const a = await runPipeline({ rows: rows33, solver: "simulated-annealing", params, seed: 99 });
    const b = await runPipeline({ rows: rows33, solver: "simulated-annealing", params, seed: 99 });
    assert.deepEqual(a.recommended.openSet, b.recommended.openSet);
    return `identical open set ${a.recommended.openSet.map((i) => model33.lines[i].branch).join(",")}`;
  });

  await test("Voltage/loading band is enforced when limits tighten", () => {
    const strict = { ...limits, voltageMin: 0.99 };
    const evaluation = evaluateConfiguration(model33, initialOpenSet(model33), strict);
    assert.equal(evaluation.feasible, false);
    assert.ok(evaluation.violation?.includes("Vmin"));
    return "strict 0.99 pu band rejects the initial configuration";
  });

  await test("MILP assignment baseline and branch exchange agree on feasibility", () => {
    const loops = findLoops(model33).loops;
    const be = branchExchange(model33, loops, initialOpenSet(model33), limits, 6);
    const milp = milpAssignmentBaseline(model33, loops, limits, { perLoop: 3, timeBudgetMs: 2500 });
    assert.ok(be.outcome.bestFeasible?.lossKw);
    assert.ok(milp.bestFeasible?.lossKw);
    assert.ok((milp.bestFeasible?.lossKw ?? 0) >= 130);
    return `branch exchange ${be.outcome.bestFeasible?.lossKw} kW, MILP/B&B ${milp.bestFeasible?.lossKw} kW`;
  });

  await test("Brute force confirms the loop-space optimum on the 33-bus feeder", () => {
    const loops = findLoops(model33).loops;
    const brute = bruteForceBaseline(model33, loops, limits, { maxCombos: 200000, timeBudgetMs: 6000, shortlist: 400 });
    assert.ok((brute.bestFeasible?.lossKw ?? Infinity) < 145);
    return `${brute.evaluations} combinations, best ${brute.bestFeasible?.lossKw} kW`;
  });

  await test("Line failure is isolated and an alternative supply route is validated", () => {
    const result = analyseContingency(model33, { kind: "line", branch: 8 }, limits, ["25", "30"]);
    assert.ok(result.restoration.attempted);
    assert.equal(result.restoration.feasible, true);
    return `section ${result.section}, restored ${result.restoration.restoredPct}% with ${result.restoration.actions.length} action(s)`;
  });

  await test("N-1 contingency scan covers switchable branches", () => {
    const scan = n1Scan(model33, limits, ["24", "25"], 40);
    assert.ok(scan.totals.studied >= 30);
    assert.ok(scan.totals.averageRestoredPct >= 0 && scan.totals.averageRestoredPct <= 100);
    return `${scan.totals.studied} contingencies, avg restored ${scan.totals.averageRestoredPct}%`;
  });

  await test("Renewable profiles respect physical bounds", () => {
    assert.equal(solarFactor(0, 0.1, "summer"), 0);
    assert.ok(solarFactor(12, 0.1, "summer") > 0.5);
    assert.equal(windFactor(1), 0);
    assert.equal(windFactor(20), 1);
    assert.ok(loadFactor(19, "summer") > loadFactor(3, "summer"));
    return "solar night=0, noon high; wind cut-in/cut-out enforced; evening peak";
  });

  await test("Scenario sweep reports losses, curtailment and feasibility", () => {
    const evaluation = evaluateScenario(rows33, initialOpenSet(model33), {
      hour: 12,
      season: "summer",
      cloudCover: 0.3,
      windSpeed: 8,
      loadMultiplier: 1.1,
      variability: 0.1,
      horizonHours: 24,
      weather: "clear",
    }, limits);
    assert.equal(evaluation.steps.length, 24);
    assert.ok(evaluation.feasibleSteps > 0);
    assert.ok(evaluation.totalCurtailmentKwh >= 0);
    return `${evaluation.averageLossKw} kW avg loss, utilisation ${evaluation.derUtilisationPct}%, ${evaluation.feasibleSteps}/24 feasible`;
  });

  await test("Synthetic 119-bus feeder is radial, solvable and bounded by the timeout", async () => {
    assert.equal(findLoops(model119).loops.length, 6);
    assert.equal(analyseTopology(model119, initialOpenSet(model119)).isRadial, true);
    const result = await runPipeline({ rows: rows119, solver: "quantum-inspired", params: { ...DEFAULT_RUN_PARAMS, iterations: 2500, restarts: 2, timeoutMs: 20000 }, seed: 5 });
    assert.ok(result.recommended.isFeasible);
    return `${model119.buses.length} buses, ${result.initial.lossKw?.toFixed(1)} → ${result.recommendedLoss.toFixed(1)} kW in ${result.runtimeMs} ms`;
  });

  await test("IEEE 69-bus pipeline reduces loss beyond 40%", async () => {
    const result = await runPipeline({ rows: rows69, solver: "simulated-annealing", params: { ...DEFAULT_RUN_PARAMS, iterations: 4000, restarts: 2 }, seed: 11 });
    assert.ok(result.lossReductionPct > 40, `reduction ${result.lossReductionPct}`);
    assert.ok(result.recommended.isFeasible);
    return `${result.initial.lossKw?.toFixed(1)} → ${result.recommendedLoss.toFixed(2)} kW (${result.lossReductionPct.toFixed(1)}%)`;
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.error(` - ${f}`);
    process.exitCode = 1;
  }
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/qa-dnr-tests.json", JSON.stringify({ passed, failures, results, at: new Date().toISOString() }, null, 2));
}

void main();
