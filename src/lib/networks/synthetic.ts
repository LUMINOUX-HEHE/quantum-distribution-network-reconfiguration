import type { NetworkDraft } from "./types";

/**
 * Deterministic synthetic 119-bus feeder used for scalability studies.
 * A 119-bus spanning tree plus six tie branches, so the search space has six
 * independent loops — enough to stress the surrogate and solvers without making
 * exact enumeration feasible.
 */
export function synthetic119(): NetworkDraft {
  let seed = 20260214;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const busCount = 119;
  const buses: NetworkDraft["buses"] = Array.from({ length: busCount }, (_, i) => ({
    name: String(i + 1),
    kind: i === 0 ? "slack" : "pq",
    loadPkw: i === 0 ? 0 : Math.round(6 + rnd() * 26),
    loadQkvar: i === 0 ? 0 : Math.round(3 + rnd() * 12),
  }));
  const lines: NetworkDraft["lines"] = [];
  for (let i = 1; i < busCount; i += 1) {
    // radial backbone with occasional laterals: parent is near the leaf front
    const parent = i <= 3 ? i - 1 : Math.max(0, i - 1 - Math.floor(rnd() * 3));
    lines.push({
      branch: lines.length + 1,
      from: String(parent + 1),
      to: String(i + 1),
      rOhm: Number((0.02 + rnd() * 0.16).toFixed(4)),
      xOhm: Number((0.01 + rnd() * 0.07).toFixed(4)),
      ratingA: 260 + Math.round(rnd() * 180),
      switchType: "sectionalizing",
    });
  }
  const ties: [number, number][] = [
    [20, 105],
    [35, 92],
    [48, 118],
    [60, 101],
    [74, 110],
    [88, 113],
  ];
  for (const [fromIdx, toIdx] of ties) {
    lines.push({
      branch: lines.length + 1,
      from: String(fromIdx),
      to: String(toIdx),
      rOhm: 0.5,
      xOhm: 0.5,
      ratingA: 300,
      switchType: "tie",
      initialOpen: true,
    });
  }
  return {
    name: "Synthetic 119-bus feeder",
    description:
      "Deterministic synthetic 119-bus, 124-branch feeder with six tie switches. Used for scalability and stress testing of the QUBO builder, solvers and repair routine.",
    source: "synthetic",
    baseMva: 10,
    baseKv: 12.66,
    bestKnownLossKw: null,
    bestKnownSource: "not applicable (synthetic)",
    buses,
    lines,
    ders: [
      { bus: "30", kind: "pv", pKw: 320 },
      { bus: "64", kind: "pv", pKw: 420 },
      { bus: "97", kind: "wind", pKw: 260 },
    ],
  };
}
