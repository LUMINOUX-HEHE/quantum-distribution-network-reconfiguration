import type { ScenarioConfig } from "@/db/schema";
import { buildModel, type NetModel, type NetworkRows } from "./model";
import { analyseTopology } from "./topology";
import { checkLimits, runAcPowerFlow, type PowerFlowResult } from "./powerflow";

export type ScenarioStep = {
  hour: number;
  solarPct: number;
  windPct: number;
  loadMultiplier: number;
  loadKw: number;
  derKw: number;
  curtailmentKw: number;
  lossKw: number | null;
  vMin: number;
  vMax: number;
  maxLoadingPct: number;
  converged: boolean;
};

export type ScenarioEvaluation = {
  steps: ScenarioStep[];
  worstVmin: number;
  worstVmax: number;
  worstLoadingPct: number;
  totalLossKwh: number;
  averageLossKw: number;
  totalCurtailmentKwh: number;
  feasibleSteps: number;
  totalSteps: number;
  derUtilisationPct: number;
  notes: string[];
};

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^= t >>> 15) >>> 0) / 4294967296;
  };
}

const SEASON_SCALE: Record<ScenarioConfig["season"], { solar: number; load: number }> = {
  winter: { solar: 0.55, load: 1.12 },
  spring: { solar: 0.92, load: 0.94 },
  summer: { solar: 1.08, load: 1.18 },
  autumn: { solar: 0.78, load: 1.0 },
};

const WEATHER_CLOUD: Record<ScenarioConfig["weather"], number> = {
  clear: 0.08,
  cloudy: 0.42,
  overcast: 0.78,
  storm: 0.94,
};

/** Deterministic solar factor in [0, 1] for a given hour and cloud cover. */
export function solarFactor(hour: number, cloudCover: number, season: ScenarioConfig["season"]): number {
  if (hour < 5.5 || hour > 19.5) return 0;
  const daylight = Math.sin(((hour - 5.5) / 14) * Math.PI);
  const clear = Math.max(0, daylight) * SEASON_SCALE[season].solar;
  return Math.max(0, clear * (1 - 0.78 * cloudCover)) ** 1.15;
}

/** Wind turbine power curve (cut-in 3 m/s, rated 12 m/s, cut-out 25 m/s). */
export function windFactor(speed: number): number {
  if (speed < 3 || speed >= 25) return 0;
  if (speed >= 12) return 1;
  return ((speed - 3) / 9) ** 3;
}

/** Normalised demand shape with morning and evening peaks. */
export function loadFactor(hour: number, season: ScenarioConfig["season"]): number {
  const morning = Math.exp(-((hour - 8) ** 2) / 6) * 0.42;
  const evening = Math.exp(-((hour - 19) ** 2) / 9) * 0.55;
  const base = 0.62 + morning + evening;
  return base * SEASON_SCALE[season].load;
}

export function defaultScenarioConfig(): ScenarioConfig {
  return {
    hour: 12,
    season: "summer",
    cloudCover: 0.2,
    windSpeed: 7.5,
    loadMultiplier: 1,
    variability: 0.08,
    horizonHours: 24,
    weather: "clear",
  };
}

export function normaliseScenarioConfig(input: unknown): ScenarioConfig {
  const raw = (input ?? {}) as Record<string, unknown>;
  const num = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(raw[key]);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const season = ["winter", "spring", "summer", "autumn"].includes(String(raw.season))
    ? (raw.season as ScenarioConfig["season"])
    : "summer";
  const weather = ["clear", "cloudy", "overcast", "storm"].includes(String(raw.weather))
    ? (raw.weather as ScenarioConfig["weather"])
    : "clear";
  return {
    hour: Math.round(num("hour", 12, 0, 23)),
    season,
    weather,
    cloudCover: Math.min(1, Math.max(0, (raw.cloudCover === undefined ? WEATHER_CLOUD[weather] : num("cloudCover", 0.2, 0, 1)))),
    windSpeed: num("windSpeed", 7.5, 0, 30),
    loadMultiplier: num("loadMultiplier", 1, 0.4, 2),
    variability: num("variability", 0.08, 0, 0.5),
    horizonHours: Math.round(num("horizonHours", 24, 1, 24)),
  };
}

/** Scale a network model for a scenario time step. */
export function scenarioModel(rows: NetworkRows, config: ScenarioConfig, hour: number, seed = 7): NetModel {
  const rng = seeded(seed + Math.round(hour * 31));
  const solar = solarFactor(hour, config.cloudCover, config.season);
  const wind = windFactor(config.windSpeed + (rng() - 0.5) * 2 * config.variability * config.windSpeed);
  const loadScale = loadFactor(hour, config.season) * config.loadMultiplier;
  const model = buildModel(rows, 100);
  const jitter = 1 + (rng() - 0.5) * 2 * config.variability;
  return {
    ...model,
    buses: model.buses.map((bus, index) => {
      const isSolar = rows.ders.some((d) => d.bus === bus.name && d.kind === "pv");
      const isWind = rows.ders.some((d) => d.bus === bus.name && d.kind === "wind");
      const derFactor = isSolar ? solar : isWind ? wind : 1;
      const perBusLoad = 1 + (rng() - 0.5) * 2 * config.variability;
      void index;
      return {
        ...bus,
        loadPkw: bus.loadPkw * loadScale * perBusLoad,
        loadQkvar: bus.loadQkvar * loadScale * perBusLoad,
        derPkw: bus.derPkw * derFactor * jitter,
      };
    }),
  };
}

/**
 * Evaluate a switch configuration across the scenario horizon.
 * Any voltage/current violation triggers proportional DER curtailment so the
 * curtailed energy is reported instead of silently accepting a violation.
 */
export function evaluateScenario(
  rows: NetworkRows,
  openSet: Iterable<number>,
  config: ScenarioConfig,
  limits: { voltageMin: number; voltageMax: number; maxLoadingPct: number },
  seed = 7,
): ScenarioEvaluation {
  const steps: ScenarioStep[] = [];
  const notes: string[] = [];
  const open = new Set(openSet);
  let curtailedEnergy = 0;
  let suppliedDer = 0;
  let availableDer = 0;

  for (let hour = 0; hour < config.horizonHours; hour += 1) {
    const model = scenarioModel(rows, config, hour, seed);
    if (!analyseTopology(model, open).isRadial) {
      notes.push("Configuration is not radial for this scenario — evaluation skipped.");
      break;
    }
    let pf = runAcPowerFlow(model, open);
    let curtailed = 0;
    let guard = 0;
    while (pf.converged && !checkLimits(pf, limits).feasible && guard < 6 && model.totalDerKw > 0) {
      const factor = Math.max(0, 1 - 0.2 * (guard + 1));
      curtailed =
        model.buses.reduce((a, b) => a + b.derPkw, 0) * (1 - factor);
      const curtailedModel: NetModel = {
        ...model,
        buses: model.buses.map((b) => ({ ...b, derPkw: b.derPkw * factor })),
      };
      pf = runAcPowerFlow(curtailedModel, open);
      guard += 1;
      if (guard >= 6) notes.push(`DER curtailment reached the iteration cap at hour ${hour}.`);
    }
    availableDer += model.buses.reduce((a, b) => a + b.derPkw, 0);
    suppliedDer += model.buses.reduce((a, b) => a + b.derPkw, 0) - curtailed;
    curtailedEnergy += curtailed;
    steps.push({
      hour,
      solarPct: Math.round(solarFactor(hour, config.cloudCover, config.season) * 100),
      windPct: Math.round(windFactor(config.windSpeed) * 100),
      loadMultiplier: Number((loadFactor(hour, config.season) * config.loadMultiplier).toFixed(3)),
      loadKw: Number(model.buses.reduce((a, b) => a + b.loadPkw, 0).toFixed(2)),
      derKw: Number((model.buses.reduce((a, b) => a + b.derPkw, 0) - curtailed).toFixed(2)),
      curtailmentKw: Number(curtailed.toFixed(2)),
      lossKw: pf.lossKw === null ? null : Number(pf.lossKw.toFixed(2)),
      vMin: Number(pf.vMin.toFixed(5)),
      vMax: Number(pf.vMax.toFixed(5)),
      maxLoadingPct: Number(pf.maxLoadingPct.toFixed(2)),
      converged: pf.converged,
    });
  }

  const convergedSteps = steps.filter((s) => s.converged);
  const losses = convergedSteps.map((s) => s.lossKw ?? 0);
  const totalLossKwh = losses.reduce((a, b) => a + b, 0);
  return {
    steps,
    worstVmin: convergedSteps.length ? Math.min(...convergedSteps.map((s) => s.vMin)) : 0,
    worstVmax: convergedSteps.length ? Math.max(...convergedSteps.map((s) => s.vMax)) : 0,
    worstLoadingPct: convergedSteps.length ? Math.max(...convergedSteps.map((s) => s.maxLoadingPct)) : 0,
    totalLossKwh: Number(totalLossKwh.toFixed(2)),
    averageLossKw: convergedSteps.length ? Number((totalLossKwh / convergedSteps.length).toFixed(2)) : 0,
    totalCurtailmentKwh: Number(curtailedEnergy.toFixed(2)),
    feasibleSteps: convergedSteps.filter((s) => s.vMin >= limits.voltageMin && s.maxLoadingPct <= limits.maxLoadingPct).length,
    totalSteps: steps.length,
    derUtilisationPct: availableDer > 0 ? Number(((suppliedDer / availableDer) * 100).toFixed(1)) : 0,
    notes,
  };
}

/** Compare configurations across a scenario set and rank by robust (worst-case) loss. */
export function robustComparison(
  rows: NetworkRows,
  configs: { label: string; openSet: number[] }[],
  config: ScenarioConfig,
  limits: { voltageMin: number; voltageMax: number; maxLoadingPct: number },
  seed = 7,
): {
  label: string;
  averageLossKw: number;
  worstLossKw: number;
  worstVmin: number;
  feasibleSteps: number;
  totalSteps: number;
  curtailmentKwh: number;
  openSet: number[];
}[] {
  return configs
    .map((entry) => {
      const evaluation = evaluateScenario(rows, entry.openSet, config, limits, seed);
      return {
        label: entry.label,
        averageLossKw: evaluation.averageLossKw,
        worstLossKw: Math.max(0, ...evaluation.steps.map((s) => s.lossKw ?? 0)),
        worstVmin: evaluation.worstVmin,
        feasibleSteps: evaluation.feasibleSteps,
        totalSteps: evaluation.totalSteps,
        curtailmentKwh: evaluation.totalCurtailmentKwh,
        openSet: entry.openSet,
      };
    })
    .sort((a, b) => b.feasibleSteps - a.feasibleSteps || a.worstLossKw - b.worstLossKw);
}
