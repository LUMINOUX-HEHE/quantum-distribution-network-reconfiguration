import type { RunParams, SolverId } from "@/lib/networks/types";
import { buildModel, initialOpenSet, type NetModel, type NetworkRows } from "@/lib/power/model";
import { approxCurrentPerBranch, approxLossKw } from "@/lib/power/powerflow";
import { analyseTopology, findLoops, repairConfiguration, switchStatesFromOpen } from "@/lib/power/topology";
import {
  branchExchange,
  evaluateConfiguration,
  bruteForceBaseline,
  milpAssignmentBaseline,
  minlpRelaxation,
  pairExchangePolish,
  type BaselineOutcome,
  type ExactEvaluation,
  type Limits,
} from "./baselines";
import { buildQubo, selectionKey, type QuboModel } from "./qubo";
import { runSolver, solverAvailability, type SolverOutcome } from "./solvers";

export type ComputedCandidate = {
  origin: "solver" | "current" | "refinement" | "baseline";
  rank: number;
  openSet: number[];
  switchStates: Record<string, boolean>;
  quboEnergy: number | null;
  approxLossKw: number | null;
  isRadial: boolean;
  repaired: boolean;
  repairActions: string[];
  isFeasible: boolean;
  lossKw: number | null;
  vMin: number;
  vMax: number;
  maxLoadingPct: number;
  violation: string | null;
  voltageProfile: { bus: string; v: number }[];
  loadingProfile: { branch: number; from: string; to: string; pct: number }[];
};

export type SwitchingPlanStep = {
  step: number;
  branch: number;
  action: "open" | "close";
  fromBus: string;
  toBus: string;
  switchType: string;
  reason: string;
};

export type PipelineResult = {
  model: NetModel;
  initial: ExactEvaluation;
  candidates: ComputedCandidate[];
  recommended: ComputedCandidate;
  recommendedLoss: number;
  lossReductionPct: number;
  feasibilityRate: number;
  rawRadialRate: number;
  gapToBestKnownPct: number | null;
  switchingPlan: SwitchingPlanStep[];
  loopSummary: Record<string, unknown>;
  quboSummary: Record<string, unknown>;
  solverSummary: Record<string, unknown>;
  baselineSummary: Record<string, unknown>;
  runtimeMs: number;
  notes: string[];
};

export type ProgressReporter = (update: {
  stage: string;
  progress: number;
  message: string;
  level?: "info" | "warn" | "error";
}) => void | Promise<void>;

const wait = async () => new Promise<void>((resolve) => setImmediate(resolve));

export async function runPipeline(input: {
  rows: NetworkRows;
  solver: SolverId;
  params: RunParams;
  seed: number;
  onProgress?: ProgressReporter;
}): Promise<PipelineResult> {
  const started = Date.now();
  const { rows, solver, params, seed } = input;
  const report = input.onProgress ?? (() => undefined);
  const notes: string[] = [];

  const model = buildModel(rows, params.derPenetrationPct);
  const limits: Limits = {
    voltageMin: params.voltageMin,
    voltageMax: params.voltageMax,
    maxLoadingPct: params.maxLoadingPct,
  };
  const initialOpen = initialOpenSet(model);
  await report({
    stage: "preprocess",
    progress: 10,
    message: `Loaded ${model.buses.length} buses / ${model.lines.length} branches (${model.baseKv} kV, ${model.baseMva} MVA base)`,
  });

  const topology = findLoops(model);
  const loops = topology.loops;
  const initial = evaluateConfiguration(model, initialOpen, limits);
  await report({
    stage: "preprocess",
    progress: 18,
    message: `Found ${loops.length} fundamental loops, ${topology.switchableCount} switchable branches, ${topology.contractedCount} contracted. Initial loss ${initial.lossKw?.toFixed(2) ?? "∞"} kW`,
  });

  const qubo = buildQubo(model, loops, params.penaltyWeight);
  await report({
    stage: "qubo",
    progress: 25,
    message: `QUBO built: ${qubo.stats.variables} variables, ${qubo.stats.quadraticTerms} quadratic terms, penalty ${qubo.stats.penaltyWeight.toFixed(1)} (${qubo.stats.autoTuned ? "auto-tuned" : "manual"})`,
  });

  const deadline = started + params.timeoutMs;
  let solverOutcome: SolverOutcome;
  let fallbackUsed: string | null = null;
  try {
    if (!solverAvailability(solver).available) {
      throw new Error(solverAvailability(solver).reason);
    }
    solverOutcome = runSolver(solver, qubo, {
      iterations: params.iterations,
      restarts: params.restarts,
      topK: params.topK,
      seed,
    });
  } catch (error) {
    // Fallback: the hybrid orchestrator degrades to the local annealer rather
    // than failing the run when a backend is unavailable or throws.
    fallbackUsed = `${solver} → simulated-annealing (${error instanceof Error ? error.message : String(error)})`;
    await report({
      stage: "solve",
      progress: 40,
      level: "warn",
      message: `Falling back to the local annealer: ${fallbackUsed}`,
    });
    solverOutcome = runSolver("simulated-annealing", qubo, {
      iterations: params.iterations,
      restarts: Math.max(2, params.restarts),
      topK: params.topK,
      seed: seed + 1,
    });
  }
  if (Date.now() > deadline) {
    notes.push(`Soft deadline of ${params.timeoutMs} ms exceeded during solving; refinement is bounded.`);
  }
  await report({
    stage: "solve",
    progress: 55,
    message: `${solverOutcome.solverLabel} returned ${solverOutcome.samples.length} top-k candidates in ${solverOutcome.runtimeMs} ms (${solverOutcome.iterations.toLocaleString()} energy evaluations)`,
  });
  await wait();

  const candidates: ComputedCandidate[] = [];
  let rawRadialCount = 0;
  let rawFeasibleCount = 0;

  const makeCandidate = (
    openSet: Iterable<number>,
    origin: ComputedCandidate["origin"],
    quboEnergy: number | null,
    alreadyRadial: boolean,
  ): ComputedCandidate => {
    const raw = [...new Set(openSet)];
    const repair = repairConfiguration(model, raw, loops, (set) => approxCurrentPerBranch(model, set));
    const evaluation = evaluateConfiguration(model, repair.openSet, limits);
    const approx = approxLossKw(model, new Set(repair.openSet));
    return {
      origin,
      rank: 0,
      openSet: [...repair.openSet].sort((a, b) => a - b),
      switchStates: switchStatesFromOpen(model, repair.openSet),
      quboEnergy: quboEnergy === null ? null : Number(quboEnergy.toFixed(2)),
      approxLossKw: Number.isFinite(approx) ? Number(approx.toFixed(2)) : null,
      isRadial: evaluation.radial,
      repaired: !alreadyRadial || repair.repaired,
      repairActions: repair.actions,
      isFeasible: evaluation.feasible,
      lossKw: evaluation.lossKw,
      vMin: evaluation.vMin,
      vMax: evaluation.vMax,
      maxLoadingPct: evaluation.maxLoadingPct,
      violation: evaluation.violation,
      voltageProfile: evaluation.voltageProfile,
      loadingProfile: evaluation.loadingProfile,
    };
  };

  solverOutcome.samples.forEach((sample, i) => {
    const rawSet = new Set(sample.openSet);
    const rawRadial = analyseTopology(model, rawSet).isRadial;
    if (rawRadial) {
      rawRadialCount += 1;
      const rawEval = evaluateConfiguration(model, rawSet, limits);
      if (rawEval.feasible && rawRadial) rawFeasibleCount += 1;
      if (rawEval.feasible) {
        candidates.push({
          origin: "solver",
          rank: i + 1,
          openSet: [...rawSet].sort((a, b) => a - b),
          switchStates: switchStatesFromOpen(model, rawSet),
          quboEnergy: Number(sample.energy.toFixed(2)),
          approxLossKw: Number.isFinite(approxLossKw(model, rawSet))
            ? Number(approxLossKw(model, rawSet).toFixed(2))
            : null,
          isRadial: true,
          repaired: false,
          repairActions: [],
          isFeasible: true,
          lossKw: rawEval.lossKw,
          vMin: rawEval.vMin,
          vMax: rawEval.vMax,
          maxLoadingPct: rawEval.maxLoadingPct,
          violation: null,
          voltageProfile: rawEval.voltageProfile,
          loadingProfile: rawEval.loadingProfile,
        });
        return;
      }
    }
    candidates.push(makeCandidate(sample.openSet, "solver", sample.energy, rawRadial));
  });

  const currentCandidate: ComputedCandidate = {
    origin: "current",
    rank: 0,
    openSet: [...initialOpen].sort((a, b) => a - b),
    switchStates: switchStatesFromOpen(model, initialOpen),
    quboEnergy: null,
    approxLossKw: Number.isFinite(approxLossKw(model, initialOpen))
      ? Number(approxLossKw(model, initialOpen).toFixed(2))
      : null,
    isRadial: initial.radial,
    repaired: false,
    repairActions: [],
    isFeasible: initial.feasible,
    lossKw: initial.lossKw,
    vMin: initial.vMin,
    vMax: initial.vMax,
    maxLoadingPct: initial.maxLoadingPct,
    violation: initial.violation,
    voltageProfile: initial.voltageProfile,
    loadingProfile: initial.loadingProfile,
  };
  candidates.push(currentCandidate);

  const switchingOps = (openSet: number[]) => {
    let count = 0;
    const target = new Set(openSet);
    for (const line of model.lines) {
      const was = initialOpen.has(line.index);
      const now = target.has(line.index);
      if (was !== now) count += 1;
    }
    return count;
  };

  const feasibleBest = () => {
    let best: ComputedCandidate | null = null;
    for (const candidate of candidates) {
      if (!candidate.isFeasible || candidate.lossKw === null) continue;
      if (params.maxSwitchingOps !== null && switchingOps(candidate.openSet) > params.maxSwitchingOps) {
        continue;
      }
      if (!best || candidate.lossKw < (best.lossKw ?? Number.POSITIVE_INFINITY)) best = candidate;
    }
    return best;
  };

  // Iterative refinement: exact-loss branch exchange warm-started from the best
  // feasible sampled candidate (or the current configuration).
  let refinement: BaselineOutcome | null = null;
  if (params.refinementIterations > 0) {
    const seedCandidate = feasibleBest() ?? currentCandidate;
    await report({
      stage: "refinement",
      progress: 62,
      message: `Iterative refinement: warm-started branch exchange from QUBO energy ${seedCandidate.quboEnergy ?? "n/a"} kW surrogate`,
    });
    const refined = branchExchange(
      model,
      loops,
      seedCandidate.openSet,
      limits,
      params.refinementIterations,
    );
    refinement = refined.outcome;
    let refinedOpen = refined.bestOpen;
    if (refined.outcome.bestFeasible) {
      candidates.push(
        makeCandidate(refined.outcome.bestFeasible.openSet, "refinement", null, true),
      );
      notes.push(
        `Refinement accepted ${Math.max(0, refined.outcome.trace.length - 1)} single exchange(s); loss coefficients refreshed from AC power flow each iteration.`,
      );
    }
    if (params.refinementIterations >= 2) {
      const pair = pairExchangePolish(model, loops, refinedOpen, limits, 2);
      refinedOpen = pair.bestOpen;
      if (pair.outcome.bestFeasible) {
        candidates.push(makeCandidate(pair.outcome.bestFeasible.openSet, "refinement", null, true));
        refinement = {
          ...pair.outcome,
          evaluations: refinement.evaluations + pair.outcome.evaluations,
          powerFlows: refinement.powerFlows + pair.outcome.powerFlows,
          runtimeMs: refinement.runtimeMs + pair.outcome.runtimeMs,
          trace: [...refinement.trace, ...pair.outcome.trace.slice(1)],
          note: `${refinement.note} ${pair.outcome.note}`,
        };
        notes.push(pair.outcome.note);
      }
    }
  }

  const baselines: BaselineOutcome[] = [];
  if (params.baselineMilp) {
    await report({
      stage: "baselines",
      progress: 68,
      message: "Solving the MILP-style assignment relaxation with bounded branch and bound",
    });
    const milp = milpAssignmentBaseline(model, loops, limits, {
      perLoop: 3,
      timeBudgetMs: Math.max(1500, Math.min(6000, params.timeoutMs - (Date.now() - started))),
    });
    baselines.push(milp);
    if (milp.bestFeasible) {
      candidates.push(makeCandidate(milp.bestFeasible.openSet, "baseline", null, true));
    }
    if (milp.truncated) notes.push(milp.note);
    const minlp = minlpRelaxation(model, loops, limits, { steps: 80, samples: 16 });
    baselines.push(minlp);
    if (minlp.bestFeasible) {
      candidates.push(makeCandidate(minlp.bestFeasible.openSet, "baseline", null, true));
    }
  }
  if (params.baselineBranchExchange) {
    await report({
      stage: "baselines",
      progress: 72,
      message: "Running classical branch-exchange baseline from the current configuration",
    });
    const baseline = branchExchange(model, loops, initialOpen, limits, 10);
    baselines.push(baseline.outcome);
    if (baseline.outcome.bestFeasible) {
      candidates.push(
        makeCandidate(baseline.outcome.bestFeasible.openSet, "baseline", null, true),
      );
    }
  }
  if (params.baselineBruteForce) {
    await report({
      stage: "baselines",
      progress: 82,
      message: `Running brute-force enumeration over the loop space (${loops
        .reduce((a, l) => a * l.options.length, 1)
        .toLocaleString()} raw combinations)`,
    });
    const brute = bruteForceBaseline(model, loops, limits);
    baselines.push(brute);
    if (brute.bestFeasible) {
      candidates.push(makeCandidate(brute.bestFeasible.openSet, "baseline", null, true));
    }
    if (brute.truncated) notes.push(brute.note);
  }

  await report({
    stage: "validate",
    progress: 90,
    message: "Classical repair + AC power flow validation complete — selecting the best feasible configuration",
  });

  // Keep one row per distinct switch configuration, preferring the validated
  // candidate with the lowest true loss (the recommendation object is preserved).
  const unique = new Map<string, ComputedCandidate>();
  for (const candidate of candidates) {
    const key = candidate.openSet.join(",");
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, candidate);
      continue;
    }
    const existingLoss = existing.lossKw ?? Number.POSITIVE_INFINITY;
    const candidateLoss = candidate.lossKw ?? Number.POSITIVE_INFINITY;
    if (candidateLoss < existingLoss) unique.set(key, candidate);
  }
  const recommendedRaw = feasibleBest();
  const recommendedKey = (recommendedRaw ?? currentCandidate).openSet.join(",");
  const deduped = [...unique.values()];
  if (!deduped.some((c) => c.openSet.join(",") === recommendedKey)) {
    deduped.push(recommendedRaw ?? currentCandidate);
  }
  const recommended =
    deduped.find((c) => c.openSet.join(",") === recommendedKey) ?? recommendedRaw ?? currentCandidate;

  deduped.sort((a, b) => {
    if (a.origin === "current") return 1;
    if (b.origin === "current") return -1;
    return (a.lossKw ?? Number.POSITIVE_INFINITY) - (b.lossKw ?? Number.POSITIVE_INFINITY);
  });
  deduped.forEach((c, i) => {
    c.rank = i + 1;
  });
  if (!recommendedRaw) {
    notes.push(
      "No sampled or repaired configuration satisfied the voltage/loading limits, so the current configuration is returned as the recommendation.",
    );
  }

  const recommendedLoss = recommended.lossKw ?? initial.lossKw ?? 0;
  const initialLoss = initial.lossKw ?? recommendedLoss;
  const lossReductionPct = initialLoss > 0 ? ((initialLoss - recommendedLoss) / initialLoss) * 100 : 0;
  const gapToBestKnownPct =
    model.bestKnownLossKw && recommendedLoss > 0 && recommended.isFeasible
      ? Math.max(0, ((recommendedLoss - model.bestKnownLossKw) / model.bestKnownLossKw) * 100)
      : null;

  const initialStates = switchStatesFromOpen(model, initialOpen);
  const recommendedStates = recommended.switchStates;
  const plan: SwitchingPlanStep[] = [];
  const step = (
    lineIndex: number,
    action: "open" | "close",
    reason: string,
  ) => {
    const line = model.lines[lineIndex];
    plan.push({
      step: plan.length + 1,
      branch: line.branch,
      action,
      fromBus: model.buses[line.from].name,
      toBus: model.buses[line.to].name,
      switchType: line.switchType,
      reason,
    });
  };
  for (const line of model.lines) {
    if (!line.isSwitch) continue;
    const wasClosed = initialStates[String(line.branch)] ?? true;
    const nowClosed = recommendedStates[String(line.branch)] ?? true;
    if (wasClosed && !nowClosed) {
      step(line.index, "open", `Open ${line.switchType} switch ${line.branch} — relieved loading on the loop`);
    }
  }
  for (const line of model.lines) {
    if (!line.isSwitch) continue;
    const wasClosed = initialStates[String(line.branch)] ?? true;
    const nowClosed = recommendedStates[String(line.branch)] ?? true;
    if (!wasClosed && nowClosed) {
      step(line.index, "close", `Close tie switch ${line.branch} — supplies the reconfigured downstream section`);
    }
  }

  const loopSummary = {
    count: loops.length,
    requiredOpenCount: topology.requiredOpenCount,
    switchableCount: topology.switchableCount,
    contractedCount: topology.contractedCount,
    loops: loops.map((loop) => ({
      index: loop.index,
      label: loop.label,
      chord: model.lines[loop.chord].branch,
      options: loop.options.map((i) => {
        const line = model.lines[i];
        const opt = qubo.options.find((o) => o.lineIndex === i);
        return {
          branch: line.branch,
          from: model.buses[line.from].name,
          to: model.buses[line.to].name,
          switchType: line.switchType,
          linearKw: opt?.linear ?? null,
          initialOpen: initialOpen.has(i),
          recommendedOpen: recommended.openSet.includes(i),
        };
      }),
    })),
  };

  const quboSummary = { ...qubo.stats, ...qubo.mapping };
  const solverSummary = {
    fallbackUsed,
    solver: solverOutcome.solver,
    label: solverOutcome.solverLabel,
    runtimeMs: solverOutcome.runtimeMs,
    iterations: solverOutcome.iterations,
    samples: solverOutcome.samples.length,
    note: solverOutcome.note,
    ...solverOutcome.meta,
  };
  const baselineSummary = {
    baselines: baselines.map((b) => ({
      id: b.id,
      label: b.label,
      evaluations: b.evaluations,
      powerFlows: b.powerFlows,
      runtimeMs: b.runtimeMs,
      truncated: b.truncated,
      bestLossKw: b.bestFeasible?.lossKw ?? b.best?.lossKw ?? null,
      bestOpenSwitches: (b.bestFeasible ?? b.best)?.openSet ?? [],
      trace: b.trace,
      note: b.note,
    })),
    refinement: refinement
      ? {
          passes: Math.max(0, refinement.trace.length - 1),
          powerFlows: refinement.powerFlows,
          bestLossKw: refinement.bestFeasible?.lossKw ?? null,
          trace: refinement.trace,
          note: refinement.note,
        }
      : null,
  };

  const distinctKeys = new Set(candidates.map((c) => selectionKey(c.openSet)));
  await report({
    stage: "complete",
    progress: 100,
    message: `Recommended configuration: ${recommendedLoss.toFixed(2)} kW (${lossReductionPct.toFixed(1)}% reduction, origin: ${recommended.origin}), ${distinctKeys.size} distinct candidates validated`,
  });

  void (qubo as QuboModel);

  return {
    model,
    initial,
    candidates: deduped,
    recommended,
    recommendedLoss,
    lossReductionPct,
    feasibilityRate: solverOutcome.samples.length
      ? rawFeasibleCount / solverOutcome.samples.length
      : 0,
    rawRadialRate: solverOutcome.samples.length ? rawRadialCount / solverOutcome.samples.length : 0,
    gapToBestKnownPct,
    switchingPlan: plan,
    loopSummary,
    quboSummary,
    solverSummary,
    baselineSummary,
    runtimeMs: Date.now() - started,
    notes,
  };
}
