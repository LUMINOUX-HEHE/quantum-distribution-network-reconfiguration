import { buildQubo, quboEnergy, type QuboModel } from "./qubo";
import type { NetModel } from "@/lib/power/model";
import type { LoopInfo } from "@/lib/power/topology";

export type QaoaCircuit = {
  qubits: number;
  layers: number;
  gammas: number[];
  betas: number[];
  qasm: string;
  terms: { qubit: number; weight: number }[][];
  couplings: { i: number; j: number; weight: number }[];
  offsets: number[];
  truncated: boolean;
  loopMapping: { qubit: number; loop: number; branch: number; linearKw: number }[];
};

/**
 * Build an executable QAOA circuit for the loop-encoded QUBO. The diagonal
 * energy is separated into single-qubit Z rotations, ZZ couplings and a global
 * phase, so the exported OpenQASM can run unchanged on Qiskit Aer (or hardware)
 * while the in-app simulator uses the same decomposition.
 */
export function buildQaoaCircuit(
  model: NetModel,
  loops: LoopInfo[],
  options: { requestedPenalty?: number | null; maxQubits?: number; layers?: number; gammas?: number[]; betas?: number[] } = {},
): QaoaCircuit {
  const maxQubits = options.maxQubits ?? 10;
  const layers = options.layers ?? 2;
  const qubo: QuboModel = buildQubo(model, loops, options.requestedPenalty ?? null);

  // Pick the cheapest options per loop until the qubit budget is reached.
  const selected: number[] = [];
  const loopOfQubit: number[] = [];
  const fixed = new Map<number, number>();
  let truncated = false;
  const perLoopBudget = Math.max(1, Math.floor(maxQubits / Math.max(1, qubo.loops.length)));
  for (const loop of qubo.loops) {
    const ranked = [...loop.options].sort((a, b) => qubo.linear[a] - qubo.linear[b]);
    const keep = ranked.slice(0, Math.min(perLoopBudget, ranked.length));
    if (keep.length < ranked.length) truncated = true;
    fixed.set(loop.index, keep[0]);
    for (const option of keep) {
      if (selected.length >= maxQubits) {
        truncated = true;
        break;
      }
      selected.push(option);
      loopOfQubit.push(loop.index);
    }
  }
  const qubits = selected.length;
  const dim = 1 << qubits;
  const diag = new Float64Array(dim);
  for (let state = 0; state < dim; state += 1) {
    const selection = qubo.loops.map((loop) => fixed.get(loop.index) ?? loop.chordOption);
    const used = new Set<number>();
    for (let q = 0; q < qubits; q += 1) {
      if ((state >> q) & 1) {
        selection[loopOfQubit[q]] = selected[q];
        used.add(loopOfQubit[q]);
      }
    }
    let energy = quboEnergy(qubo, selection);
    for (const loop of qubo.loops) {
      if (used.has(loop.index)) continue;
      // exactly the fixed option is assigned, so the one-hot group is satisfied
      if (!fixed.has(loop.index)) energy += qubo.penalty;
    }
    diag[state] = energy;
  }

  // Ising decomposition: E(z) = offset + Σ h_i z_i + Σ J_ij z_i z_j with z = 1 − 2x
  const h: number[] = [];
  for (let q = 0; q < qubits; q += 1) {
    const plus = diag[1 << q];
    const minus = diag[0];
    h.push((plus - minus) / 4);
  }
  const j: { i: number; j: number; weight: number }[] = [];
  for (let a = 0; a < qubits; a += 1) {
    for (let b = a + 1; b < qubits; b += 1) {
      const both = diag[(1 << a) | (1 << b)];
      const onlyA = diag[1 << a];
      const onlyB = diag[1 << b];
      const none = diag[0];
      j.push({ i: a, j: b, weight: (both - onlyA - onlyB + none) / 4 });
    }
  }

  const gammas = options.gammas ?? [0.6, 1.3].slice(0, layers);
  const betas = options.betas ?? [0.45, 0.75].slice(0, layers);
  const gateLines: string[] = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    `qubit[${qubits}] q;`,
    `bit[${qubits}] c;`,
    ...Array.from({ length: qubits }, (_, q) => `h q[${q}];`),
  ];
  for (let layer = 0; layer < layers; layer += 1) {
    // phase separation: Rz(2γh) on each qubit, Rzz(2γJ) via CNOT/Rz/CNOT
    for (let q = 0; q < qubits; q += 1) gateLines.push(`rz(${(2 * gammas[layer] * h[q]).toFixed(6)}) q[${q}];`);
    for (const coupling of j) {
      if (Math.abs(coupling.weight) < 1e-12) continue;
      gateLines.push(`cx q[${coupling.i}], q[${coupling.j}];`);
      gateLines.push(`rz(${(2 * gammas[layer] * coupling.weight).toFixed(6)}) q[${coupling.j}];`);
      gateLines.push(`cx q[${coupling.i}], q[${coupling.j}];`);
    }
    // mixer exp(-iβ Σ X) = Rx(2β) on every qubit
    for (let q = 0; q < qubits; q += 1) gateLines.push(`rx(${(2 * betas[layer]).toFixed(6)}) q[${q}];`);
  }
  gateLines.push(...Array.from({ length: qubits }, (_, q) => `c[${q}] = measure q[${q}];`));

  return {
    qubits,
    layers,
    gammas,
    betas,
    qasm: gateLines.join("\n"),
    terms: Array.from({ length: layers }, () => h.map((weight, qubit) => ({ qubit, weight }))),
    couplings: j,
    offsets: Array.from({ length: layers }, () => diag[0]),
    truncated,
    loopMapping: selected.map((option, qubit) => {
      const opt = qubo.options[option];
      return { qubit, loop: opt.loop, branch: opt.branch, linearKw: Number(opt.linear.toFixed(3)) };
    }),
  };
}
