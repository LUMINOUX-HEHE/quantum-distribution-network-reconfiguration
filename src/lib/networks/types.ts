export type BusKind = "slack" | "pq";
export type SwitchType = "fixed" | "sectionalizing" | "tie";

export type BusInput = {
  name: string;
  loadPkw: number;
  loadQkvar: number;
  kind?: BusKind;
};

export type LineInput = {
  branch: number;
  from: string;
  to: string;
  rOhm: number;
  xOhm: number;
  ratingA: number;
  switchType: SwitchType;
  initialOpen?: boolean;
};

export type DerInput = {
  bus: string;
  kind: "pv" | "wind";
  pKw: number;
};

export type NetworkDraft = {
  name: string;
  description: string;
  source: "ieee33" | "ieee69" | "custom" | "synthetic";
  baseMva: number;
  baseKv: number;
  bestKnownLossKw?: number | null;
  bestKnownSource?: string;
  buses: BusInput[];
  lines: LineInput[];
  ders: DerInput[];
};

export type StoredNetwork = {
  id: number;
  name: string;
  description: string;
  source: string;
  baseMva: number;
  baseKv: number;
  bestKnownLossKw: number | null;
  bestKnownSource: string;
};

/* ------------------------------------------------------------------ */
/* Solver + run parameter contracts (shared by server and client)      */
/* ------------------------------------------------------------------ */

export const SOLVERS = [
  {
    id: "simulated-annealing",
    name: "Simulated annealing",
    kind: "local",
    description: "Geometric cooling over the loop one-hot encoding. Default local solver.",
    requiresToken: false,
  },
  {
    id: "quantum-inspired",
    name: "Quantum-inspired annealer",
    kind: "quantum-inspired",
    description: "Parallel tempering replicas with elite pooling — treats larger QUBOs than a simulator.",
    requiresToken: false,
  },
  {
    id: "genetic-algorithm",
    name: "Genetic algorithm",
    kind: "classical-metaheuristic",
    description: "Population-based crossover/mutation over the loop encoding with elitism and AC-scored finalists.",
    requiresToken: false,
  },
  {
    id: "qaoa-simulator",
    name: "QAOA simulator",
    kind: "gate-model",
    description: "Statevector QAOA (p=2) on a truncated sub-QUBO. Small cases only.",
    requiresToken: false,
  },
  {
    id: "dwave-hybrid",
    name: "D-Wave Leap hybrid",
    kind: "quantum-cloud",
    description: "Cloud BQM sampler. Needs a server-side DWAVE_API_TOKEN.",
    requiresToken: true,
  },
] as const;

export type SolverId = (typeof SOLVERS)[number]["id"];

export const BASELINES = [
  {
    id: "milp",
    name: "MILP-style assignment",
    description: "LP relaxation of the linearised loop assignment plus bounded branch-and-bound over the cheapest options.",
  },
  {
    id: "brute-force",
    name: "Brute force",
    description: "Enumerates every one-open-switch-per-loop combination (capped).",
  },
  {
    id: "branch-exchange",
    name: "Branch exchange",
    description: "Classical single-exchange local search scored by true AC power flow.",
  },
] as const;

export type BaselineId = (typeof BASELINES)[number]["id"];

export type RunParams = {
  topK: number;
  iterations: number;
  restarts: number;
  penaltyWeight: number | null; // null = auto-tune
  refinementIterations: number;
  derPenetrationPct: number;
  voltageMin: number;
  voltageMax: number;
  maxLoadingPct: number;
  baselineBruteForce: boolean;
  baselineBranchExchange: boolean;
  maxSwitchingOps: number | null;
  baselineMilp: boolean;
  timeoutMs: number;
};

export const DEFAULT_RUN_PARAMS: RunParams = {
  topK: 12,
  iterations: 6000,
  restarts: 3,
  penaltyWeight: null,
  refinementIterations: 6,
  derPenetrationPct: 0,
  voltageMin: 0.9,
  voltageMax: 1.05,
  maxLoadingPct: 100,
  baselineBruteForce: false,
  baselineBranchExchange: true,
  maxSwitchingOps: null,
  baselineMilp: false,
  timeoutMs: 25000,
};

export const DEFAULT_SETTINGS: RunParams & { solver: SolverId } = {
  ...DEFAULT_RUN_PARAMS,
  solver: "simulated-annealing",
};

export function normaliseRunParams(input: unknown): RunParams {
  const raw = (input ?? {}) as Record<string, unknown>;
  const num = (key: keyof RunParams, fallback: number, min: number, max: number) => {
    const v = raw[key as string];
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const penalty = raw.penaltyWeight;
  const penaltyNum = typeof penalty === "number" ? penalty : penalty === null || penalty === undefined ? null : Number(penalty);
  const maxOps = raw.maxSwitchingOps;
  const maxOpsNum =
    typeof maxOps === "number" && Number.isFinite(maxOps) ? Math.max(0, Math.round(maxOps)) : null;
  return {
    topK: Math.round(num("topK", DEFAULT_RUN_PARAMS.topK, 1, 60)),
    iterations: Math.round(num("iterations", DEFAULT_RUN_PARAMS.iterations, 200, 120000)),
    restarts: Math.round(num("restarts", DEFAULT_RUN_PARAMS.restarts, 1, 10)),
    penaltyWeight:
      penaltyNum !== null && Number.isFinite(penaltyNum) && penaltyNum > 0 ? Math.min(1e6, penaltyNum) : null,
    refinementIterations: Math.round(
      num("refinementIterations", DEFAULT_RUN_PARAMS.refinementIterations, 0, 20),
    ),
    derPenetrationPct: num("derPenetrationPct", DEFAULT_RUN_PARAMS.derPenetrationPct, 0, 200),
    voltageMin: num("voltageMin", DEFAULT_RUN_PARAMS.voltageMin, 0.8, 1),
    voltageMax: num("voltageMax", DEFAULT_RUN_PARAMS.voltageMax, 1, 1.2),
    maxLoadingPct: num("maxLoadingPct", DEFAULT_RUN_PARAMS.maxLoadingPct, 10, 150),
    baselineBruteForce: raw.baselineBruteForce === true,
    baselineBranchExchange: raw.baselineBranchExchange !== false,
    maxSwitchingOps: maxOpsNum,
    baselineMilp: raw.baselineMilp === true,
    timeoutMs: Math.round(num("timeoutMs", DEFAULT_RUN_PARAMS.timeoutMs, 2000, 120000)),
  };
}

export function isSolverId(value: unknown): value is SolverId {
  return SOLVERS.some((s) => s.id === value);
}
