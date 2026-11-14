import { SOLVERS, type SolverId } from "@/lib/networks/types";
import {
  mulberry32,
  quboEnergy,
  selectionKey,
  selectionToOpenSet,
  type QuboModel,
} from "./qubo";

export type SolverSample = {
  selection: number[];
  openSet: number[];
  energy: number;
};

export type SolverOutcome = {
  solver: SolverId;
  solverLabel: string;
  samples: SolverSample[];
  runtimeMs: number;
  iterations: number;
  note: string;
  meta: Record<string, unknown>;
};

export type SolverRunParams = {
  iterations: number;
  restarts: number;
  topK: number;
  seed: number;
};

export class SolverUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolverUnavailableError";
  }
}

export function solverAvailability(id: SolverId): { available: boolean; reason: string } {
  switch (id) {
    case "simulated-annealing":
      return { available: true, reason: "Local in-process annealer" };
    case "quantum-inspired":
      return { available: true, reason: "Parallel tempering replicas (quantum-inspired)" };
    case "genetic-algorithm":
      return { available: true, reason: "Population-based genetic algorithm over the loop encoding" };
    case "qaoa-simulator":
      return { available: true, reason: "Statevector simulator, truncated sub-QUBO (≤10 qubits)" };
    case "dwave-hybrid": {
      const token = process.env.DWAVE_API_TOKEN;
      return token
        ? {
            available: false,
            reason:
              "DWAVE_API_TOKEN is present, but outbound Leap submission is disabled in this deployment",
          }
        : {
            available: false,
            reason: "DWAVE_API_TOKEN is not configured on the server (credentials stay server-side)",
          };
    }
    default:
      return { available: false, reason: "Unknown solver" };
  }
}

function eliteTracker(qubo: QuboModel, limit = 4000) {
  const map = new Map<string, SolverSample>();
  const push = (selection: number[], energy: number) => {
    const openSet = selectionToOpenSet(qubo, selection);
    const key = selectionKey(openSet);
    const existing = map.get(key);
    if (!existing || energy < existing.energy) {
      map.set(key, { selection: [...selection], openSet, energy });
      if (map.size > limit) {
        const sorted = [...map.entries()].sort((a, b) => a[1].energy - b[1].energy);
        const keep = sorted.slice(0, Math.floor(limit / 2));
        map.clear();
        for (const [k, v] of keep) map.set(k, v);
      }
    }
  };
  return { map, push };
}

function greedyPolish(qubo: QuboModel, selection: number[], energy: number, budget: number) {
  let best = [...selection];
  let bestEnergy = energy;
  for (let step = 0; step < budget; step += 1) {
    let improved = false;
    for (const loop of qubo.loops) {
      for (const option of loop.options) {
        if (best[loop.index] === option) continue;
        const trial = [...best];
        trial[loop.index] = option;
        const e = quboEnergy(qubo, trial);
        if (e < bestEnergy - 1e-9) {
          best = trial;
          bestEnergy = e;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { selection: best, energy: bestEnergy };
}

function finalise(qubo: QuboModel, samples: SolverSample[], topK: number): SolverSample[] {
  const seen = new Set<string>();
  const out: SolverSample[] = [];
  for (const s of [...samples].sort((a, b) => a.energy - b.energy)) {
    const key = selectionKey(s.openSet);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= topK) break;
  }
  return out;
}

function simulatedAnnealing(
  qubo: QuboModel,
  params: SolverRunParams,
): SolverOutcome {
  const started = Date.now();
  const rng = mulberry32(params.seed);
  const { map, push } = eliteTracker(qubo);
  const loops = qubo.loops;
  const restarts = Math.max(1, params.restarts);
  const stepsPerRestart = Math.max(200, Math.floor(params.iterations));
  const t0 = Math.max(1, qubo.penalty * 0.08);
  const t1 = Math.max(0.01, t0 * 0.0005);
  let accepted = 0;
  let totalSteps = 0;

  for (let r = 0; r < restarts; r += 1) {
    let selection = loops.map((loop) =>
      r === 0
        ? loop.chordOption
        : loop.options[Math.floor(rng() * loop.options.length)],
    );
    let energy = quboEnergy(qubo, selection);
    const cooling = Math.pow(t1 / t0, 1 / Math.max(1, stepsPerRestart));
    let temperature = t0;
    for (let step = 0; step < stepsPerRestart; step += 1) {
      const loopIndex = Math.floor(rng() * loops.length);
      const options = loops[loopIndex].options;
      if (options.length > 1) {
        let pick = options[Math.floor(rng() * options.length)];
        if (pick === selection[loopIndex]) {
          pick = options[(options.indexOf(pick) + 1) % options.length];
        }
        const trial = [...selection];
        trial[loopIndex] = pick;
        const trialEnergy = quboEnergy(qubo, trial);
        const delta = trialEnergy - energy;
        if (delta <= 0 || rng() < Math.exp(-delta / Math.max(1e-9, temperature))) {
          selection = trial;
          energy = trialEnergy;
          accepted += 1;
        }
      }
      temperature *= cooling;
      totalSteps += 1;
      if (step % 25 === 0) push(selection, energy);
    }
    push(selection, energy);
    // classical polish of the restart endpoint
    const polished = greedyPolish(qubo, selection, energy, 4);
    push(polished.selection, polished.energy);
  }

  const raw = [...map.values()];
  const polishedTop = raw
    .slice(0, 12)
    .map((s) => greedyPolish(qubo, s.selection, s.energy, 6));
  for (const s of polishedTop) push(s.selection, s.energy);
  const samples = finalise(qubo, [...map.values()], params.topK);

  return {
    solver: "simulated-annealing",
    solverLabel: "Simulated annealing",
    samples,
    runtimeMs: Date.now() - started,
    iterations: totalSteps,
    note: "Geometric cooling over the loop one-hot encoding, followed by greedy classical polish.",
    meta: {
      restarts,
      stepsPerRestart,
      acceptanceRate: Number((accepted / Math.max(1, totalSteps)).toFixed(4)),
      distinctElites: map.size,
      startTemperature: Number(t0.toFixed(3)),
      finalTemperature: Number(t1.toFixed(4)),
    },
  };
}

function quantumInspired(qubo: QuboModel, params: SolverRunParams): SolverOutcome {
  const started = Date.now();
  const rng = mulberry32(params.seed + 7919);
  const { push } = eliteTracker(qubo, 6000);
  const loops = qubo.loops;
  const replicas = 10;
  const temps: number[] = [];
  const hot = Math.max(5, qubo.penalty * 0.25);
  const cold = Math.max(0.02, hot / 400);
  for (let i = 0; i < replicas; i += 1) {
    temps.push(hot * Math.pow(cold / hot, i / (replicas - 1)));
  }
  const stepsPerReplica = Math.max(150, Math.floor(params.iterations / replicas));
  const states = Array.from({ length: replicas }, () =>
    loops.map((loop) => loop.options[Math.floor(rng() * loop.options.length)]),
  );
  const energies = states.map((s) => quboEnergy(qubo, s));
  let swaps = 0;

  for (let step = 0; step < stepsPerReplica * Math.max(1, params.restarts); step += 1) {
    for (let r = 0; r < replicas; r += 1) {
      const loopIndex = Math.floor(rng() * loops.length);
      const options = loops[loopIndex].options;
      if (options.length < 2) continue;
      let pick = options[Math.floor(rng() * options.length)];
      if (pick === states[r][loopIndex]) {
        pick = options[(options.indexOf(pick) + 1) % options.length];
      }
      const trial = [...states[r]];
      trial[loopIndex] = pick;
      const trialEnergy = quboEnergy(qubo, trial);
      const delta = trialEnergy - energies[r];
      if (delta <= 0 || rng() < Math.exp(-delta / temps[r])) {
        states[r] = trial;
        energies[r] = trialEnergy;
      }
      if (step % 20 === 0) push(trial, trialEnergy);
    }
    // replica exchange
    for (let r = 0; r < replicas - 1; r += 1) {
      const delta = (energies[r] - energies[r + 1]) * (1 / temps[r] - 1 / temps[r + 1]);
      if (delta > 0 || rng() < Math.exp(delta)) {
        const tmpState = states[r];
        states[r] = states[r + 1];
        states[r + 1] = tmpState;
        const tmpEnergy = energies[r];
        energies[r] = energies[r + 1];
        energies[r + 1] = tmpEnergy;
        swaps += 1;
      }
    }
  }
  for (let r = 0; r < replicas; r += 1) push(states[r], energies[r]);
  const samples = finalise(qubo, [...states.map((s, i) => ({ selection: s, openSet: selectionToOpenSet(qubo, s), energy: energies[i] }))], params.topK);
  const extra = finalise(qubo, [...Array.from({ length: replicas }, (_, i) => states[i]).map((s) => ({ selection: s, openSet: selectionToOpenSet(qubo, s), energy: quboEnergy(qubo, s) }))], params.topK);
  for (const s of extra) if (!samples.some((x) => selectionKey(x.openSet) === selectionKey(s.openSet))) samples.push(s);

  return {
    solver: "quantum-inspired",
    solverLabel: "Quantum-inspired annealer",
    samples: finalise(qubo, samples, params.topK),
    runtimeMs: Date.now() - started,
    iterations: stepsPerReplica * replicas * Math.max(1, params.restarts),
    note: "Parallel tempering across 10 temperature replicas with replica exchange (quantum-inspired classical hardware).",
    meta: {
      replicas,
      swaps,
      stepsPerReplica,
      hottestTemperature: Number(hot.toFixed(3)),
      coldestTemperature: Number(cold.toFixed(4)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* QAOA statevector simulator                                          */
/* ------------------------------------------------------------------ */

type QaoaReduction = {
  qubits: number;
  optionIndices: number[];
  loopOfQubit: number[];
  fixedSelections: number[];
  loopsCovered: number[];
  truncated: boolean;
};

function reduceForQaoa(qubo: QuboModel, maxQubits: number): QaoaReduction {
  const maxPerLoop = Math.max(1, Math.floor(maxQubits / Math.max(1, qubo.loops.length)));
  const optionIndices: number[] = [];
  const loopOfQubit: number[] = [];
  const fixedSelections: number[] = [];
  const loopsCovered: number[] = [];
  let truncated = false;

  for (const loop of qubo.loops) {
    const ranked = [...loop.options].sort(
      (a, b) => qubo.linear[a] - qubo.linear[b],
    );
    const keep = ranked.slice(0, Math.max(1, Math.min(maxPerLoop, ranked.length)));
    if (keep.length < ranked.length) truncated = true;
    fixedSelections[loop.index] = keep[0];
    if (optionIndices.length + keep.length > maxQubits) {
      truncated = true;
      continue;
    }
    loopsCovered.push(loop.index);
    for (const opt of keep) {
      optionIndices.push(opt);
      loopOfQubit.push(loop.index);
    }
  }
  return {
    qubits: optionIndices.length,
    optionIndices,
    loopOfQubit,
    fixedSelections,
    loopsCovered,
    truncated,
  };
}

function qaoaDiagonal(qubo: QuboModel, reduction: QaoaReduction): Float64Array {
  const dim = 1 << reduction.qubits;
  const diag = new Float64Array(dim);
  for (let state = 0; state < dim; state += 1) {
    const selection = [...reduction.fixedSelections];
    const perLoopBits = new Map<number, number>();
    for (let q = 0; q < reduction.qubits; q += 1) {
      if ((state >> q) & 1) {
        const opt = reduction.optionIndices[q];
        const loop = reduction.loopOfQubit[q];
        if (!perLoopBits.has(loop)) {
          perLoopBits.set(loop, 0);
          selection[loop] = opt;
        }
        perLoopBits.set(loop, (perLoopBits.get(loop) ?? 0) + 1);
      }
    }
    let energy = quboEnergy(qubo, selection);
    for (const loop of reduction.loopsCovered) {
      const count = perLoopBits.get(loop) ?? 0;
      energy += qubo.penalty * (count - 1) ** 2;
    }
    diag[state] = energy;
  }
  return diag;
}

function qaoaStatevector(
  diag: Float64Array,
  qubits: number,
  gammas: number[],
  betas: number[],
): { re: Float64Array; im: Float64Array } {
  const dim = 1 << qubits;
  const norm = 1 / Math.sqrt(dim);
  let re = new Float64Array(dim).fill(norm);
  let im = new Float64Array(dim);
  for (let layer = 0; layer < gammas.length; layer += 1) {
    const gamma = gammas[layer];
    const beta = betas[layer];
    const nextRe = new Float64Array(dim);
    const nextIm = new Float64Array(dim);
    for (let s = 0; s < dim; s += 1) {
      const theta = gamma * diag[s];
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      // exp(-i theta) * (re + i im)
      nextRe[s] = re[s] * c + im[s] * sn;
      nextIm[s] = im[s] * c - re[s] * sn;
    }
    re = nextRe;
    im = nextIm;
    // mixer: Rx(2 beta) per qubit
    for (let q = 0; q < qubits; q += 1) {
      const mask = 1 << q;
      const c = Math.cos(beta);
      const sn = Math.sin(beta);
      for (let s = 0; s < dim; s += 1) {
        if (s & mask) continue;
        const t = s | mask;
        const aRe = re[s];
        const aIm = im[s];
        const bRe = re[t];
        const bIm = im[t];
        // Rx(theta) = [[cos, -i sin], [-i sin, cos]]
        re[s] = c * aRe + sn * bIm;
        im[s] = c * aIm - sn * bRe;
        re[t] = c * bRe + sn * aIm;
        im[t] = c * bIm - sn * aRe;
      }
    }
  }
  return { re, im };
}

function expectation(diag: Float64Array, re: Float64Array, im: Float64Array): number {
  let exp = 0;
  for (let s = 0; s < diag.length; s += 1) exp += diag[s] * (re[s] * re[s] + im[s] * im[s]);
  return exp;
}

function qaoaSolver(qubo: QuboModel, params: SolverRunParams): SolverOutcome {
  const started = Date.now();
  const rng = mulberry32(params.seed + 104729);
  const maxQubits = 10;
  const reduction = reduceForQaoa(qubo, maxQubits);
  if (reduction.qubits === 0) {
    throw new SolverUnavailableError("The QUBO has no encodable options for the QAOA simulator");
  }
  const diag = qaoaDiagonal(qubo, reduction);
  const layers = 2;
  let gammas = [0.6, 1.3];
  let betas = [0.4, 0.7];
  let bestExp = Number.POSITIVE_INFINITY;
  let evaluations = 0;

  // deterministic coordinate search over the four variational parameters
  for (let round = 0; round < 3; round += 1) {
    for (let p = 0; p < 2 * layers; p += 1) {
      for (let k = 0; k < 9; k += 1) {
        const value = (k / 8) * Math.PI;
        const trialG = [...gammas];
        const trialB = [...betas];
        if (p < layers) trialG[p] = value;
        else trialB[p - layers] = value;
        const { re, im } = qaoaStatevector(diag, reduction.qubits, trialG, trialB);
        const exp = expectation(diag, re, im);
        evaluations += 1;
        if (exp < bestExp) {
          bestExp = exp;
          gammas = trialG;
          betas = trialB;
        }
      }
    }
  }

  const { re, im } = qaoaStatevector(diag, reduction.qubits, gammas, betas);
  const probs = new Float64Array(re.length);
  for (let s = 0; s < re.length; s += 1) probs[s] = re[s] * re[s] + im[s] * im[s];

  const rankedStates = [...probs.keys()]
    .sort((a, b) => probs[b] - probs[a])
    .slice(0, Math.max(1, Math.min(probs.length, params.topK * 6)));

  const samples: SolverSample[] = [];
  for (const state of rankedStates) {
    const selection = [...reduction.fixedSelections];
    for (let q = 0; q < reduction.qubits; q += 1) {
      if ((state >> q) & 1) selection[reduction.loopOfQubit[q]] = reduction.optionIndices[q];
    }
    samples.push({
      selection,
      openSet: selectionToOpenSet(qubo, selection),
      energy: quboEnergy(qubo, selection),
    });
  }
  // A few shot samples drawn from the variational distribution
  const shots = 128;
  for (let shot = 0; shot < shots; shot += 1) {
    let r = rng();
    let state = 0;
    for (let s = 0; s < probs.length; s += 1) {
      r -= probs[s];
      if (r <= 0) {
        state = s;
        break;
      }
    }
    const selection = [...reduction.fixedSelections];
    for (let q = 0; q < reduction.qubits; q += 1) {
      if ((state >> q) & 1) selection[reduction.loopOfQubit[q]] = reduction.optionIndices[q];
    }
    samples.push({
      selection,
      openSet: selectionToOpenSet(qubo, selection),
      energy: quboEnergy(qubo, selection),
    });
  }

  return {
    solver: "qaoa-simulator",
    solverLabel: "QAOA simulator",
    samples: finalise(qubo, samples, params.topK),
    runtimeMs: Date.now() - started,
    iterations: evaluations,
    note: reduction.truncated
      ? `QAOA ran on a ${reduction.qubits}-qubit truncated sub-QUBO (${reduction.loopsCovered.length}/${qubo.loops.length} loops); remaining loops fixed at their best linear option.`
      : `QAOA ran on the full ${reduction.qubits}-qubit sub-QUBO.`,
    meta: {
      qubits: reduction.qubits,
      layers,
      gammas: gammas.map((g) => Number(g.toFixed(4))),
      betas: betas.map((b) => Number(b.toFixed(4))),
      expectation: Number(bestExp.toFixed(4)),
      evaluations,
      shots,
      truncated: reduction.truncated,
    },
  };
}

function geneticAlgorithm(qubo: QuboModel, params: SolverRunParams): SolverOutcome {
  const started = Date.now();
  const rng = mulberry32(params.seed + 15485863);
  const loops = qubo.loops;
  const populationSize = Math.max(12, Math.min(64, Math.round(params.iterations / 200)));
  const generations = Math.max(10, Math.min(400, Math.round(params.iterations / populationSize)));
  const eliteCount = Math.max(2, Math.round(populationSize * 0.15));
  const mutate = (selection: number[]) => {
    const trial = [...selection];
    const loopIndex = Math.floor(rng() * loops.length);
    const options = loops[loopIndex].options;
    trial[loopIndex] = options[Math.floor(rng() * options.length)];
    return trial;
  };
  const crossover = (a: number[], b: number[]) => {
    const cut = 1 + Math.floor(rng() * (loops.length - 1));
    return a.map((option, i) => (i < cut ? option : b[i]));
  };
  let population = Array.from({ length: populationSize }, (_, i) =>
    loops.map((loop) =>
      i === 0 ? loop.chordOption : loop.options[Math.floor(rng() * loop.options.length)],
    ),
  );
  const evaluate = (selection: number[]) => quboEnergy(qubo, selection);
  let fitness = population.map(evaluate);
  const history: number[] = [];
  let mutations = 0;
  let crossovers = 0;

  for (let generation = 0; generation < generations; generation += 1) {
    const ranked = population
      .map((selection, i) => ({ selection, energy: fitness[i] }))
      .sort((a, b) => a.energy - b.energy);
    history.push(Number(ranked[0].energy.toFixed(2)));
    const nextPopulation = ranked.slice(0, eliteCount).map((r) => r.selection);
    while (nextPopulation.length < populationSize) {
      const tournament = () => {
        const a = ranked[Math.floor(rng() * ranked.length)];
        const b = ranked[Math.floor(rng() * ranked.length)];
        return a.energy <= b.energy ? a.selection : b.selection;
      };
      let child = crossover(tournament(), tournament());
      crossovers += 1;
      if (rng() < 0.35) {
        child = mutate(child);
        mutations += 1;
      }
      nextPopulation.push(child);
    }
    population = nextPopulation;
    fitness = population.map(evaluate);
  }
  const ranked = population
    .map((selection, i) => ({ selection, energy: fitness[i] }))
    .sort((a, b) => a.energy - b.energy);
  const polished = ranked.slice(0, Math.min(8, ranked.length)).map((s) => {
    const p = greedyPolish(qubo, s.selection, s.energy, 5);
    return { selection: p.selection, energy: p.energy };
  });
  const samples = finalise(
    qubo,
    [...polished, ...ranked].map((s) => ({
      selection: s.selection,
      openSet: selectionToOpenSet(qubo, s.selection),
      energy: s.energy,
    })),
    params.topK,
  );
  return {
    solver: "genetic-algorithm",
    solverLabel: "Genetic algorithm",
    samples,
    runtimeMs: Date.now() - started,
    iterations: generations * populationSize,
    note: "Tournament selection, uniform crossover and single-loop mutation with elitism, followed by greedy classical polish.",
    meta: {
      populationSize,
      generations,
      eliteCount,
      mutationRate: 0.35,
      crossovers,
      mutations,
      bestEnergyHistory: history.filter((_, i) => i % Math.max(1, Math.floor(history.length / 8)) === 0),
    },
  };
}

export function runSolver(id: SolverId, qubo: QuboModel, params: SolverRunParams): SolverOutcome {
  const availability = solverAvailability(id);
  if (!availability.available) {
    throw new SolverUnavailableError(`${id}: ${availability.reason}`);
  }
  switch (id) {
    case "simulated-annealing":
      return simulatedAnnealing(qubo, params);
    case "quantum-inspired":
      return quantumInspired(qubo, params);
    case "genetic-algorithm":
      return geneticAlgorithm(qubo, params);
    case "qaoa-simulator":
      return qaoaSolver(qubo, params);
    default:
      throw new SolverUnavailableError(`${id} is not implemented in this deployment`);
  }
}

export function solverName(id: string): string {
  return SOLVERS.find((s) => s.id === id)?.name ?? id;
}
