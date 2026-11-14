import type { SwitchType } from "@/lib/networks/types";

export type BusModel = {
  index: number;
  name: string;
  isSlack: boolean;
  loadPkw: number;
  loadQkvar: number;
  derPkw: number;
};

export type LineModel = {
  index: number;
  branch: number;
  from: number;
  to: number;
  rPu: number;
  xPu: number;
  ratingA: number;
  isSwitch: boolean;
  switchType: SwitchType;
  initialOpen: boolean;
};

export type NetModel = {
  name: string;
  source: string;
  baseMva: number;
  baseKv: number;
  buses: BusModel[];
  lines: LineModel[];
  slack: number;
  totalLoadKw: number;
  totalDerKw: number;
  bestKnownLossKw: number | null;
};

export type NetworkRows = {
  name: string;
  description?: string;
  source: string;
  baseMva: number;
  baseKv: number;
  bestKnownLossKw: number | null;
  buses: { name: string; kind: string; loadPkw: number; loadQkvar: number }[];
  lines: {
    branch: number;
    fromBus: string;
    toBus: string;
    rOhm: number;
    xOhm: number;
    ratingA: number;
    isSwitch: boolean;
    switchType: string;
    initialOpen: boolean;
  }[];
  ders: { bus: string; pKw: number; kind?: string }[];
};

export function buildModel(rows: NetworkRows, derPenetrationPct = 0): NetModel {
  const sortedBuses = [...rows.buses];
  const indexByName = new Map<string, number>();
  sortedBuses.forEach((b, i) => indexByName.set(b.name, i));

  // Scale DERs by the scenario penetration. 100% = nameplate DER of the dataset.
  const derByBus = new Map<number, number>();
  for (const d of rows.ders) {
    const idx = indexByName.get(d.bus);
    if (idx === undefined) continue;
    derByBus.set(idx, (derByBus.get(idx) ?? 0) + (d.pKw * derPenetrationPct) / 100);
  }

  const zBase = (rows.baseKv * rows.baseKv) / rows.baseMva;
  const buses: BusModel[] = sortedBuses.map((b, i) => ({
    index: i,
    name: b.name,
    isSlack: b.kind === "slack",
    loadPkw: b.loadPkw,
    loadQkvar: b.loadQkvar,
    derPkw: derByBus.get(i) ?? 0,
  }));

  const lines: LineModel[] = [];
  for (const l of rows.lines) {
    const from = indexByName.get(l.fromBus);
    const to = indexByName.get(l.toBus);
    if (from === undefined || to === undefined) continue;
    const switchType = (["fixed", "sectionalizing", "tie"].includes(l.switchType)
      ? l.switchType
      : l.isSwitch
        ? "sectionalizing"
        : "fixed") as SwitchType;
    lines.push({
      index: lines.length,
      branch: l.branch,
      from,
      to,
      rPu: l.rOhm / zBase,
      xPu: l.xOhm / zBase,
      ratingA: l.ratingA > 0 ? l.ratingA : 400,
      isSwitch: l.isSwitch || switchType !== "fixed",
      switchType,
      initialOpen: l.initialOpen,
    });
  }

  const slack = buses.find((b) => b.isSlack)?.index ?? 0;
  return {
    name: rows.name,
    source: rows.source,
    baseMva: rows.baseMva,
    baseKv: rows.baseKv,
    buses,
    lines,
    slack,
    totalLoadKw: buses.reduce((a, b) => a + b.loadPkw, 0),
    totalDerKw: buses.reduce((a, b) => a + b.derPkw, 0),
    bestKnownLossKw: rows.bestKnownLossKw,
  };
}

export function initialOpenSet(model: NetModel): Set<number> {
  return new Set(model.lines.filter((l) => l.initialOpen).map((l) => l.index));
}

export function adjacency(model: NetModel, openSet: Set<number>) {
  const adj: { to: number; line: number }[][] = model.buses.map(() => []);
  for (const line of model.lines) {
    if (openSet.has(line.index)) continue;
    adj[line.from].push({ to: line.to, line: line.index });
    adj[line.to].push({ to: line.from, line: line.index });
  }
  return adj;
}

export function openSetToStates(model: NetModel, openSet: Set<number>) {
  const states: Record<string, boolean> = {};
  for (const l of model.lines) {
    if (!l.isSwitch) continue;
    states[String(l.branch)] = !openSet.has(l.index);
  }
  return states;
}
