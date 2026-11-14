import type { NetModel } from "@/lib/power/model";
import { initialOpenSet } from "@/lib/power/model";
import { approxLossKw } from "@/lib/power/powerflow";
import type { LoopInfo } from "@/lib/power/topology";

export type QuboOption = {
  index: number;
  loop: number;
  lineIndex: number;
  branch: number;
  label: string;
  switchType: string;
  linear: number;
};

export type QuboModel = {
  loops: { index: number; label: string; options: number[]; chordOption: number }[];
  options: QuboOption[];
  linear: Float64Array;
  quadratic: Map<number, number>;
  offset: number;
  penalty: number;
  structurePenalty: number;
  referenceOpen: number[];
  stats: {
    variables: number;
    linearTerms: number;
    quadraticTerms: number;
    maxAbsLinear: number;
    maxAbsQuadratic: number;
    autoPenalty: number;
    penaltyWeight: number;
    autoTuned: boolean;
    approximation: string;
    interactionsComputed: boolean;
    structuralPairs: number;
    referenceApproxLossKw: number;
    meanAbsLinear: number;
  };
  mapping: Record<string, unknown>;
};

export type QuboConfig = { loops: LoopInfo[]; model: NetModel; requiredOpenCount: number };

function referenceSelection(config: QuboConfig): number[] {
  const { loops } = config;
  return loops.map((loop) => (loop.options.includes(loop.chord) ? loop.chord : loop.options[0]));
}

export function buildQubo(
  model: NetModel,
  loops: LoopInfo[],
  requestedPenalty: number | null,
): QuboModel {
  const initial = initialOpenSet(model);
  const referenceOpen = loops.map((loop) =>
    loop.options.find((i) => initial.has(i)) ?? loop.chord,
  );
  const refSet = new Set<number>(referenceOpen);
  const referenceLoss = approxLossKw(model, refSet);
  const options: QuboOption[] = [];
  const loopDescriptors: QuboModel["loops"] = [];

  for (const loop of loops) {
    const optionIndices: number[] = [];
    for (const lineIndex of loop.options) {
      const line = model.lines[lineIndex];
      const openSet = new Set(referenceOpen);
      openSet.delete(referenceOpen[loop.index]);
      openSet.add(lineIndex);
      const loss = approxLossKw(model, openSet);
      const structural = !Number.isFinite(loss);
      const linear = structural ? 1e4 : loss - (Number.isFinite(referenceLoss) ? referenceLoss : 0);
      optionIndices.push(options.length);
      options.push({
        index: options.length,
        loop: loop.index,
        lineIndex,
        branch: line.branch,
        label: `${model.buses[line.from].name}–${model.buses[line.to].name}`,
        switchType: line.switchType,
        linear,
      });
    }
    loopDescriptors.push({
      index: loop.index,
      label: loop.label,
      options: optionIndices,
      chordOption: optionIndices[0],
    });
  }

  const n = options.length;
  const linear = new Float64Array(n);
  for (const opt of options) linear[opt.index] = opt.linear;

  const maxAbsLinear = options.reduce((a, o) => a + Math.abs(o.linear), 0) / Math.max(1, n);
  const peakLinear = options.reduce((a, o) => Math.max(a, Math.abs(o.linear)), 0);
  const meanAbsLinear = maxAbsLinear;

  const autoPenalty = Math.min(1e5, Math.max(25, 3 * peakLinear + 50));
  const penalty = requestedPenalty ?? autoPenalty;

  // Pairwise interactions between options of *different* loops. Structural
  // (islanding) combinations get a deterrent so the surrogate does not prefer
  // them; the lazy radiality check is still authoritative.
  const quadratic = new Map<number, number>();
  const pairBudget = 40000;
  let pairEstimate = 0;
  for (let a = 0; a < loops.length; a += 1) {
    for (let b = a + 1; b < loops.length; b += 1) {
      pairEstimate += loopDescriptors[a].options.length * loopDescriptors[b].options.length;
    }
  }
  const interactionsComputed = pairEstimate <= pairBudget;
  let maxAbsQuadratic = 0;
  let structuralPairs = 0;
  if (interactionsComputed) {
    for (let a = 0; a < loops.length; a += 1) {
      for (let b = a + 1; b < loops.length; b += 1) {
        for (const oi of loopDescriptors[a].options) {
          for (const oj of loopDescriptors[b].options) {
            const openSet = new Set(referenceOpen);
            openSet.delete(referenceOpen[a]);
            openSet.delete(referenceOpen[b]);
            openSet.add(options[oi].lineIndex);
            openSet.add(options[oj].lineIndex);
            const loss = approxLossKw(model, openSet);
            let j: number;
            if (!Number.isFinite(loss)) {
              j = 10 * (peakLinear + 100);
              structuralPairs += 1;
            } else {
              j = loss - referenceLoss - options[oi].linear - options[oj].linear;
            }
            const key = oi * n + oj;
            const existing = quadratic.get(key) ?? 0;
            quadratic.set(key, existing + j);
            if (Math.abs(j) > maxAbsQuadratic) maxAbsQuadratic = Math.abs(j);
          }
        }
      }
    }
  }

  const stats: QuboModel["stats"] = {
    variables: n,
    linearTerms: n,
    quadraticTerms: quadratic.size,
    maxAbsLinear: peakLinear,
    maxAbsQuadratic,
    autoPenalty,
    penaltyWeight: penalty,
    autoTuned: requestedPenalty === null,
    approximation: interactionsComputed
      ? "LinDistFlow quadratic loss surrogate with cross-loop interaction terms"
      : "LinDistFlow linear surrogate (pair budget exceeded — interactions dropped)",
    interactionsComputed,
    structuralPairs,
    referenceApproxLossKw: Number.isFinite(referenceLoss) ? Number(referenceLoss.toFixed(3)) : 0,
    meanAbsLinear: Number(meanAbsLinear.toFixed(3)),
  };

  return {
    loops: loopDescriptors,
    options,
    linear,
    quadratic,
    offset: Number.isFinite(referenceLoss) ? referenceLoss : 0,
    penalty,
    structurePenalty: 10 * (peakLinear + 100),
    referenceOpen,
    stats,
    mapping: {
      encoding: "loop-one-hot",
      loops: loops.length,
      variables: n,
      requiredOpenCount: loops.length,
      openSwitchOnePerLoop: true,
      connectivity: "lazy check + classical repair",
    },
  };
}

/** Sum of objective and one-hot penalty terms for a selection of option indices. */
export function quboEnergy(qubo: QuboModel, selection: number[]): number {
  let energy = qubo.offset;
  const n = qubo.options.length;
  for (const i of selection) energy += qubo.linear[i];
  for (let a = 0; a < selection.length; a += 1) {
    for (let b = a + 1; b < selection.length; b += 1) {
      const ia = selection[a];
      const ib = selection[b];
      const key = ia < ib ? ia * n + ib : ib * n + ia;
      energy += qubo.quadratic.get(key) ?? 0;
    }
  }
  const perLoop = new Map<number, number>();
  for (const i of selection) {
    const loop = qubo.options[i].loop;
    perLoop.set(loop, (perLoop.get(loop) ?? 0) + 1);
  }
  for (const loop of qubo.loops) {
    const count = perLoop.get(loop.index) ?? 0;
    energy += qubo.penalty * (count - 1) ** 2;
  }
  return energy;
}

export function selectionToOpenSet(qubo: QuboModel, selection: number[]): number[] {
  const out = new Set<number>();
  for (const i of selection) {
    const opt = qubo.options[i];
    if (opt) out.add(opt.lineIndex);
  }
  for (const loop of qubo.loops) {
    if (!selection.some((i) => qubo.options[i]?.loop === loop.index)) {
      out.add(qubo.options[loop.chordOption].lineIndex);
    }
  }
  return [...out];
}

export function selectionKey(open: number[]): string {
  return [...open].sort((a, b) => a - b).join(",");
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
