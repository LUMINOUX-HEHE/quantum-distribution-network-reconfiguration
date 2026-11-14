import { adjacency, initialOpenSet, type NetModel } from "./model";
import { analyseTopology, repairConfiguration, findLoops } from "./topology";
import { approxCurrentPerBranch, checkLimits, runAcPowerFlow, type PowerFlowResult } from "./powerflow";

export type FaultKind = "line" | "switch-open" | "switch-stuck-closed";
export type FaultSpec = { kind: FaultKind; branch: number };

export type FaultResult = {
  branch: number;
  kind: FaultKind;
  section: string;
  components: number;
  deEnergizedBuses: string[];
  deEnergizedCount: number;
  loadShedKw: number;
  criticalLoadShedKw: number;
  restoration: {
    attempted: boolean;
    radial: boolean;
    feasible: boolean;
    actions: { action: "open" | "close"; branch: number; reason: string }[];
    restoredBuses: number;
    restoredLoadKw: number;
    restoredPct: number;
    lossKw: number | null;
    vMin: number;
    maxLoadingPct: number;
    violation: string | null;
  };
  outageReductionPct: number;
};

export type FaultStudySummary = {
  faults: FaultResult[];
  totals: {
    studied: number;
    unrestorable: number;
    averageRestoredPct: number;
    worstCase: FaultResult | null;
    criticalLoadAtRiskKw: number;
  };
};

function busNames(model: NetModel, indices: number[]): string[] {
  return indices.map((i) => model.buses[i].name);
}

function deEnergized(model: NetModel, openSet: Set<number>, faulted: number | null): number[] {
  const adj = adjacency(model, openSet);
  const seen = new Uint8Array(model.buses.length);
  const queue = [model.slack];
  seen[model.slack] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    for (const edge of adj[queue[head]]) {
      if (faulted !== null && edge.line === faulted) continue;
      if (!seen[edge.to]) {
        seen[edge.to] = 1;
        queue.push(edge.to);
      }
    }
  }
  const out: number[] = [];
  for (let i = 0; i < model.buses.length; i += 1) if (!seen[i]) out.push(i);
  return out;
}

/**
 * Contingency analysis for a single failure.
 * Step 1: apply the fault and find de-energised islands.
 * Step 2: search alternative supply routes with the same loop-based repair used
 *         by the optimiser, scoring restored load and critical-load priority.
 * Step 3: validate the restored configuration with AC power flow.
 */
export function analyseContingency(
  model: NetModel,
  fault: FaultSpec,
  limits: { voltageMin: number; voltageMax: number; maxLoadingPct: number },
  criticalBuses: string[] = [],
): FaultResult {
  const line = model.lines.find((l) => l.branch === fault.branch);
  const baseOpen = initialOpenSet(model);
  const criticalSet = new Set(criticalBuses);
  const loops = findLoops(model).loops;

  if (!line) {
    return {
      branch: fault.branch,
      kind: fault.kind,
      section: "unknown",
      components: 1,
      deEnergizedBuses: [],
      deEnergizedCount: 0,
      loadShedKw: 0,
      criticalLoadShedKw: 0,
      restoration: {
        attempted: false,
        radial: false,
        feasible: false,
        actions: [],
        restoredBuses: 0,
        restoredLoadKw: 0,
        restoredPct: 0,
        lossKw: null,
        vMin: 0,
        maxLoadingPct: 0,
        violation: "Unknown branch",
      },
      outageReductionPct: 0,
    };
  }

  const preFaultOpen = new Set(baseOpen);
  let faultedOpen = new Set(preFaultOpen);
  if (fault.kind === "line" || fault.kind === "switch-open") faultedOpen.add(line.index);
  if (fault.kind === "switch-stuck-closed") faultedOpen.delete(line.index);

  const islanded = deEnergized(model, faultedOpen, line.index);
  const shedLoad = islanded.reduce((a, i) => a + model.buses[i].loadPkw, 0);
  const criticalShed = islanded
    .filter((i) => criticalSet.has(model.buses[i].name))
    .reduce((a, i) => a + model.buses[i].loadPkw, 0);

  // Restoration: try each closed/open swap that reconnects an island, keeping
  // the radial edge budget. Rank by restored critical load, then restored load.
  type Trial = {
    openSet: Set<number>;
    actions: { action: "open" | "close"; branch: number; reason: string }[];
    restoredBuses: number;
    restoredLoad: number;
    criticalRestored: number;
    remaining: number;
  };
  const trials: Trial[] = [];
  const openCandidates = model.lines.filter((l) => faultedOpen.has(l.index) && l.isSwitch);

  for (const closeLine of openCandidates) {
    const trial = new Set(faultedOpen);
    trial.delete(closeLine.index);
    const overBudget = analyseTopology(model, trial).edgesClosed > model.buses.length - 1;
    const options: number[][] = overBudget
      ? model.lines
          .filter((l) => !trial.has(l.index) && l.isSwitch && l.index !== closeLine.index && l.index !== line.index)
          .map((l) => [l.index])
      : [[]];
    for (const extra of options) {
      const candidate = new Set(trial);
      for (const e of extra) candidate.add(e);
      if (!analyseTopology(model, candidate).isRadial) continue;
      const remainingBuses = deEnergized(model, candidate, line.index);
      const restoredLoad = islanded
        .filter((i) => !remainingBuses.includes(i))
        .reduce((a, i) => a + model.buses[i].loadPkw, 0);
      if (restoredLoad <= 0) continue;
      const criticalRestored = islanded
        .filter((i) => !remainingBuses.includes(i) && criticalSet.has(model.buses[i].name))
        .reduce((a, i) => a + model.buses[i].loadPkw, 0);
      const actions: Trial["actions"] = [
        {
          action: "close",
          branch: closeLine.branch,
          reason: fault.kind === "line" ? "alternative supply route" : "restore switched-out section",
        },
        ...extra.map((e) => ({
          action: "open" as const,
          branch: model.lines[e].branch,
          reason: "keep the network radial after the transfer",
        })),
      ];
      trials.push({
        openSet: candidate,
        actions,
        restoredBuses: islanded.length - remainingBuses.length,
        restoredLoad,
        criticalRestored,
        remaining: remainingBuses.length,
      });
    }
  }

  trials.sort(
    (a, b) =>
      b.criticalRestored - a.criticalRestored ||
      b.restoredLoad - a.restoredLoad ||
      a.remaining - b.remaining,
  );
  const best = trials[0];
  if (!best) {
    return {
      branch: line.branch,
      kind: fault.kind,
      section: `${model.buses[line.from].name}–${model.buses[line.to].name}`,
      components: new Set(islanded.map(String)).size,
      deEnergizedBuses: busNames(model, islanded),
      deEnergizedCount: islanded.length,
      loadShedKw: Number(shedLoad.toFixed(2)),
      criticalLoadShedKw: Number(criticalShed.toFixed(2)),
      restoration: {
        attempted: islanded.length > 0,
        radial: false,
        feasible: false,
        actions: [],
        restoredBuses: 0,
        restoredLoadKw: 0,
        restoredPct: 0,
        lossKw: null,
        vMin: 0,
        maxLoadingPct: 0,
        violation: islanded.length ? "No alternative supply route available" : "No load lost",
      },
      outageReductionPct: 0,
    };
  }

  const pf = runAcPowerFlow(model, best.openSet);
  const limitsCheck = checkLimits(pf, limits);
  const stillOut = deEnergized(model, best.openSet, line.index);
  const postShed = stillOut.reduce((a, i) => a + model.buses[i].loadPkw, 0);
  const repair = repairConfiguration(model, best.openSet, loops, (set) => approxCurrentPerBranch(model, set));

  return {
    branch: line.branch,
    kind: fault.kind,
    section: `${model.buses[line.from].name}–${model.buses[line.to].name}`,
    components: 1,
    deEnergizedBuses: busNames(model, stillOut),
    deEnergizedCount: stillOut.length,
    loadShedKw: Number(postShed.toFixed(2)),
    criticalLoadShedKw: Number(
      stillOut
        .filter((i) => criticalSet.has(model.buses[i].name))
        .reduce((a, i) => a + model.buses[i].loadPkw, 0)
        .toFixed(2),
    ),
    restoration: {
      attempted: true,
      radial: repair.radial,
      feasible: limitsCheck.feasible,
      actions: best.actions,
      restoredBuses: best.restoredBuses,
      restoredLoadKw: Number(best.restoredLoad.toFixed(2)),
      restoredPct: shedLoad > 0 ? Number(((best.restoredLoad / shedLoad) * 100).toFixed(1)) : 100,
      lossKw: pf.lossKw === null ? null : Number(pf.lossKw.toFixed(2)),
      vMin: Number(pf.vMin.toFixed(5)),
      maxLoadingPct: Number(pf.maxLoadingPct.toFixed(2)),
      violation: limitsCheck.violation,
    },
    outageReductionPct: shedLoad > 0 ? Number(((best.restoredLoad / shedLoad) * 100).toFixed(1)) : 100,
  };
}

/** Exhaustive N-1 scan over every switchable branch. */
export function n1Scan(
  model: NetModel,
  limits: { voltageMin: number; voltageMax: number; maxLoadingPct: number },
  criticalBuses: string[] = [],
  maxFaults = 80,
): FaultStudySummary {
  const switchable = model.lines.filter((l) => l.isSwitch).slice(0, maxFaults);
  const faults = switchable.map((line) =>
    analyseContingency(model, { kind: line.switchType === "tie" ? "switch-open" : "line", branch: line.branch }, limits, criticalBuses),
  );
  const restorable = faults.filter((f) => f.restoration.attempted);
  const averageRestoredPct =
    restorable.length > 0
      ? restorable.reduce((a, f) => a + f.restoration.restoredPct, 0) / restorable.length
      : 100;
  const worstCase = faults.reduce<FaultResult | null>(
    (acc, f) => (!acc || f.loadShedKw > acc.loadShedKw ? f : acc),
    null,
  );
  return {
    faults,
    totals: {
      studied: faults.length,
      unrestorable: faults.filter((f) => f.deEnergizedCount > 0).length,
      averageRestoredPct: Number(averageRestoredPct.toFixed(1)),
      worstCase,
      criticalLoadAtRiskKw: Number(
        faults.reduce((a, f) => a + f.criticalLoadShedKw, 0).toFixed(2),
      ),
    },
  };
}

/** Post-restoration validation helper used by the API and tests. */
export function validateRestoration(
  model: NetModel,
  openSet: number[],
  limits: { voltageMin: number; voltageMax: number; maxLoadingPct: number },
): { radial: boolean; feasible: boolean; vMin: number; lossKw: number | null; violation: string | null } {
  const set = new Set(openSet);
  const radial = analyseTopology(model, set).isRadial;
  if (!radial) {
    return { radial, feasible: false, vMin: 0, lossKw: null, violation: "Not radial" };
  }
  const pf: PowerFlowResult = runAcPowerFlow(model, set);
  const check = checkLimits(pf, limits);
  return {
    radial,
    feasible: check.feasible,
    vMin: Number(pf.vMin.toFixed(5)),
    lossKw: pf.lossKw === null ? null : Number(pf.lossKw.toFixed(2)),
    violation: check.violation,
  };
}
