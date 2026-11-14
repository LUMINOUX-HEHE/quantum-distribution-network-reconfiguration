import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { buses, ders, lines, networks, settings } from "@/db/schema";
import { IEEE33 } from "@/lib/networks/ieee33";
import { IEEE69 } from "@/lib/networks/ieee69";
import { synthetic119 } from "@/lib/networks/synthetic";
import type { NetworkDraft } from "@/lib/networks/types";
import { DEFAULT_SETTINGS, normaliseRunParams, type SolverId } from "@/lib/networks/types";
import type { NetworkRows } from "@/lib/power/model";

type SeedState = { promise: Promise<void> | null };
const globalSeed = globalThis as typeof globalThis & { __qaDnrSeed?: SeedState };
const seedState: SeedState = (globalSeed.__qaDnrSeed ??= { promise: null });

async function insertDraft(draft: NetworkDraft) {
  const [network] = await db
    .insert(networks)
    .values({
      name: draft.name,
      description: draft.description,
      source: draft.source,
      baseMva: draft.baseMva,
      baseKv: draft.baseKv,
      bestKnownLossKw: draft.bestKnownLossKw ?? null,
      bestKnownSource: draft.bestKnownSource ?? "literature",
    })
    .returning();

  await db.insert(buses).values(
    draft.buses.map((b) => ({
      networkId: network.id,
      name: b.name,
      kind: b.kind ?? "pq",
      loadPkw: b.loadPkw,
      loadQkvar: b.loadQkvar,
    })),
  );
  await db.insert(lines).values(
    draft.lines.map((l) => ({
      networkId: network.id,
      branch: l.branch,
      fromBus: l.from,
      toBus: l.to,
      rOhm: l.rOhm,
      xOhm: l.xOhm,
      ratingA: l.ratingA,
      isSwitch: l.switchType !== "fixed",
      switchType: l.switchType,
      initialOpen: l.initialOpen ?? false,
    })),
  );
  if (draft.ders.length > 0) {
    await db.insert(ders).values(
      draft.ders.map((d) => ({
        networkId: network.id,
        bus: d.bus,
        kind: d.kind,
        pKw: d.pKw,
      })),
    );
  }
  return network;
}

export async function ensureSeeded(): Promise<void> {
  if (!seedState.promise) {
    seedState.promise = (async () => {
      const [{ count }] = await db
        .select({ count: sql<number>`cast(count(*) as int)` })
        .from(networks);
      if (count === 0) {
        await insertDraft(IEEE33);
        await insertDraft(IEEE69);
        await insertDraft(synthetic119());
      }
      const settingRows = await db.select().from(settings).limit(1);
      if (settingRows.length === 0) {
        await db.insert(settings).values({ id: 1, defaults: DEFAULT_SETTINGS }).onConflictDoNothing();
      }
    })().catch((error) => {
      seedState.promise = null;
      throw error;
    });
  }
  return seedState.promise;
}

export async function importNetwork(draft: NetworkDraft) {
  return insertDraft(draft);
}

export async function listNetworks() {
  await ensureSeeded();
  const rows = await db.select().from(networks).orderBy(asc(networks.id));
  const busCounts = await db
    .select({ networkId: buses.networkId, count: sql<number>`cast(count(*) as int)` })
    .from(buses)
    .groupBy(buses.networkId);
  const lineStats = await db
    .select({
      networkId: lines.networkId,
      lineCount: sql<number>`cast(count(*) as int)`,
      switchCount: sql<number>`cast(count(*) filter (where ${lines.isSwitch} = true) as int)`,
      tieCount: sql<number>`cast(count(*) filter (where ${lines.switchType} = 'tie') as int)`,
    })
    .from(lines)
    .groupBy(lines.networkId);
  const busMap = new Map(busCounts.map((b) => [b.networkId, b.count]));
  const lineMap = new Map(lineStats.map((l) => [l.networkId, l]));
  return rows.map((network) => {
    const stats = lineMap.get(network.id);
    return {
      id: network.id,
      name: network.name,
      description: network.description,
      source: network.source,
      baseMva: network.baseMva,
      baseKv: network.baseKv,
      bestKnownLossKw: network.bestKnownLossKw,
      bestKnownSource: network.bestKnownSource,
      createdAt: network.createdAt,
      busCount: busMap.get(network.id) ?? 0,
      lineCount: stats?.lineCount ?? 0,
      switchCount: stats?.switchCount ?? 0,
      tieCount: stats?.tieCount ?? 0,
    };
  });
}

export async function loadNetworkRows(networkId: number): Promise<NetworkRows | null> {
  await ensureSeeded();
  const [network] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
  if (!network) return null;
  const busRows = await db
    .select()
    .from(buses)
    .where(eq(buses.networkId, networkId))
    .orderBy(asc(buses.id));
  const lineRows = await db
    .select()
    .from(lines)
    .where(eq(lines.networkId, networkId))
    .orderBy(asc(lines.branch));
  const derRows = await db.select().from(ders).where(eq(ders.networkId, networkId));
  return {
    name: network.name,
    description: network.description,
    source: network.source,
    baseMva: network.baseMva,
    baseKv: network.baseKv,
    bestKnownLossKw: network.bestKnownLossKw,
    buses: busRows.map((b) => ({
      name: b.name,
      kind: b.kind,
      loadPkw: b.loadPkw,
      loadQkvar: b.loadQkvar,
    })),
    lines: lineRows.map((l) => ({
      branch: l.branch,
      fromBus: l.fromBus,
      toBus: l.toBus,
      rOhm: l.rOhm,
      xOhm: l.xOhm,
      ratingA: l.ratingA,
      isSwitch: l.isSwitch,
      switchType: l.switchType,
      initialOpen: l.initialOpen,
    })),
    ders: derRows.map((d) => ({ bus: d.bus, pKw: d.pKw, kind: d.kind })),
  };
}

export async function getSettings(): Promise<typeof DEFAULT_SETTINGS> {
  await ensureSeeded();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  const stored = (row?.defaults ?? {}) as Record<string, unknown>;
  const solver = stored.solver;
  return {
    ...DEFAULT_SETTINGS,
    ...normaliseRunParams({ ...DEFAULT_SETTINGS, ...stored }),
    solver:
      solver === "simulated-annealing" ||
      solver === "quantum-inspired" ||
      solver === "qaoa-simulator" ||
      solver === "genetic-algorithm" ||
      solver === "dwave-hybrid"
        ? (solver as SolverId)
        : DEFAULT_SETTINGS.solver,
  };
}

export async function updateSettings(input: Record<string, unknown>) {
  await ensureSeeded();
  const merged = { ...DEFAULT_SETTINGS, ...input };
  await db
    .insert(settings)
    .values({ id: 1, defaults: merged })
    .onConflictDoUpdate({ target: settings.id, set: { defaults: merged, updatedAt: new Date() } });
  return getSettings();
}
