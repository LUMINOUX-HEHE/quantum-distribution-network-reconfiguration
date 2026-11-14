import { adjacency, type NetModel } from "./model";
import { analyseTopology } from "./topology";

export type BranchResult = {
  line: number;
  branch: number;
  from: string;
  to: string;
  switchType: string;
  currentA: number;
  loadingPct: number;
  lossKw: number;
};

export type PowerFlowResult = {
  converged: boolean;
  lossKw: number | null;
  vMin: number;
  vMax: number;
  vMinBus: string;
  maxLoadingPct: number;
  maxLoadingBranch: number | null;
  voltageProfile: { bus: string; v: number }[];
  loadingProfile: {
    branch: number;
    from: string;
    to: string;
    pct: number;
  }[];
  branches: BranchResult[];
  iterations: number;
  message?: string;
};

type NodePair = { to: number; line: number };

/** Downstream active/reactive flow per line for a radial configuration (kW/kvar). */
export function downstreamFlows(
  model: NetModel,
  openSet: Set<number>,
): { p: Float64Array; q: Float64Array; order: number[]; parentLine: Int32Array } | null {
  const topo = analyseTopology(model, openSet);
  if (!topo.reachable || topo.components !== 1) return null;
  const m = model.lines.length;
  const p = new Float64Array(m);
  const q = new Float64Array(m);
  const accP = new Float64Array(model.buses.length);
  const accQ = new Float64Array(model.buses.length);
  for (const bus of model.buses) {
    accP[bus.index] = bus.loadPkw - bus.derPkw;
    accQ[bus.index] = bus.loadQkvar;
  }
  for (let k = topo.order.length - 1; k >= 1; k -= 1) {
    const node = topo.order[k];
    const parent = topo.parent[node];
    const line = topo.parentLine[node];
    if (line < 0 || parent < 0) continue;
    p[line] = accP[node];
    q[line] = accQ[node];
    accP[parent] += accP[node];
    accQ[parent] += accQ[node];
  }
  return { p, q, order: topo.order, parentLine: topo.parentLine };
}

/** Quadratic (LinDistFlow-style) active-loss approximation in kW. */
export function approxLossKw(model: NetModel, openSet: Set<number>): number {
  const flows = downstreamFlows(model, openSet);
  if (!flows) return Number.POSITIVE_INFINITY;
  let loss = 0;
  const v2 = model.baseKv * model.baseKv * 1000;
  for (const line of model.lines) {
    if (openSet.has(line.index)) continue;
    const s2 = flows.p[line.index] ** 2 + flows.q[line.index] ** 2;
    loss += ((line.rPu * (model.baseKv * model.baseKv)) / model.baseMva) * s2 / v2;
  }
  return loss;
}

/** Approximate current magnitude per branch in amps — used by the repair step. */
export function approxCurrentPerBranch(model: NetModel, openSet: Set<number>): Float64Array {
  const out = new Float64Array(model.lines.length);
  const flows = downstreamFlows(model, openSet);
  if (!flows) return out;
  const v3 = Math.sqrt(3) * model.baseKv;
  for (const line of model.lines) {
    if (openSet.has(line.index)) continue;
    const s = Math.sqrt(flows.p[line.index] ** 2 + flows.q[line.index] ** 2);
    out[line.index] = s / v3;
  }
  return out;
}

/**
 * AC power flow by backward/forward sweep on the radial network.
 * Exact enough for distribution feeders (R/X is high, so the sweep converges
 * quickly) and fast enough to validate thousands of candidates per run.
 */
export function runAcPowerFlow(model: NetModel, openSet: Set<number>, maxIter = 120): PowerFlowResult {
  const n = model.buses.length;
  const topo = analyseTopology(model, openSet);
  const emptyProfile = model.buses.map((b) => ({ bus: b.name, v: 1 }));
  if (!topo.reachable || topo.components !== 1) {
    return {
      converged: false,
      lossKw: null,
      vMin: 0,
      vMax: 0,
      vMinBus: "",
      maxLoadingPct: 0,
      maxLoadingBranch: null,
      voltageProfile: emptyProfile,
      loadingProfile: [],
      branches: [],
      iterations: 0,
      message: "Network is not radial/connected — power flow undefined",
    };
  }

  const sRe = new Float64Array(n);
  const sIm = new Float64Array(n);
  for (const bus of model.buses) {
    sRe[bus.index] = (bus.loadPkw - bus.derPkw) / 1000 / model.baseMva;
    sIm[bus.index] = bus.loadQkvar / 1000 / model.baseMva;
  }

  const vRe = new Float64Array(n).fill(1);
  const vIm = new Float64Array(n);
  const workRe = new Float64Array(n);
  const workIm = new Float64Array(n);
  const branchRe = new Float64Array(model.lines.length);
  const branchIm = new Float64Array(model.lines.length);

  let iterations = 0;
  let converged = false;
  for (let iter = 0; iter < maxIter; iter += 1) {
    iterations = iter + 1;
    workRe.fill(0);
    workIm.fill(0);
    for (let i = 0; i < n; i += 1) {
      if (i === model.slack) continue;
      const denom = vRe[i] * vRe[i] + vIm[i] * vIm[i];
      if (denom < 1e-8) break;
      // I = conj(S / V)
      workRe[i] = (sRe[i] * vRe[i] + sIm[i] * vIm[i]) / denom;
      // I = conj(S / V) — the reactive component is negated (inductive load).
      workIm[i] = (sRe[i] * vIm[i] - sIm[i] * vRe[i]) / denom;
    }
    branchRe.fill(0);
    branchIm.fill(0);
    for (let k = topo.order.length - 1; k >= 1; k -= 1) {
      const node = topo.order[k];
      const parent = topo.parent[node];
      const line = topo.parentLine[node];
      if (line < 0 || parent < 0) continue;
      branchRe[line] = workRe[node];
      branchIm[line] = workIm[node];
      workRe[parent] += workRe[node];
      workIm[parent] += workIm[node];
    }

    let maxDelta = 0;
    for (let k = 1; k < topo.order.length; k += 1) {
      const node = topo.order[k];
      const parent = topo.parent[node];
      const line = topo.parentLine[node];
      if (line < 0) continue;
      const l = model.lines[line];
      const newRe = vRe[parent] - (l.rPu * branchRe[line] - l.xPu * branchIm[line]);
      const newIm = vIm[parent] - (l.rPu * branchIm[line] + l.xPu * branchRe[line]);
      maxDelta = Math.max(maxDelta, Math.abs(newRe - vRe[node]), Math.abs(newIm - vIm[node]));
      vRe[node] = newRe;
      vIm[node] = newIm;
    }
    if (maxDelta < 1e-9) {
      converged = true;
      break;
    }
  }

  const magnitudes = new Float64Array(n);
  for (let i = 0; i < n; i += 1) magnitudes[i] = Math.hypot(vRe[i], vIm[i]);

  const iBase = (model.baseMva * 1000) / (Math.sqrt(3) * model.baseKv);
  const branches: BranchResult[] = [];
  let loss = 0;
  let maxLoadingPct = 0;
  let maxLoadingBranch: number | null = null;
  for (let k = 1; k < topo.order.length; k += 1) {
    const node = topo.order[k];
    const line = topo.parentLine[node];
    if (line < 0) continue;
    const l = model.lines[line];
    const cur = Math.hypot(branchRe[line], branchIm[line]);
    const currentA = cur * iBase;
    const loadingPct = (currentA / l.ratingA) * 100;
    const branchLoss = cur * cur * l.rPu * model.baseMva * 1000;
    loss += branchLoss;
    if (loadingPct > maxLoadingPct) {
      maxLoadingPct = loadingPct;
      maxLoadingBranch = l.branch;
    }
    branches.push({
      line: l.index,
      branch: l.branch,
      from: model.buses[l.from].name,
      to: model.buses[l.to].name,
      switchType: l.switchType,
      currentA,
      loadingPct,
      lossKw: branchLoss,
    });
  }

  let vMin = Number.POSITIVE_INFINITY;
  let vMax = 0;
  let vMinBus = "";
  for (const bus of model.buses) {
    const v = magnitudes[bus.index];
    if (v < vMin) {
      vMin = v;
      vMinBus = bus.name;
    }
    if (v > vMax) vMax = v;
  }

  return {
    converged: converged && Number.isFinite(loss),
    lossKw: converged ? loss : null,
    vMin,
    vMax,
    vMinBus,
    maxLoadingPct,
    maxLoadingBranch,
    voltageProfile: model.buses.map((b) => ({
      bus: b.name,
      v: Number(magnitudes[b.index].toFixed(5)),
    })),
    loadingProfile: branches
      .map((b) => ({
        branch: b.branch,
        from: b.from,
        to: b.to,
        pct: Number(b.loadingPct.toFixed(2)),
      }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 12),
    branches,
    iterations,
    message: converged ? undefined : "Backward/forward sweep did not converge",
  };
}

/** Feasibility of a validated configuration against voltage and loading limits. */
export function checkLimits(
  pf: PowerFlowResult,
  limits: { voltageMin: number; voltageMax: number; maxLoadingPct: number },
): { feasible: boolean; violation: string | null } {
  if (!pf.converged || pf.lossKw === null) {
    return { feasible: false, violation: pf.message ?? "Power flow did not converge" };
  }
  const issues: string[] = [];
  if (pf.vMin < limits.voltageMin - 1e-9) {
    issues.push(`Vmin ${pf.vMin.toFixed(4)} pu < ${limits.voltageMin} pu`);
  }
  if (pf.vMax > limits.voltageMax + 1e-9) {
    issues.push(`Vmax ${pf.vMax.toFixed(4)} pu > ${limits.voltageMax} pu`);
  }
  if (pf.maxLoadingPct > limits.maxLoadingPct + 1e-9) {
    issues.push(`Line loading ${pf.maxLoadingPct.toFixed(1)}% > ${limits.maxLoadingPct}%`);
  }
  return { feasible: issues.length === 0, violation: issues.length ? issues.join("; ") : null };
}

export function closedLineCount(model: NetModel, openSet: Set<number>) {
  let count = 0;
  for (const line of model.lines) if (!openSet.has(line.index)) count += 1;
  return count;
}

export function neighbourLines(model: NetModel, openSet: Set<number>): NodePair[][] {
  void openSet;
  return adjacency(model, openSet);
}
