"use client";

import { useState } from "react";
import { ProfileChart } from "@/components/charts";

type NetworkOption = { id: number; name: string };
type BranchOption = { branch: number; from: string; to: string; switchType: string };

type FaultRow = {
  branch: number;
  kind: string;
  section: string;
  deEnergizedCount: number;
  loadShedKw: number;
  criticalLoadShedKw: number;
  outageReductionPct: number;
  restoration: {
    attempted: boolean;
    feasible: boolean;
    restoredBuses: number;
    restoredLoadKw: number;
    restoredPct: number;
    actions: { action: string; branch: number }[];
    violation: string | null;
  };
};

export function FaultStudio({
  networks,
  branches,
}: {
  networks: NetworkOption[];
  branches: Record<string, BranchOption[]>;
}) {
  const [networkId, setNetworkId] = useState(networks[0]?.id ?? 0);
  const [mode, setMode] = useState<"n1" | "line" | "switch-open" | "switch-stuck-closed">("n1");
  const [branch, setBranch] = useState(branches[String(networks[0]?.id)]?.[0]?.branch ?? 1);
  const [critical, setCritical] = useState("24,25,30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    summary: { faults: FaultRow[]; totals: { studied: number; unrestorable: number; averageRestoredPct: number; criticalLoadAtRiskKw: number } };
    studyId: number | null;
    mode: string;
  } | null>(null);

  const options = branches[String(networkId)] ?? [];

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/v1/faults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          networkId,
          faults: mode === "n1" ? [] : [{ kind: mode, branch }],
          criticalBuses: critical.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = (await response.json()) as typeof result & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Fault study failed");
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rows = result?.summary.faults.slice(0, 40) ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="grid grid-3">
        <div className="field">
          <label className="label">Feeder</label>
          <select className="select" value={networkId} onChange={(e) => setNetworkId(Number(e.target.value))}>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Study type</label>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="n1">N-1 scan (all switchable branches)</option>
            <option value="line">Line failure</option>
            <option value="switch-open">Switch stuck open</option>
            <option value="switch-stuck-closed">Switch stuck closed</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Faulted branch</label>
          <select
            className="select"
            value={branch}
            disabled={mode === "n1"}
            onChange={(e) => setBranch(Number(e.target.value))}
          >
            {options.map((b) => (
              <option key={b.branch} value={b.branch}>
                {b.branch}: {b.from}–{b.to} ({b.switchType})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Critical buses (comma separated)</label>
          <input className="input" value={critical} onChange={(e) => setCritical(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
          {busy ? "Running restoration search…" : "Run study"}
        </button>
        <span className="helper">Each contingency isolates the fault, searches alternative supply routes and validates the restored state with AC power flow.</span>
      </div>
      {error ? <div className="callout">{error}</div> : null}
      {result ? (
        <>
          <div className="grid grid-4">
            <div className="stat"><div className="stat-label">Faults studied</div><div className="stat-value">{result.summary.totals.studied}</div></div>
            <div className="stat accent-rose"><div className="stat-label">Still interrupted</div><div className="stat-value">{result.summary.totals.unrestorable}</div></div>
            <div className="stat accent-cyan"><div className="stat-label">Average restored</div><div className="stat-value">{result.summary.totals.averageRestoredPct}<small>%</small></div></div>
            <div className="stat accent-amber"><div className="stat-label">Critical load at risk</div><div className="stat-value">{result.summary.totals.criticalLoadAtRiskKw}<small>kW</small></div></div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">Contingency results</div>
              <span className="badge info">{result.mode}</span>
            </div>
            <div className="scroll-x">
              <table className="data">
                <thead>
                  <tr>
                    <th className="num">Branch</th>
                    <th>Section</th>
                    <th>Type</th>
                    <th className="num">Buses out</th>
                    <th className="num">Load shed kW</th>
                    <th className="num">Critical shed</th>
                    <th>Transfer actions</th>
                    <th className="num">Restored</th>
                    <th>Feasible</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={`${f.branch}-${f.kind}`}>
                      <td className="num">{f.branch}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{f.section}</td>
                      <td><span className="badge">{f.kind}</span></td>
                      <td className="num">{f.deEnergizedCount}</td>
                      <td className="num">{f.loadShedKw.toFixed(1)}</td>
                      <td className="num">{f.criticalLoadShedKw.toFixed(1)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {f.restoration.actions.map((a) => `${a.action} ${a.branch}`).join(", ") || "—"}
                      </td>
                      <td className="num">{f.restoration.restoredPct.toFixed(0)}%</td>
                      <td>
                        {f.restoration.feasible ? <span className="badge ok">validated</span> : <span className="badge bad" title={f.restoration.violation ?? ""}>violation</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

type ScenarioResult = {
  label: string;
  steps: { hour: number; solarPct: number; windPct: number; loadKw: number; derKw: number; curtailmentKw: number; lossKw: number | null; vMin: number; maxLoadingPct: number }[];
  averageLossKw: number;
  worstVmin: number;
  worstLoadingPct: number;
  totalCurtailmentKwh: number;
  derUtilisationPct: number;
  feasibleSteps: number;
  totalSteps: number;
};

export function ScenarioStudio({
  networks,
  recommended,
}: {
  networks: NetworkOption[];
  recommended: Record<string, { label: string; openSet: number[] } | null>;
}) {
  const [networkId, setNetworkId] = useState(networks[0]?.id ?? 0);
  const [config, setConfig] = useState({
    hour: 12,
    season: "summer",
    weather: "clear",
    cloudCover: 0.2,
    windSpeed: 7.5,
    loadMultiplier: 1,
    variability: 0.08,
    horizonHours: 24,
  });
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const evaluate = async () => {
    setBusy(true);
    setError(null);
    try {
      const rec = recommended[String(networkId)];
      const configs = [
        { label: "Current configuration", openSet: [] },
        ...(rec ? [{ label: rec.label, openSet: rec.openSet }] : []),
      ];
      const response = await fetch("/api/v1/scenarios/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ networkId, config, configs }),
      });
      const data = (await response.json()) as { results?: ScenarioResult[]; error?: string };
      if (!response.ok || !data.results) {
        setError(data.error ?? "Scenario evaluation failed");
        return;
      }
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setSaved(null);
    const response = await fetch("/api/v1/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        networkId,
        name: `${config.season} ${config.weather} ${String(config.hour).padStart(2, "0")}:00`,
        description: "Saved from the scenario workspace",
        kind: "combined",
        config,
      }),
    });
    setSaved(response.ok ? "Scenario saved to the library." : "Could not save the scenario.");
  };

  const update = (key: keyof typeof config, value: string | number) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="grid grid-4">
        <div className="field">
          <label className="label">Feeder</label>
          <select className="select" value={networkId} onChange={(e) => setNetworkId(Number(e.target.value))}>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">Season</label>
          <select className="select" value={config.season} onChange={(e) => update("season", e.target.value)}>
            {["winter", "spring", "summer", "autumn"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Weather</label>
          <select className="select" value={config.weather} onChange={(e) => update("weather", e.target.value)}>
            {["clear", "cloudy", "overcast", "storm"].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Cloud cover ({Math.round(config.cloudCover * 100)}%)</label>
          <input type="range" min={0} max={1} step={0.05} value={config.cloudCover} onChange={(e) => update("cloudCover", Number(e.target.value))} />
        </div>
        <div className="field">
          <label className="label">Wind speed ({config.windSpeed} m/s)</label>
          <input type="range" min={0} max={25} step={0.5} value={config.windSpeed} onChange={(e) => update("windSpeed", Number(e.target.value))} />
        </div>
        <div className="field">
          <label className="label">Load multiplier ({config.loadMultiplier.toFixed(2)}×)</label>
          <input type="range" min={0.5} max={1.8} step={0.05} value={config.loadMultiplier} onChange={(e) => update("loadMultiplier", Number(e.target.value))} />
        </div>
        <div className="field">
          <label className="label">Variability ({Math.round(config.variability * 100)}%)</label>
          <input type="range" min={0} max={0.4} step={0.02} value={config.variability} onChange={(e) => update("variability", Number(e.target.value))} />
        </div>
        <div className="field">
          <label className="label">Horizon (hours)</label>
          <input className="input" type="number" min={1} max={24} value={config.horizonHours} onChange={(e) => update("horizonHours", Number(e.target.value))} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={evaluate} disabled={busy}>
          {busy ? "Sweeping horizon…" : "Evaluate scenario"}
        </button>
        <button type="button" className="btn" onClick={save}>Save scenario</button>
        {saved ? <span className="badge ok">{saved}</span> : null}
        <span className="helper">Comparisons include the current state and the latest validated recommendation for the feeder.</span>
      </div>
      {error ? <div className="callout">{error}</div> : null}
      {results ? (
        <>
          <div className="panel">
            <div className="panel-head">
              <div className="panel-title">Generation and loss profile</div>
              <span className="badge info">{results[0]?.totalSteps} steps</span>
            </div>
            <div className="panel-body">
              <ProfileChart
                points={results[0].steps.map((s) => s.hour)}
                series={[
                  { label: "Solar availability %", values: results[0].steps.map((s) => s.solarPct), color: "#b54708" },
                  { label: "Wind availability %", values: results[0].steps.map((s) => s.windPct), color: "#1d4ed8" },
                  { label: "Loss kW (current)", values: results[0].steps.map((s) => s.lossKw ?? 0), color: "#b42318", dashed: true },
                  ...(results[1] ? [{ label: "Loss kW (recommended)", values: results[1].steps.map((s) => s.lossKw ?? 0), color: "#067647" }] : []),
                ]}
                unit="hourly sweep"
              />
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><div className="panel-title">Robust comparison</div></div>
            <div className="scroll-x">
              <table className="data">
                <thead>
                  <tr>
                    <th>Configuration</th>
                    <th className="num">Average loss kW</th>
                    <th className="num">Worst Vmin pu</th>
                    <th className="num">Worst loading %</th>
                    <th className="num">Feasible steps</th>
                    <th className="num">Curtailed kWh</th>
                    <th className="num">DER utilisation</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="num">{r.averageLossKw.toFixed(1)}</td>
                      <td className="num">{r.worstVmin.toFixed(4)}</td>
                      <td className="num">{r.worstLoadingPct.toFixed(1)}</td>
                      <td className="num">{r.feasibleSteps}/{r.totalSteps}</td>
                      <td className="num">{r.totalCurtailmentKwh.toFixed(1)}</td>
                      <td className="num">{r.derUtilisationPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
