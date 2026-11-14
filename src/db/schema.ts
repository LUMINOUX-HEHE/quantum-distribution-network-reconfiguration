import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Network topology                                                    */
/* ------------------------------------------------------------------ */

export const networks = pgTable("networks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  source: text("source").notNull().default("custom"), // ieee33 | ieee69 | custom
  baseMva: doublePrecision("base_mva").notNull().default(10),
  baseKv: doublePrecision("base_kv").notNull().default(12.66),
  bestKnownLossKw: doublePrecision("best_known_loss_kw"),
  bestKnownSource: text("best_known_source").notNull().default("literature"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const buses = pgTable(
  "buses",
  {
    id: serial("id").primaryKey(),
    networkId: integer("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("pq"), // slack | pq
    loadPkw: doublePrecision("load_p_kw").notNull().default(0),
    loadQkvar: doublePrecision("load_q_kvar").notNull().default(0),
    x: doublePrecision("x"),
    y: doublePrecision("y"),
  },
  (t) => [index("buses_network_idx").on(t.networkId)],
);

export const lines = pgTable(
  "lines",
  {
    id: serial("id").primaryKey(),
    networkId: integer("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    branch: integer("branch").notNull(),
    fromBus: text("from_bus").notNull(),
    toBus: text("to_bus").notNull(),
    rOhm: doublePrecision("r_ohm").notNull(),
    xOhm: doublePrecision("x_ohm").notNull(),
    ratingA: doublePrecision("rating_a").notNull().default(400),
    isSwitch: boolean("is_switch").notNull().default(false),
    switchType: text("switch_type").notNull().default("fixed"), // fixed | sectionalizing | tie
    initialOpen: boolean("initial_open").notNull().default(false),
  },
  (t) => [index("lines_network_idx").on(t.networkId)],
);

export const ders = pgTable(
  "ders",
  {
    id: serial("id").primaryKey(),
    networkId: integer("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    bus: text("bus").notNull(),
    kind: text("kind").notNull().default("pv"), // pv | wind
    pKw: doublePrecision("p_kw").notNull().default(0),
  },
  (t) => [index("ders_network_idx").on(t.networkId)],
);

/* ------------------------------------------------------------------ */
/* Optimization runs                                                   */
/* ------------------------------------------------------------------ */

export type RunLogEntry = { t: string; stage: string; level: "info" | "warn" | "error"; message: string };

export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    networkId: integer("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    label: text("label").notNull().default(""),
    solver: text("solver").notNull(),
    status: text("status").notNull().default("queued"), // queued | running | completed | failed
    stage: text("stage").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    seed: integer("seed").notNull().default(1),
    solverVersion: text("solver_version").notNull().default("qa-dnr/0.1.0"),
    signature: text("signature").notNull().default(""),
    logs: jsonb("logs").$type<RunLogEntry[]>().notNull().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("runs_network_idx").on(t.networkId), index("runs_status_idx").on(t.status)],
);

export const runCandidates = pgTable(
  "run_candidates",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    origin: text("origin").notNull().default("solver"), // solver | current | refinement | baseline
    openSwitches: jsonb("open_switches").$type<number[]>().notNull(),
    switchStates: jsonb("switch_states").$type<Record<string, boolean>>().notNull(),
    quboEnergy: doublePrecision("qubo_energy"),
    approxLossKw: doublePrecision("approx_loss_kw"),
    isRadial: boolean("is_radial").notNull().default(false),
    repaired: boolean("repaired").notNull().default(false),
    repairActions: jsonb("repair_actions").$type<string[]>().notNull().default([]),
    isFeasible: boolean("is_feasible").notNull().default(false),
    lossKw: doublePrecision("loss_kw"),
    vMin: doublePrecision("v_min"),
    vMax: doublePrecision("v_max"),
    maxLoadingPct: doublePrecision("max_loading_pct"),
    violation: text("violation"),
  },
  (t) => [index("candidates_run_idx").on(t.runId)],
);

export type VoltageProfile = { bus: string; v: number }[];
export type LoadingProfile = { branch: number; from: string; to: string; pct: number }[];
export type SwitchingStep = {
  step: number;
  branch: number;
  action: "open" | "close";
  fromBus: string;
  toBus: string;
  switchType: string;
  reason: string;
};

export const runResults = pgTable("run_results", {
  runId: integer("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  recommendedCandidateId: integer("recommended_candidate_id"),
  initialLossKw: doublePrecision("initial_loss_kw").notNull(),
  finalLossKw: doublePrecision("final_loss_kw").notNull(),
  lossReductionPct: doublePrecision("loss_reduction_pct").notNull(),
  runtimeMs: integer("runtime_ms").notNull().default(0),
  feasibilityRate: doublePrecision("feasibility_rate").notNull().default(0),
  gapToBestKnownPct: doublePrecision("gap_to_best_known_pct"),
  initialVmin: doublePrecision("initial_v_min"),
  finalVmin: doublePrecision("final_v_min"),
  initialMaxLoadingPct: doublePrecision("initial_max_loading_pct"),
  finalMaxLoadingPct: doublePrecision("final_max_loading_pct"),
  initialVoltageProfile: jsonb("initial_voltage_profile").$type<VoltageProfile>(),
  finalVoltageProfile: jsonb("final_voltage_profile").$type<VoltageProfile>(),
  initialLoadingProfile: jsonb("initial_loading_profile").$type<LoadingProfile>(),
  finalLoadingProfile: jsonb("final_loading_profile").$type<LoadingProfile>(),
  switchingPlan: jsonb("switching_plan").$type<SwitchingStep[]>().notNull().default([]),
  loopSummary: jsonb("loop_summary").$type<Record<string, unknown>>().notNull().default({}),
  quboSummary: jsonb("qubo_summary").$type<Record<string, unknown>>().notNull().default({}),
  solverSummary: jsonb("solver_summary").$type<Record<string, unknown>>().notNull().default({}),
  baselineSummary: jsonb("baseline_summary").$type<Record<string, unknown>>().notNull().default({}),
});

/* ------------------------------------------------------------------ */
/* Benchmarks + settings                                               */
/* ------------------------------------------------------------------ */

export const benchmarks = pgTable("benchmarks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("running"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const benchmarkRuns = pgTable(
  "benchmark_runs",
  {
    id: serial("id").primaryKey(),
    benchmarkId: integer("benchmark_id")
      .notNull()
      .references(() => benchmarks.id, { onDelete: "cascade" }),
    networkId: integer("network_id").notNull(),
    networkName: text("network_name").notNull(),
    solver: text("solver").notNull(),
    runId: integer("run_id"),
    status: text("status").notNull().default("completed"),
    lossKw: doublePrecision("loss_kw"),
    lossReductionPct: doublePrecision("loss_reduction_pct"),
    gapPct: doublePrecision("gap_pct"),
    runtimeMs: integer("runtime_ms"),
    feasibilityRate: doublePrecision("feasibility_rate"),
    voltageMin: doublePrecision("voltage_min"),
    busCount: integer("bus_count"),
    note: text("note").notNull().default(""),
  },
  (t) => [index("benchmark_runs_benchmark_idx").on(t.benchmarkId)],
);

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  defaults: jsonb("defaults").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Security, scenarios, resilience, observability                      */
/* ------------------------------------------------------------------ */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull(),
    role: text("role").notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull().default(""),
    outcome: text("outcome").notNull().default("success"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export type ScenarioConfig = {
  hour: number;
  season: "winter" | "spring" | "summer" | "autumn";
  cloudCover: number;
  windSpeed: number;
  loadMultiplier: number;
  variability: number;
  horizonHours: number;
  weather: "clear" | "cloudy" | "overcast" | "storm";
};

export const scenarios = pgTable(
  "scenarios",
  {
    id: serial("id").primaryKey(),
    networkId: integer("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().default("renewable"), // renewable | load | combined
    config: jsonb("config").$type<ScenarioConfig>().notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scenarios_network_idx").on(t.networkId)],
);

export const faultStudies = pgTable(
  "fault_studies",
  {
    id: serial("id").primaryKey(),
    networkId: integer("network_id")
      .notNull()
      .references(() => networks.id, { onDelete: "cascade" }),
    label: text("label").notNull().default(""),
    kind: text("kind").notNull().default("contingency"), // contingency | n1-scan
    status: text("status").notNull().default("completed"),
    contingencies: jsonb("contingencies").$type<Record<string, unknown>[]>().notNull().default([]),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fault_network_idx").on(t.networkId)],
);

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull().default("viewer"),
  tokenHash: text("token_hash").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
