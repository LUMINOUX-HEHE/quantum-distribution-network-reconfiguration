import { IEEE33 } from "../src/lib/networks/ieee33";
import { IEEE69 } from "../src/lib/networks/ieee69";
import type { NetworkDraft } from "../src/lib/networks/types";
import { buildModel, initialOpenSet } from "../src/lib/power/model";
import { findLoops } from "../src/lib/power/topology";
import { runAcPowerFlow } from "../src/lib/power/powerflow";
import { branchExchange, evaluateConfiguration } from "../src/lib/optimization/baselines";
import { runPipeline } from "../src/lib/optimization/pipeline";
import { DEFAULT_RUN_PARAMS } from "../src/lib/networks/types";

function rowsFromDraft(draft: NetworkDraft) {
  return {
    name: draft.name,
    source: draft.source,
    baseMva: draft.baseMva,
    baseKv: draft.baseKv,
    bestKnownLossKw: draft.bestKnownLossKw ?? null,
    buses: draft.buses.map((b) => ({
      name: b.name,
      kind: b.kind ?? "pq",
      loadPkw: b.loadPkw,
      loadQkvar: b.loadQkvar,
    })),
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
    ders: draft.ders.map((d) => ({ bus: d.bus, pKw: d.pKw })),
  };
}

async function check(draft: NetworkDraft) {
  const rows = rowsFromDraft(draft);
  const model = buildModel(rows, 0);
  const loops = findLoops(model);
  console.log(`\n=== ${draft.name} ===`);
  console.log(
    `buses=${model.buses.length} lines=${model.lines.length} loops=${loops.loops.length} switchable=${loops.switchableCount}`,
  );
  console.log("loop option counts:", loops.loops.map((l) => `${l.label}:${l.options.length}`).join(" "));
  const initOpen = initialOpenSet(model);
  const pf = runAcPowerFlow(model, initOpen);
  console.log(
    `initial: loss=${pf.lossKw?.toFixed(3)} kW vmin=${pf.vMin.toFixed(4)} loading=${pf.maxLoadingPct.toFixed(1)}% iters=${pf.iterations} converged=${pf.converged}`,
  );
  const limits = { voltageMin: 0.9, voltageMax: 1.05, maxLoadingPct: 100 };
  const initEval = evaluateConfiguration(model, initOpen, limits);
  console.log("initial feasible:", initEval.feasible, initEval.violation ?? "");

  const started = Date.now();
  const be = branchExchange(model, loops.loops, initOpen, limits, 10);
  console.log(
    `branch-exchange: loss=${be.outcome.bestFeasible?.lossKw} kW in ${Date.now() - started} ms, opens=${be.outcome.bestFeasible?.openSet
      .map((i) => model.lines[i].branch)
      .join(",")} trace=${be.outcome.trace.length}`,
  );

  const result = await runPipeline({
    rows,
    solver: "simulated-annealing",
    params: { ...DEFAULT_RUN_PARAMS, iterations: 6000, restarts: 3, topK: 12 },
    seed: 42,
  });
  console.log(
    `pipeline SA: initial=${result.initial.lossKw} recommended=${result.recommendedLoss.toFixed(3)} (${result.recommended.origin}) reduction=${result.lossReductionPct.toFixed(1)}% gap=${result.gapToBestKnownPct?.toFixed(2)} runtime=${result.runtimeMs}ms rawRadial=${(result.rawRadialRate * 100).toFixed(0)}%`,
  );
  console.log(
    "switching plan:",
    result.switchingPlan.map((s) => `${s.action} ${s.branch}`).join(", "),
  );
  console.log("solver summary:", JSON.stringify(result.solverSummary));
  if (result.recommended.lossKw && result.recommended.lossKw > (result.initial.lossKw ?? Infinity)) {
    console.log("WARNING: recommended worse than initial");
  }
}

async function main() {
  await check(IEEE33);
  await check(IEEE69);
}

void main();
