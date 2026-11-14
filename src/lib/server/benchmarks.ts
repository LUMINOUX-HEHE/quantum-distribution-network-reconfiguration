import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { benchmarkRuns, benchmarks, networks } from "@/db/schema";
import {
  BASELINES,
  DEFAULT_RUN_PARAMS,
  isSolverId,
  type RunParams,
  type SolverId,
} from "@/lib/networks/types";
import { branchExchange, bruteForceBaseline, type Limits } from "@/lib/optimization/baselines";
import { findLoops } from "@/lib/power/topology";
import { buildModel, initialOpenSet } from "@/lib/power/model";
import { evaluateConfiguration } from "@/lib/optimization/baselines";
import { createRun, processRun } from "./runs";
import { ensureSeeded, loadNetworkRows } from "./data";

export const BENCHMARK_SOLVERS: SolverId[] = [
  "simulated-annealing",
  "quantum-inspired",
  "genetic-algorithm",
  "qaoa-simulator",
];

export async function runBenchmarkSuite(input: {
  name?: string;
  networkIds?: number[];
  solvers?: string[];
  includeBaselines?: boolean;
}) {
  await ensureSeeded();
  const allNetworks = await db.select().from(networks).orderBy(networks.id);
  let selected = allNetworks;
  if (input.networkIds && input.networkIds.length > 0) {
    selected = allNetworks.filter((n) => input.networkIds?.includes(n.id));
  }
  const solvers = (input.solvers && input.solvers.length > 0 ? input.solvers : BENCHMARK_SOLVERS).filter(
    (s): s is SolverId => isSolverId(s) && s !== "dwave-hybrid",
  );
  const includeBaselines = input.includeBaselines !== false;

  const [benchmark] = await db
    .insert(benchmarks)
    .values({
      name: input.name?.trim() || `Benchmark ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      status: "running",
      config: {
        networks: selected.map((n) => ({ id: n.id, name: n.name })),
        solvers,
        includeBaselines,
      },
    })
    .returning();

  const rows: (typeof benchmarkRuns.$inferInsert)[] = [];
  const params: RunParams = {
    ...DEFAULT_RUN_PARAMS,
    iterations: 4000,
    restarts: 2,
    topK: 8,
    refinementIterations: 4,
    baselineBranchExchange: false,
    baselineBruteForce: false,
  };
  const limits: Limits = {
    voltageMin: params.voltageMin,
    voltageMax: params.voltageMax,
    maxLoadingPct: params.maxLoadingPct,
  };

  for (const network of selected) {
    const networkRows = await loadNetworkRows(network.id);
    if (!networkRows) continue;
    const model = buildModel(networkRows, 0);
    const loops = findLoops(model).loops;
    const initial = evaluateConfiguration(model, initialOpenSet(model), limits);
    const initialLoss = initial.lossKw ?? 0;

    for (const solver of solvers) {
      const started = Date.now();
      const run = await createRun({
        networkId: network.id,
        solver,
        params,
        seed: 20260214,
        label: `Benchmark: ${benchmark.name}`,
      });
      await processRun(run.id);
      const { getRunDetail } = await import("./runs");
      const detail = await getRunDetail(run.id);
      const result = detail?.result;
      let note = "";
      if (detail?.run.status === "failed") note = detail.run.error ?? "run failed";
      rows.push({
        benchmarkId: benchmark.id,
        networkId: network.id,
        networkName: network.name,
        solver,
        runId: run.id,
        status: detail?.run.status ?? "failed",
        lossKw: result?.finalLossKw ?? null,
        lossReductionPct: result?.lossReductionPct ?? null,
        gapPct: result?.gapToBestKnownPct ?? null,
        runtimeMs: result?.runtimeMs ?? Date.now() - started,
        feasibilityRate: result?.feasibilityRate ?? null,
        voltageMin: result?.finalVmin ?? null,
        busCount: model.buses.length,
        note,
      });
    }

    if (includeBaselines) {
      const branch = branchExchange(model, loops, initialOpenSet(model), limits, 10);
      rows.push({
        benchmarkId: benchmark.id,
        networkId: network.id,
        networkName: network.name,
        solver: "baseline:branch-exchange",
        runId: null,
        status: "completed",
        lossKw: branch.outcome.bestFeasible?.lossKw ?? null,
        lossReductionPct:
          branch.outcome.bestFeasible?.lossKw != null && initialLoss > 0
            ? ((initialLoss - branch.outcome.bestFeasible.lossKw) / initialLoss) * 100
            : null,
        gapPct:
          branch.outcome.bestFeasible?.lossKw != null && network.bestKnownLossKw
            ? Math.max(
                0,
                ((branch.outcome.bestFeasible.lossKw - network.bestKnownLossKw) /
                  network.bestKnownLossKw) *
                  100,
              )
            : null,
        runtimeMs: branch.outcome.runtimeMs,
        feasibilityRate: 1,
        voltageMin: branch.outcome.bestFeasible?.vMin ?? null,
        busCount: model.buses.length,
        note: branch.outcome.note,
      });
      const brute = bruteForceBaseline(model, loops, limits, {
        maxCombos: 160000,
        timeBudgetMs: 4000,
        shortlist: 800,
      });
      rows.push({
        benchmarkId: benchmark.id,
        networkId: network.id,
        networkName: network.name,
        solver: "baseline:brute-force",
        runId: null,
        status: "completed",
        lossKw: brute.bestFeasible?.lossKw ?? brute.best?.lossKw ?? null,
        lossReductionPct:
          brute.bestFeasible?.lossKw != null && initialLoss > 0
            ? ((initialLoss - brute.bestFeasible.lossKw) / initialLoss) * 100
            : null,
        gapPct:
          brute.bestFeasible?.lossKw != null && network.bestKnownLossKw
            ? Math.max(
                0,
                ((brute.bestFeasible.lossKw - network.bestKnownLossKw) / network.bestKnownLossKw) * 100,
              )
            : null,
        runtimeMs: brute.runtimeMs,
        feasibilityRate: 1,
        voltageMin: brute.bestFeasible?.vMin ?? null,
        busCount: model.buses.length,
        note: brute.note,
      });
    }
  }

  if (rows.length > 0) await db.insert(benchmarkRuns).values(rows);

  const bestByNetwork = new Map<string, { solver: string; lossKw: number }>();
  for (const row of rows) {
    if (row.lossKw == null) continue;
    const current = bestByNetwork.get(row.networkName);
    if (!current || row.lossKw < current.lossKw) {
      bestByNetwork.set(row.networkName, { solver: row.solver, lossKw: row.lossKw });
    }
  }
  const summary = {
    entries: rows.length,
    perNetwork: [...bestByNetwork.entries()].map(([networkName, best]) => ({
      networkName,
      bestSolver: best.solver,
      bestLossKw: best.lossKw,
    })),
    baselineLabels: BASELINES.map((b) => b.id),
    generatedAt: new Date().toISOString(),
  };

  await db
    .update(benchmarks)
    .set({ status: "completed", summary, finishedAt: new Date() })
    .where(eq(benchmarks.id, benchmark.id));

  return { benchmarkId: benchmark.id, entries: rows.length, summary };
}

export async function listBenchmarks(limit = 20) {
  await ensureSeeded();
  const list = await db.select().from(benchmarks).orderBy(desc(benchmarks.id)).limit(limit);
  return list;
}

export async function getBenchmark(id: number) {
  const [benchmark] = await db.select().from(benchmarks).where(eq(benchmarks.id, id)).limit(1);
  if (!benchmark) return null;
  const entries = await db
    .select()
    .from(benchmarkRuns)
    .where(eq(benchmarkRuns.benchmarkId, id))
    .orderBy(benchmarkRuns.networkId, benchmarkRuns.id);
  return { benchmark, entries };
}
