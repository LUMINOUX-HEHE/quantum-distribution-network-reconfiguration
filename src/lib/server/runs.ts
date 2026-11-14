import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { networks, runCandidates, runResults, runs, type RunLogEntry } from "@/db/schema";
import type { RunParams, SolverId } from "@/lib/networks/types";
import { normaliseRunParams } from "@/lib/networks/types";
import { runPipeline } from "@/lib/optimization/pipeline";
import { loadNetworkRows } from "./data";

const globalQueue = globalThis as typeof globalThis & { __qaDnrActiveRuns?: Set<number> };
const activeRuns: Set<number> = (globalQueue.__qaDnrActiveRuns ??= new Set());

export async function createRun(input: {
  networkId: number;
  solver: SolverId | string;
  params: RunParams;
  seed: number;
  label?: string;
  signature?: string;
}) {
  const [run] = await db
    .insert(runs)
    .values({
      networkId: input.networkId,
      solver: input.solver,
      status: "queued",
      stage: "queued",
      params: input.params as unknown as Record<string, unknown>,
      seed: input.seed,
      label: input.label ?? "",
      signature: input.signature ?? "",
      logs: [
        {
          t: new Date().toISOString(),
          stage: "queued",
          level: "info",
          message: "Run submitted. Waiting for an optimisation worker.",
        },
      ],
    })
    .returning();
  return run;
}

export function enqueueRun(runId: number) {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  setTimeout(() => {
    void processRun(runId)
      .catch(async (error) => {
        await db
          .update(runs)
          .set({
            status: "failed",
            stage: "failed",
            error: error instanceof Error ? error.message : String(error),
            finishedAt: new Date(),
          })
          .where(eq(runs.id, runId));
      })
      .finally(() => {
        activeRuns.delete(runId);
      });
  }, 25);
}

export async function processRun(runId: number) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status === "completed") return;

  const logs: RunLogEntry[] = Array.isArray(run.logs) ? [...run.logs] : [];
  const params = normaliseRunParams(run.params);
  const solver = run.solver as SolverId;

  await db
    .update(runs)
    .set({ status: "running", stage: "loading", startedAt: new Date(), progress: 2 })
    .where(eq(runs.id, runId));

  const report = async (update: {
    stage: string;
    progress: number;
    message: string;
    level?: "info" | "warn" | "error";
  }) => {
    logs.push({
      t: new Date().toISOString(),
      stage: update.stage,
      level: update.level ?? "info",
      message: update.message,
    });
    if (logs.length > 120) logs.splice(0, logs.length - 120);
    await db
      .update(runs)
      .set({
        stage: update.stage,
        progress: Math.round(update.progress),
        logs,
      })
      .where(eq(runs.id, runId));
  };

  try {
    const rows = await loadNetworkRows(run.networkId);
    if (!rows) throw new Error("Network not found for this run");

    const result = await runPipeline({
      rows,
      solver,
      params,
      seed: run.seed,
      onProgress: report,
    });

    const stored = result.candidates
      .slice()
      .sort((a, b) => {
        const lossA = a.lossKw ?? Number.POSITIVE_INFINITY;
        const lossB = b.lossKw ?? Number.POSITIVE_INFINITY;
        if (a.origin === "current") return 1;
        if (b.origin === "current") return -1;
        return lossA - lossB;
      })
      .slice(0, 30);

    const recIndex = stored.findIndex(
      (c) => c.openSet.join(",") === result.recommended.openSet.join(","),
    );
    let recommendedCandidateId: number | null = null;

    for (let i = 0; i < stored.length; i += 1) {
      const candidate = stored[i];
      const [inserted] = await db
        .insert(runCandidates)
        .values({
          runId,
          rank: i + 1,
          origin: candidate.origin,
          openSwitches: candidate.openSet,
          switchStates: candidate.switchStates,
          quboEnergy: candidate.quboEnergy,
          approxLossKw: candidate.approxLossKw,
          isRadial: candidate.isRadial,
          repaired: candidate.repaired,
          repairActions: candidate.repairActions,
          isFeasible: candidate.isFeasible,
          lossKw: candidate.lossKw,
          vMin: candidate.vMin,
          vMax: candidate.vMax,
          maxLoadingPct: candidate.maxLoadingPct,
          violation: candidate.violation,
        })
        .returning({ id: runCandidates.id });
      if (i === recIndex) recommendedCandidateId = inserted.id;
    }

    const recStates = result.recommended.switchStates;
    const initStates = result.candidates.find((c) => c.origin === "current")?.switchStates ?? {};
    const recVoltage = result.recommended.voltageProfile;
    const recLoading = result.recommended.loadingProfile;

    await db
      .insert(runResults)
      .values({
        runId,
        recommendedCandidateId,
        initialLossKw: result.initial.lossKw ?? 0,
        finalLossKw: result.recommendedLoss,
        lossReductionPct: result.lossReductionPct,
        runtimeMs: result.runtimeMs,
        feasibilityRate: result.feasibilityRate,
        gapToBestKnownPct: result.gapToBestKnownPct,
        initialVmin: result.initial.vMin,
        finalVmin: result.recommended.vMin,
        initialMaxLoadingPct: result.initial.maxLoadingPct,
        finalMaxLoadingPct: result.recommended.maxLoadingPct,
        initialVoltageProfile: result.initial.voltageProfile,
        finalVoltageProfile: recVoltage,
        initialLoadingProfile: result.initial.loadingProfile,
        finalLoadingProfile: recLoading,
        switchingPlan: result.switchingPlan,
        loopSummary: result.loopSummary,
        quboSummary: result.quboSummary,
        solverSummary: result.solverSummary,
        baselineSummary: result.baselineSummary,
      })
      .onConflictDoUpdate({
        target: runResults.runId,
        set: {
          finalLossKw: result.recommendedLoss,
          lossReductionPct: result.lossReductionPct,
          runtimeMs: result.runtimeMs,
          feasibilityRate: result.feasibilityRate,
          gapToBestKnownPct: result.gapToBestKnownPct,
        },
      });

    // Record a new platform best if we beat the stored reference.
    if (
      result.recommended.isFeasible &&
      result.recommendedLoss > 0 &&
      (rows.bestKnownLossKw === null || result.recommendedLoss < rows.bestKnownLossKw)
    ) {
      await db
        .update(networks)
        .set({ bestKnownLossKw: result.recommendedLoss, bestKnownSource: "platform record" })
        .where(eq(networks.id, run.networkId));
      await report({
        stage: "complete",
        progress: 100,
        message: `New platform best for this feeder: ${result.recommendedLoss.toFixed(2)} kW`,
      });
    }

    void recStates;
    void initStates;
    void sql;

    await db
      .update(runs)
      .set({
        status: "completed",
        stage: "complete",
        progress: 100,
        finishedAt: new Date(),
        logs: [
          ...logs,
          ...result.notes.map<RunLogEntry>((message) => ({
            t: new Date().toISOString(),
            stage: "notes",
            level: "info",
            message,
          })),
        ],
      })
      .where(eq(runs.id, runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.push({ t: new Date().toISOString(), stage: "failed", level: "error", message });
    await db
      .update(runs)
      .set({
        status: "failed",
        stage: "failed",
        error: message,
        finishedAt: new Date(),
        logs,
      })
      .where(eq(runs.id, runId));
  }
}

export async function listRuns(limit = 40) {
  const rows = await db
    .select({
      id: runs.id,
      networkId: runs.networkId,
      networkName: networks.name,
      solver: runs.solver,
      status: runs.status,
      stage: runs.stage,
      progress: runs.progress,
      seed: runs.seed,
      params: runs.params,
      createdAt: runs.createdAt,
      finishedAt: runs.finishedAt,
      runtimeMs: runResults.runtimeMs,
      initialLossKw: runResults.initialLossKw,
      finalLossKw: runResults.finalLossKw,
      lossReductionPct: runResults.lossReductionPct,
      feasibilityRate: runResults.feasibilityRate,
      gapToBestKnownPct: runResults.gapToBestKnownPct,
    })
    .from(runs)
    .innerJoin(networks, eq(networks.id, runs.networkId))
    .leftJoin(runResults, eq(runResults.runId, runs.id))
    .orderBy(desc(runs.id))
    .limit(limit);
  return rows;
}

export async function getRunDetail(id: number) {
  const [run] = await db
    .select({
      run: runs,
      networkName: networks.name,
      networkSource: networks.source,
      bestKnownLossKw: networks.bestKnownLossKw,
      bestKnownSource: networks.bestKnownSource,
    })
    .from(runs)
    .innerJoin(networks, eq(networks.id, runs.networkId))
    .where(eq(runs.id, id))
    .limit(1);
  if (!run) return null;
  const candidates = await db
    .select()
    .from(runCandidates)
    .where(eq(runCandidates.runId, id))
    .orderBy(runCandidates.rank);
  const [result] = await db.select().from(runResults).where(eq(runResults.runId, id)).limit(1);
  return { ...run, candidates, result: result ?? null };
}

export async function runCounts() {
  const [row] = await db
    .select({
      total: sql<number>`cast(count(*) as int)`,
      completed: sql<number>`cast(count(*) filter (where ${runs.status} = 'completed') as int)`,
      running: sql<number>`cast(count(*) filter (where ${runs.status} in ('queued','running')) as int)`,
      failed: sql<number>`cast(count(*) filter (where ${runs.status} = 'failed') as int)`,
    })
    .from(runs);
  return row;
}

export async function recentCompletedRuns(limit = 6) {
  return db
    .select({
      id: runs.id,
      networkName: networks.name,
      solver: runs.solver,
      finalLossKw: runResults.finalLossKw,
      initialLossKw: runResults.initialLossKw,
      lossReductionPct: runResults.lossReductionPct,
      gapToBestKnownPct: runResults.gapToBestKnownPct,
      runtimeMs: runResults.runtimeMs,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .innerJoin(networks, eq(networks.id, runs.networkId))
    .innerJoin(runResults, eq(runResults.runId, runs.id))
    .where(and(eq(runs.status, "completed")))
    .orderBy(desc(runs.id))
    .limit(limit);
}
