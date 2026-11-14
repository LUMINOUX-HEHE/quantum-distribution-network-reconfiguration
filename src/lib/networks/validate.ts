import type { BusInput, DerInput, LineInput, NetworkDraft, SwitchType } from "./types";

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function validateNetworkDraft(input: unknown): { draft: NetworkDraft | null; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { draft: null, errors: ["Body must be a JSON object"] };
  }
  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) errors.push("name is required");
  if (name.length > 120) errors.push("name must be ≤ 120 characters");

  const baseMva = asNumber(raw.baseMva ?? 10);
  const baseKv = asNumber(raw.baseKv ?? 12.66);
  if (baseMva === null || baseMva <= 0) errors.push("baseMva must be a positive number");
  if (baseKv === null || baseKv <= 0) errors.push("baseKv must be a positive number");

  const rawBuses = Array.isArray(raw.buses) ? raw.buses : [];
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  if (rawBuses.length < 2) errors.push("at least two buses are required");
  if (rawLines.length < 1) errors.push("at least one line is required");
  if (rawBuses.length > 2000) errors.push("networks above 2000 buses are not supported in v1");

  const busNames = new Set<string>();
  const buses: BusInput[] = [];
  let slackCount = 0;
  rawBuses.forEach((entry, i) => {
    const bus = (entry ?? {}) as Record<string, unknown>;
    const busName = typeof bus.name === "string" ? bus.name.trim() : "";
    if (!busName) {
      errors.push(`buses[${i}].name is required`);
      return;
    }
    if (busNames.has(busName)) errors.push(`duplicate bus name "${busName}"`);
    busNames.add(busName);
    const kind = bus.kind === "slack" ? "slack" : "pq";
    if (kind === "slack") slackCount += 1;
    const loadPkw = asNumber(bus.loadPkw ?? 0);
    const loadQkvar = asNumber(bus.loadQkvar ?? 0);
    if (loadPkw === null || loadQkvar === null) errors.push(`buses[${i}] load values must be numeric`);
    buses.push({
      name: busName,
      kind,
      loadPkw: loadPkw ?? 0,
      loadQkvar: loadQkvar ?? 0,
    });
  });
  if (slackCount === 0) errors.push("exactly one bus must have kind = 'slack' (substation)");
  if (slackCount > 1) errors.push("only one slack bus (substation) is supported in v1");

  const lines: LineInput[] = [];
  const adjacency = new Map<string, Set<string>>();
  busNames.forEach((b) => adjacency.set(b, new Set()));
  rawLines.forEach((entry, i) => {
    const line = (entry ?? {}) as Record<string, unknown>;
    const from = typeof line.from === "string" ? line.from.trim() : "";
    const to = typeof line.to === "string" ? line.to.trim() : "";
    if (!busNames.has(from)) errors.push(`lines[${i}].from references unknown bus "${from}"`);
    if (!busNames.has(to)) errors.push(`lines[${i}].to references unknown bus "${to}"`);
    if (from === to) errors.push(`lines[${i}] connects a bus to itself`);
    const r = asNumber(line.rOhm);
    const x = asNumber(line.xOhm);
    if (r === null || r < 0) errors.push(`lines[${i}].rOhm must be a non-negative number`);
    if (x === null || x < 0) errors.push(`lines[${i}].xOhm must be a non-negative number`);
    const rating = asNumber(line.ratingA ?? 400);
    if (rating === null || rating <= 0) errors.push(`lines[${i}].ratingA must be positive`);
    const switchTypeRaw = typeof line.switchType === "string" ? line.switchType : "sectionalizing";
    if (!["fixed", "sectionalizing", "tie"].includes(switchTypeRaw)) {
      errors.push(`lines[${i}].switchType must be fixed | sectionalizing | tie`);
    }
    if (busNames.has(from) && busNames.has(to)) {
      adjacency.get(from)?.add(to);
      adjacency.get(to)?.add(from);
    }
    lines.push({
      branch: asNumber(line.branch) ?? i + 1,
      from,
      to,
      rOhm: r ?? 0,
      xOhm: x ?? 0,
      ratingA: rating ?? 400,
      switchType: switchTypeRaw as SwitchType,
      initialOpen: line.initialOpen === true,
    });
  });

  // Connectivity of the underlying topology (all switches closed).
  if (busNames.size > 0 && adjacency.size > 0) {
    const start = buses.find((b) => b.kind === "slack")?.name ?? buses[0]?.name;
    if (start) {
      const seen = new Set<string>([start]);
      const queue = [start];
      for (let head = 0; head < queue.length; head += 1) {
        for (const next of adjacency.get(queue[head]) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      if (seen.size !== busNames.size) {
        errors.push(
          `network is disconnected: ${busNames.size - seen.size} bus(es) cannot be reached from the substation`,
        );
      }
    }
  }

  const closedCount = lines.filter((l) => !l.initialOpen).length;
  const requiredOpen = lines.length - buses.length + 1;
  if (lines.length - closedCount !== requiredOpen) {
    errors.push(
      `initial switch states must leave exactly ${requiredOpen} open branch(es) for a radial topology (found ${lines.length - closedCount})`,
    );
  }
  if (!lines.some((l) => l.switchType !== "fixed")) {
    errors.push("at least one switchable branch is required");
  }

  const rawDers = Array.isArray(raw.ders) ? raw.ders : [];
  const ders: DerInput[] = [];
  rawDers.forEach((entry, i) => {
    const der = (entry ?? {}) as Record<string, unknown>;
    const bus = typeof der.bus === "string" ? der.bus.trim() : "";
    if (!busNames.has(bus)) errors.push(`ders[${i}].bus references unknown bus "${bus}"`);
    const pKw = asNumber(der.pKw);
    if (pKw === null || pKw < 0) errors.push(`ders[${i}].pKw must be a non-negative number`);
    ders.push({
      bus,
      kind: der.kind === "wind" ? "wind" : "pv",
      pKw: pKw ?? 0,
    });
  });

  if (errors.length > 0) return { draft: null, errors };

  return {
    draft: {
      name,
      description: typeof raw.description === "string" ? raw.description : "Imported distribution network",
      source: "custom",
      baseMva: baseMva as number,
      baseKv: baseKv as number,
      bestKnownLossKw: null,
      bestKnownSource: "unknown",
      buses,
      lines,
      ders,
    },
    errors: [],
  };
}
