import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { faultStudies, scenarios, type ScenarioConfig } from "@/db/schema";
import { buildModel } from "@/lib/power/model";
import { analyseContingency, n1Scan, type FaultSpec, type FaultStudySummary } from "@/lib/power/faults";
import { defaultScenarioConfig, evaluateScenario, normaliseScenarioConfig } from "@/lib/power/profiles";
import { loadNetworkRows } from "./data";

export type Limits = { voltageMin: number; voltageMax: number; maxLoadingPct: number };
const DEFAULT_LIMITS: Limits = { voltageMin: 0.9, voltageMax: 1.05, maxLoadingPct: 100 };

export async function runFaultStudy(input: {
  networkId: number;
  label?: string;
  faults: FaultSpec[];
  criticalBuses?: string[];
  limits?: Partial<Limits>;
  persist?: boolean;
  actor?: string;
}): Promise<{ summary: FaultStudySummary; studyId: number | null }> {
  const rows = await loadNetworkRows(input.networkId);
  if (!rows) throw new Error("Network not found");
  const model = buildModel(rows, 0);
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const critical = (input.criticalBuses ?? []).filter((b) => model.buses.some((bus) => bus.name === b));
  const useN1 = input.faults.length === 0;
  const summary = useN1
    ? n1Scan(model, limits, critical)
    : {
        faults: input.faults.map((f) => analyseContingency(model, f, limits, critical)),
        totals: {
          studied: input.faults.length,
          unrestorable: 0,
          averageRestoredPct: 0,
          worstCase: null,
          criticalLoadAtRiskKw: 0,
        },
      };
  if (!useN1) {
    const studied = summary.faults.length;
    const restorable = summary.faults.filter((f) => f.restoration.attempted);
    summary.totals = {
      studied,
      unrestorable: summary.faults.filter((f) => f.deEnergizedCount > 0).length,
      averageRestoredPct:
        restorable.length > 0
          ? Number((restorable.reduce((a, f) => a + f.restoration.restoredPct, 0) / restorable.length).toFixed(1))
          : 100,
      worstCase: summary.faults.reduce<typeof summary.faults[number] | null>(
        (acc, f) => (!acc || f.loadShedKw > acc.loadShedKw ? f : acc),
        null,
      ),
      criticalLoadAtRiskKw: Number(summary.faults.reduce((a, f) => a + f.criticalLoadShedKw, 0).toFixed(2)),
    };
  }

  let studyId: number | null = null;
  if (input.persist !== false) {
    const [inserted] = await db
      .insert(faultStudies)
      .values({
        networkId: input.networkId,
        label: input.label?.slice(0, 120) || (useN1 ? "N-1 contingency scan" : "Contingency study"),
        kind: useN1 ? "n1-scan" : "contingency",
        status: "completed",
        contingencies: summary.faults.slice(0, 40).map((f) => ({ ...f })),
        summary: { totals: summary.totals, criticalBuses: critical, limits },
        createdBy: input.actor ?? "system",
      })
      .returning({ id: faultStudies.id });
    studyId = inserted?.id ?? null;
  }
  return { summary, studyId };
}

export async function listFaultStudies(limit = 20) {
  return db.select().from(faultStudies).orderBy(desc(faultStudies.id)).limit(limit);
}

export async function createScenario(input: {
  networkId: number;
  name: string;
  description?: string;
  kind?: string;
  config: unknown;
  actor?: string;
}) {
  const config = normaliseScenarioConfig(input.config);
  const [row] = await db
    .insert(scenarios)
    .values({
      networkId: input.networkId,
      name: input.name.slice(0, 120),
      description: input.description?.slice(0, 400) ?? "",
      kind: input.kind === "load" || input.kind === "combined" ? input.kind : "renewable",
      config,
      createdBy: input.actor ?? "system",
    })
    .returning();
  return row;
}

export async function listScenarios(networkId?: number) {
  const query = db.select().from(scenarios).orderBy(desc(scenarios.id)).limit(30);
  if (networkId) return query.where(eq(scenarios.networkId, networkId));
  return query;
}

export async function getScenario(id: number) {
  const [row] = await db.select().from(scenarios).where(eq(scenarios.id, id)).limit(1);
  return row ?? null;
}

export async function evaluateScenarioForNetwork(input: {
  networkId: number;
  config?: unknown;
  scenarioId?: number;
  configs?: { label: string; openSet: number[] }[];
  limits?: Partial<Limits>;
}) {
  const rows = await loadNetworkRows(input.networkId);
  if (!rows) throw new Error("Network not found");
  let config: ScenarioConfig = defaultScenarioConfig();
  if (input.scenarioId) {
    const stored = await getScenario(input.scenarioId);
    if (stored) config = stored.config;
  }
  if (input.config) config = normaliseScenarioConfig(input.config);
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const model = buildModel(rows, 100);
  const openFromBranch = (branches: number[]) =>
    model.lines.filter((l) => branches.includes(l.branch)).map((l) => l.index);
  const defaultConfig = {
    label: "Current configuration",
    openSet: model.lines.filter((l) => l.initialOpen).map((l) => l.index),
  };
  const configs = (input.configs ?? [defaultConfig]).map((c) => ({
    label: c.label,
    openSet: c.openSet.length > 0 && c.openSet.every((i) => i < model.lines.length) ? c.openSet : openFromBranch(c.openSet),
  }));
  const results = configs.map((c) => ({ label: c.label, openSet: c.openSet, ...evaluateScenario(rows, c.openSet, config, limits) }));
  return { config, limits, results };
}

/** Most recent validated recommendation for a network, used by scenario comparison. */
export async function latestRecommendation(networkId: number) {
  const { runs, runCandidates, runResults } = await import("@/db/schema");
  const [row] = await db
    .select({
      runId: runs.id,
      lossKw: runResults.finalLossKw,
      openSwitches: runCandidates.openSwitches,
    })
    .from(runs)
    .innerJoin(runResults, eq(runResults.runId, runs.id))
    .innerJoin(runCandidates, eq(runCandidates.id, runResults.recommendedCandidateId))
    .where(eq(runs.networkId, networkId))
    .orderBy(desc(runs.id))
    .limit(1);
  return row ?? null;
}
