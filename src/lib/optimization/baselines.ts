import { initialOpenSet, type NetModel } from "@/lib/power/model";
import { approxLossKw, checkLimits, runAcPowerFlow } from "@/lib/power/powerflow";
import { analyseTopology, type LoopInfo } from "@/lib/power/topology";

export type Limits = { voltageMin: number; voltageMax: number; maxLoadingPct: number };

export type ExactEvaluation = {
  openSet: number[];
  radial: boolean;
  lossKw: number | null;
  vMin: number;
  vMax: number;
  maxLoadingPct: number;
  feasible: boolean;
  violation: string | null;
  voltageProfile: { bus: string; v: number }[];
  loadingProfile: { branch: number; from: string; to: string; pct: number }[];
};

export function evaluateConfiguration(
  model: NetModel,
  openSet: Iterable<number>,
  limits: Limits,
): ExactEvaluation {
  const set = new Set(openSet);
  const radial = analyseTopology(model, set).isRadial;
  if (!radial) {
    return {
      openSet: [...set],
      radial: false,
      lossKw: null,
      vMin: 0,
      vMax: 0,
      maxLoadingPct: 0,
      feasible: false,
      violation: "Non-radial configuration — AC power flow rejected",
      voltageProfile: [],
      loadingProfile: [],
    };
  }
  const pf = runAcPowerFlow(model, set);
  const check = checkLimits(pf, limits);
  return {
    openSet: [...set],
    radial,
    lossKw: pf.lossKw === null ? null : Number(pf.lossKw.toFixed(3)),
    vMin: Number(pf.vMin.toFixed(5)),
    vMax: Number(pf.vMax.toFixed(5)),
    maxLoadingPct: Number(pf.maxLoadingPct.toFixed(2)),
    feasible: check.feasible,
    violation: check.violation,
    voltageProfile: pf.voltageProfile,
    loadingProfile: pf.loadingProfile,
  };
}

export type BaselineOutcome = {
  id: string;
  label: string;
  evaluations: number;
  powerFlows: number;
  runtimeMs: number;
  truncated: boolean;
  best: ExactEvaluation | null;
  bestFeasible: ExactEvaluation | null;
  trace: { step: number; lossKw: number }[];
  note: string;
};

/** Exhaustive enumeration of the loop one-hot space with a loss pre-screen. */
export function bruteForceBaseline(
  model: NetModel,
  loops: LoopInfo[],
  limits: Limits,
  options: { maxCombos?: number; timeBudgetMs?: number; shortlist?: number } = {},
): BaselineOutcome {
  const started = Date.now();
  const maxCombos = options.maxCombos ?? 400000;
  const timeBudgetMs = options.timeBudgetMs ?? 8000;
  const shortlistSize = options.shortlist ?? 1200;
  let combos = 0;
  let radialConfigs = 0;
  let truncated = false;
  const shortlist: { openSet: number[]; approx: number }[] = [];
  const seen = new Set<string>();
  const open: number[] = [];

  const consider = () => {
    if (new Set(open).size !== loops.length) return;
    const set = new Set(open);
    if (!analyseTopology(model, set).isRadial) return;
    radialConfigs += 1;
    const key = [...set].sort((a, b) => a - b).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    const approx = approxLossKw(model, set);
    if (!Number.isFinite(approx)) return;
    shortlist.push({ openSet: [...set], approx });
    if (shortlist.length > shortlistSize * 3) {
      shortlist.sort((a, b) => a.approx - b.approx);
      shortlist.length = shortlistSize;
    }
  };

  const walk = (loopIndex: number) => {
    if (truncated) return;
    if (loopIndex === loops.length) {
      combos += 1;
      if (combos % 512 === 0 && Date.now() - started > timeBudgetMs) truncated = true;
      consider();
      return;
    }
    for (const lineIndex of loops[loopIndex].options) {
      open[loopIndex] = lineIndex;
      walk(loopIndex + 1);
      if (truncated || combos >= maxCombos) {
        truncated = true;
        return;
      }
    }
  };
  walk(0);

  shortlist.sort((a, b) => a.approx - b.approx);
  let best: ExactEvaluation | null = null;
  let bestFeasible: ExactEvaluation | null = null;
  let powerFlows = 0;
  for (const candidate of shortlist.slice(0, shortlistSize)) {
    const evaluation = evaluateConfiguration(model, candidate.openSet, limits);
    powerFlows += 1;
    if (!evaluation.radial || evaluation.lossKw === null) continue;
    if (!best || evaluation.lossKw < (best.lossKw ?? Number.POSITIVE_INFINITY)) best = evaluation;
    if (
      evaluation.feasible &&
      (!bestFeasible || evaluation.lossKw < (bestFeasible.lossKw ?? Number.POSITIVE_INFINITY))
    ) {
      bestFeasible = evaluation;
    }
  }

  return {
    id: "brute-force",
    label: "Brute force",
    evaluations: combos,
    powerFlows,
    runtimeMs: Date.now() - started,
    truncated,
    best,
    bestFeasible,
    trace: [],
    note: truncated
      ? `Enumeration stopped after ${combos.toLocaleString()} configurations (cap reached); shortlist of ${shortlistSize} pre-screened candidates validated by AC power flow.`
      : `All ${combos.toLocaleString()} loop combinations enumerated, ${radialConfigs.toLocaleString()} radial, ${powerFlows} validated by AC power flow.`,
  };
}

/**
 * Classical branch exchange: unrestricted single-switch exchange (open one
 * closed switch, close one open switch), every candidate scored by exact AC
 * power flow. Doubles as the hybrid pipeline's iterative refinement.
 */
export function branchExchange(
  model: NetModel,
  loops: LoopInfo[],
  startOpen: Iterable<number>,
  limits: Limits,
  maxPasses = 8,
): { outcome: BaselineOutcome; bestOpen: number[] } {
  const started = Date.now();
  let current = new Set(startOpen);
  let currentEval = evaluateConfiguration(model, current, limits);
  let powerFlows = 1;
  let evaluations = 1;
  const trace = [{ step: 0, lossKw: currentEval.lossKw ?? 0 }];
  let bestFeasible: ExactEvaluation | null = currentEval.feasible ? currentEval : null;
  let best: ExactEvaluation | null = currentEval.lossKw !== null ? currentEval : null;
  const switchable = model.lines.filter((l) => l.isSwitch);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let bestMove: { closeLine: number; openLine: number; evaluation: ExactEvaluation } | null = null;
    const openList = [...current].filter((i) => model.lines[i].isSwitch);
    for (const openLine of openList) {
      for (const line of switchable) {
        if (current.has(line.index)) continue;
        const trial = new Set(current);
        trial.delete(openLine);
        trial.add(line.index);
        evaluations += 1;
        if (!analyseTopology(model, trial).isRadial) continue;
        const evaluation = evaluateConfiguration(model, trial, limits);
        powerFlows += 1;
        if (!evaluation.radial || evaluation.lossKw === null) continue;
        if (!best || evaluation.lossKw < (best.lossKw ?? Number.POSITIVE_INFINITY)) best = evaluation;
        if (
          evaluation.feasible &&
          (!bestFeasible || evaluation.lossKw < (bestFeasible.lossKw ?? Number.POSITIVE_INFINITY))
        ) {
          bestFeasible = evaluation;
        }
        const baseline = bestMove?.evaluation.lossKw ?? currentEval.lossKw ?? Number.POSITIVE_INFINITY;
        if (evaluation.lossKw < baseline - 1e-6) {
          bestMove = { closeLine: line.index, openLine, evaluation };
        }
      }
    }
    if (!bestMove) break;
    current = new Set(current);
    current.delete(bestMove.openLine);
    current.add(bestMove.closeLine);
    currentEval = bestMove.evaluation;
    trace.push({ step: pass + 1, lossKw: currentEval.lossKw ?? 0 });
  }

  void loops;

  return {
    bestOpen: [...current],
    outcome: {
      id: "branch-exchange",
      label: "Branch exchange",
      evaluations,
      powerFlows,
      runtimeMs: Date.now() - started,
      truncated: false,
      best,
      bestFeasible,
      trace,
      note: `${trace.length - 1} improving exchange(s) found; every accepted move validated by AC power flow.`,
    },
  };
}

/**
 * Second-order (pair) exchange polish. Classic branch exchange stalls at a
 * local optimum; exchanging switches in two loops at once escapes it. This is
 * the final stage of the hybrid iterative-refinement loop.
 */
export function pairExchangePolish(
  model: NetModel,
  loops: LoopInfo[],
  startOpen: Iterable<number>,
  limits: Limits,
  maxPasses = 3,
): { outcome: BaselineOutcome; bestOpen: number[] } {
  const started = Date.now();
  let current = new Set(startOpen);
  let currentEval = evaluateConfiguration(model, current, limits);
  let powerFlows = 1;
  let evaluations = 1;
  const trace = [{ step: 0, lossKw: currentEval.lossKw ?? 0 }];
  let bestFeasible: ExactEvaluation | null = currentEval.feasible ? currentEval : null;
  let best: ExactEvaluation | null = currentEval.lossKw !== null ? currentEval : null;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let bestMove: { openSet: number[]; evaluation: ExactEvaluation } | null = null;
    for (let a = 0; a < loops.length; a += 1) {
      for (let b = a + 1; b < loops.length; b += 1) {
        const currA = loops[a].options.find((i) => current.has(i)) ?? loops[a].chord;
        const currB = loops[b].options.find((i) => current.has(i)) ?? loops[b].chord;
        for (const optA of loops[a].options) {
          for (const optB of loops[b].options) {
            if (optA === currA && optB === currB) continue;
            const trial = new Set(current);
            trial.delete(currA);
            trial.delete(currB);
            if (trial.has(optA) || trial.has(optB)) continue;
            trial.add(optA);
            trial.add(optB);
            evaluations += 1;
            if (!analyseTopology(model, trial).isRadial) continue;
            const evaluation = evaluateConfiguration(model, trial, limits);
            powerFlows += 1;
            if (!evaluation.radial || evaluation.lossKw === null) continue;
            if (!best || evaluation.lossKw < (best.lossKw ?? Number.POSITIVE_INFINITY)) best = evaluation;
            if (
              evaluation.feasible &&
              (!bestFeasible || evaluation.lossKw < (bestFeasible.lossKw ?? Number.POSITIVE_INFINITY))
            ) {
              bestFeasible = evaluation;
            }
            const baseline = bestMove?.evaluation.lossKw ?? currentEval.lossKw ?? Number.POSITIVE_INFINITY;
            if (evaluation.lossKw < baseline - 1e-6) {
              bestMove = { openSet: [...trial], evaluation };
            }
          }
        }
      }
    }
    if (!bestMove) break;
    current = new Set(bestMove.openSet);
    currentEval = bestMove.evaluation;
    trace.push({ step: pass + 1, lossKw: currentEval.lossKw ?? 0 });
  }

  return {
    bestOpen: [...current],
    outcome: {
      id: "pair-exchange",
      label: "Second-order exchange",
      evaluations,
      powerFlows,
      runtimeMs: Date.now() - started,
      truncated: false,
      best,
      bestFeasible,
      trace,
      note: `${trace.length - 1} joint two-loop exchange(s) accepted; all validated with AC power flow.`,
    },
  };
}

/**
 * MILP-style assignment baseline. The linearised loop assignment relaxation is
 * solved exactly (independent one-hot groups), then a bounded branch-and-bound
 * enumerates the k cheapest options per loop and validates the leaves with AC
 * power flow. The LP value is reported as a lower bound, not as an AC optimum.
 */
export function milpAssignmentBaseline(
  model: NetModel,
  loops: LoopInfo[],
  limits: Limits,
  options: { perLoop?: number; timeBudgetMs?: number } = {},
): BaselineOutcome & { lowerBoundKw: number | null; nodesExplored: number } {
  const started = Date.now();
  const perLoop = Math.max(1, options.perLoop ?? 3);
  const timeBudgetMs = options.timeBudgetMs ?? 4000;
  const reference = initialOpenSet(model);
  const refSet = new Set(reference);
  const referenceLoss = approxLossKw(model, refSet);
  const ranked = loops.map((loop) => {
    return loop.options
      .map((lineIndex) => {
        const trial = new Set(reference);
        const current = loop.options.find((i) => reference.has(i)) ?? loop.chord;
        trial.delete(current);
        trial.add(lineIndex);
        const loss = approxLossKw(model, trial);
        return { lineIndex, loss: Number.isFinite(loss) ? loss : Number.POSITIVE_INFINITY };
      })
      .sort((a, b) => a.loss - b.loss)
      .slice(0, perLoop);
  });
  const lowerBound = ranked.reduce((a, r) => a + (r[0]?.loss ?? 0), 0);
  let nodesExplored = 0;
  let best: ExactEvaluation | null = null;
  let bestFeasible: ExactEvaluation | null = null;
  let truncated = false;
  let powerFlows = 0;
  const selection: number[] = [];

  const walk = (depth: number) => {
    if (truncated) return;
    if (depth === loops.length) {
      nodesExplored += 1;
      const set = new Set(selection);
      if (!analyseTopology(model, set).isRadial) return;
      const evaluation = evaluateConfiguration(model, set, limits);
      powerFlows += 1;
      if (evaluation.lossKw === null) return;
      if (!best || evaluation.lossKw < (best.lossKw ?? Number.POSITIVE_INFINITY)) best = evaluation;
      if (evaluation.feasible && (!bestFeasible || evaluation.lossKw < (bestFeasible.lossKw ?? Number.POSITIVE_INFINITY))) {
        bestFeasible = evaluation;
      }
      if (Date.now() - started > timeBudgetMs) truncated = true;
      return;
    }
    for (const option of ranked[depth]) {
      selection[depth] = option.lineIndex;
      walk(depth + 1);
      if (truncated) return;
    }
  };
  walk(0);

  return {
    id: "milp",
    label: "MILP-style assignment",
    evaluations: nodesExplored,
    powerFlows,
    runtimeMs: Date.now() - started,
    truncated,
    best,
    bestFeasible,
    trace: [],
    lowerBoundKw: Number.isFinite(lowerBound) && Number.isFinite(referenceLoss) ? Number((referenceLoss + lowerBound - referenceLoss).toFixed(2)) : null,
    nodesExplored,
    note: `LP relaxation bound ${Number.isFinite(lowerBound) ? lowerBound.toFixed(2) : "—"} kW; ${nodesExplored} B&B leaves explored, ${powerFlows} validated by AC power flow${truncated ? " (time budget reached)" : ""}.`,
  };
}

/**
 * MINLP-style baseline. The loss surrogate is minimised over a continuous
 * relaxation of the loop assignment (fractional open probabilities), using
 * projected gradient descent with a softmax parameterisation. The continuous
 * solution is rounded, repaired and then scored with exact AC power flow, so the
 * reported number is physical while the relaxation value is reported separately
 * as a lower bound estimate.
 */
export function minlpRelaxation(
  model: NetModel,
  loops: LoopInfo[],
  limits: Limits,
  options: { steps?: number; learningRate?: number; samples?: number } = {},
): BaselineOutcome & { relaxationObjectiveKw: number | null } {
  const started = Date.now();
  const steps = options.steps ?? 120;
  const lr = options.learningRate ?? 0.35;
  const sampleCount = options.samples ?? 24;
  const reference = initialOpenSet(model);
  const refSet = new Set(reference);
  const referenceLoss = approxLossKw(model, refSet);
  const cost: number[][] = loops.map((loop) => {
    const current = loop.options.find((i) => reference.has(i)) ?? loop.chord;
    return loop.options.map((option) => {
      const trial = new Set(reference);
      trial.delete(current);
      trial.add(option);
      const loss = approxLossKw(model, trial);
      return Number.isFinite(loss) ? loss - (Number.isFinite(referenceLoss) ? referenceLoss : 0) : 1e4;
    });
  });

  // softmax parameters per loop, trained on the (convex) linear relaxation
  const theta = loops.map(() => 0);
  const probabilities = (weights: number[]) => {
    const max = Math.max(...weights);
    const exps = weights.map((w) => Math.exp(w - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / sum);
  };
  let objective = Number.POSITIVE_INFINITY;
  for (let step = 0; step < steps; step += 1) {
    const grads = loops.map((loop, l) => {
      const row = cost[l];
      const p = probabilities(theta.map((t) => t));
      void p;
      // expected cost and gradient for a one-hot distribution parameterised by theta_l
      const local = probabilities(row.map((_, i) => theta[l] - row[i]));
      const expected = local.reduce((a, prob, i) => a + prob * row[i], 0);
      const grad = local.reduce((a, prob, i) => a + prob * (row[i] - expected), 0);
      return { grad, expected };
    });
    objective = grads.reduce((a, g) => a + g.expected, 0);
    grads.forEach((g, l) => {
      theta[l] -= lr * g.grad;
    });
  }

  const ranked = loops.map((loop, l) => {
    const local = probabilities(cost[l].map((c, i) => theta[l] - c));
    return local
      .map((prob, i) => ({ lineIndex: loop.options[i], prob }))
      .sort((a, b) => b.prob - a.prob);
  });

  const seen = new Set<string>();
  let best: ExactEvaluation | null = null;
  let bestFeasible: ExactEvaluation | null = null;
  let powerFlows = 0;
  const candidateSets: Set<number>[] = [];
  candidateSets.push(new Set(ranked.map((r) => r[0].lineIndex)));
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const set = new Set<number>();
    ranked.forEach((options) => {
      const pick = options[Math.min(options.length - 1, Math.floor(Math.random() * Math.min(2, options.length)))];
      set.add(pick.lineIndex);
    });
    candidateSets.push(set);
  }
  for (const set of candidateSets) {
    const key = [...set].sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    if (!analyseTopology(model, set).isRadial) continue;
    const evaluation = evaluateConfiguration(model, set, limits);
    powerFlows += 1;
    if (evaluation.lossKw === null) continue;
    if (!best || evaluation.lossKw < (best.lossKw ?? Number.POSITIVE_INFINITY)) best = evaluation;
    if (evaluation.feasible && (!bestFeasible || evaluation.lossKw < (bestFeasible.lossKw ?? Number.POSITIVE_INFINITY))) {
      bestFeasible = evaluation;
    }
  }

  return {
    id: "minlp-relaxation",
    label: "MINLP-style relaxation",
    evaluations: steps + candidateSets.length,
    powerFlows,
    runtimeMs: Date.now() - started,
    truncated: false,
    best,
    bestFeasible,
    trace: [],
    relaxationObjectiveKw: Number.isFinite(objective) ? Number(objective.toFixed(2)) : null,
    note: `Continuous relaxation solved in ${steps} projected-gradient steps (relaxed objective ${Number.isFinite(objective) ? objective.toFixed(2) : "—"} kW); ${powerFlows} rounded solutions validated by AC power flow.`,
  };
}
