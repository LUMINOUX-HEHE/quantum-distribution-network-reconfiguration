"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RunParams, SolverId } from "@/lib/networks/types";

type NetworkOption = {
  id: number;
  name: string;
  source: string;
  busCount: number;
  lineCount: number;
  switchCount: number;
  tieCount: number;
  bestKnownLossKw: number | null;
};

type SolverOption = {
  id: string;
  name: string;
  kind: string;
  description: string;
  available: boolean;
  reason: string;
};

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function RunForm({
  networks,
  solvers,
  defaults,
  initialNetworkId,
}: {
  networks: NetworkOption[];
  solvers: SolverOption[];
  defaults: RunParams & { solver: SolverId };
  initialNetworkId?: number;
}) {
  const router = useRouter();
  const [networkId, setNetworkId] = useState<number>(initialNetworkId ?? networks[0]?.id ?? 0);
  const [solver, setSolver] = useState<string>(defaults.solver);
  const [topK, setTopK] = useState(String(defaults.topK));
  const [iterations, setIterations] = useState(String(defaults.iterations));
  const [restarts, setRestarts] = useState(String(defaults.restarts));
  const [penalty, setPenalty] = useState(defaults.penaltyWeight === null ? "auto" : String(defaults.penaltyWeight));
  const [refinement, setRefinement] = useState(String(defaults.refinementIterations));
  const [der, setDer] = useState(String(defaults.derPenetrationPct));
  const [vmin, setVmin] = useState(String(defaults.voltageMin));
  const [vmax, setVmax] = useState(String(defaults.voltageMax));
  const [loading, setLoading] = useState(String(defaults.maxLoadingPct));
  const [brute, setBrute] = useState(defaults.baselineBruteForce);
  const [branch, setBranch] = useState(defaults.baselineBranchExchange);
  const [maxOps, setMaxOps] = useState(defaults.maxSwitchingOps === null ? "" : String(defaults.maxSwitchingOps));
  const [milp, setMilp] = useState(defaults.baselineMilp);
  const [timeout, setTimeoutValue] = useState(String(defaults.timeoutMs));
  const [seed, setSeed] = useState("42");
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = networks.find((n) => n.id === networkId);
  const solverInfo = solvers.find((s) => s.id === solver);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const params: RunParams = {
        topK: num(topK, 12),
        iterations: num(iterations, 6000),
        restarts: num(restarts, 3),
        penaltyWeight: penalty === "auto" ? null : num(penalty, 0),
        refinementIterations: num(refinement, 6),
        derPenetrationPct: num(der, 0),
        voltageMin: num(vmin, 0.9),
        voltageMax: num(vmax, 1.05),
        maxLoadingPct: num(loading, 100),
        baselineBruteForce: brute,
        baselineBranchExchange: branch,
        maxSwitchingOps: maxOps.trim() === "" ? null : num(maxOps, 0),
        baselineMilp: milp,
        timeoutMs: num(timeout, 25000),
      };
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ networkId, solver, params, seed: num(seed, 42) }),
      });
      const data = (await response.json()) as { run?: { id: number }; error?: string };
      if (!response.ok || !data.run) {
        setError(data.error ?? "Could not submit run");
        setSubmitting(false);
        return;
      }
      router.push(`/runs/${data.run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Run configuration</div>
            <div className="panel-sub">Network, solver, formulation and validation limits</div>
          </div>
          <span className="badge info">advisory</span>
        </div>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="network">Network</label>
            <select id="network" className="select" value={networkId} onChange={(e) => setNetworkId(Number(e.target.value))}>
              {networks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} · {n.busCount} buses · {n.switchCount} switches
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="solver">Solver</label>
            <select id="solver" className="select" value={solver} onChange={(e) => setSolver(e.target.value)}>
              {solvers.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.available}>
                  {s.name} {s.available ? "" : "(unavailable)"}
                </option>
              ))}
            </select>
            <span className="helper">{solverInfo?.description}</span>
            {solverInfo && !solverInfo.available ? <span className="helper" style={{ color: "#fbbf24" }}>{solverInfo.reason}</span> : null}
          </div>
          <div className="grid grid-3">
            <div className="field">
              <label className="label" htmlFor="topk">Top-k candidates</label>
              <input id="topk" className="input" value={topK} onChange={(e) => setTopK(e.target.value)} inputMode="numeric" />
            </div>
            <div className="field">
              <label className="label" htmlFor="iters">Annealing steps</label>
              <input id="iters" className="input" value={iterations} onChange={(e) => setIterations(e.target.value)} inputMode="numeric" />
            </div>
            <div className="field">
              <label className="label" htmlFor="restarts">Restarts</label>
              <input id="restarts" className="input" value={restarts} onChange={(e) => setRestarts(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div className="grid grid-3">
            <div className="field">
              <label className="label" htmlFor="penalty">One-hot penalty</label>
              <input id="penalty" className="input" value={penalty} onChange={(e) => setPenalty(e.target.value)} />
              <span className="helper">auto = tuned from loss coefficients</span>
            </div>
            <div className="field">
              <label className="label" htmlFor="refine">Refinement passes</label>
              <input id="refine" className="input" value={refinement} onChange={(e) => setRefinement(e.target.value)} inputMode="numeric" />
            </div>
            <div className="field">
              <label className="label" htmlFor="der">DER penetration %</label>
              <input id="der" className="input" value={der} onChange={(e) => setDer(e.target.value)} inputMode="numeric" />
              <span className="helper">scales stored PV/wind nameplate</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setAdvanced((v) => !v)}>
            {advanced ? "− Hide limits" : "+ Voltage / loading limits & baselines"}
          </button>
          {advanced ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="grid grid-3">
                <div className="field">
                  <label className="label" htmlFor="vmin">Voltage min (pu)</label>
                  <input id="vmin" className="input" value={vmin} onChange={(e) => setVmin(e.target.value)} inputMode="decimal" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="vmax">Voltage max (pu)</label>
                  <input id="vmax" className="input" value={vmax} onChange={(e) => setVmax(e.target.value)} inputMode="decimal" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="loading">Max loading %</label>
                  <input id="loading" className="input" value={loading} onChange={(e) => setLoading(e.target.value)} inputMode="decimal" />
                </div>
              </div>
              <div className="grid grid-3">
                <div className="field">
                  <label className="label" htmlFor="maxops">Switch operation limit</label>
                  <input id="maxops" className="input" placeholder="unlimited" value={maxOps} onChange={(e) => setMaxOps(e.target.value)} inputMode="numeric" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="seed">Random seed</label>
                  <input id="seed" className="input" value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="timeout">Timeout (ms)</label>
                  <input id="timeout" className="input" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} inputMode="numeric" />
                </div>
              </div>
              <div style={{ display: "flex", gap: 18, fontSize: 12, color: "#8ba0b8" }}>
                <label style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <input type="checkbox" checked={branch} onChange={(e) => setBranch(e.target.checked)} />
                  Branch-exchange baseline
                </label>
                <label style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <input type="checkbox" checked={brute} onChange={(e) => setBrute(e.target.checked)} />
                  Brute-force baseline
                </label>
                <label style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <input type="checkbox" checked={milp} onChange={(e) => setMilp(e.target.checked)} />
                  MILP assignment baseline
                </label>
              </div>
            </div>
          ) : null}
          {error ? <div className="callout">{error}</div> : null}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? "Submitting…" : "Run hybrid optimisation"}
            </button>
            <span className="helper">Seeds, parameters and solver versions are stored for reproducibility.</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Search space</div>
            <span className="badge">{selected?.source ?? "custom"}</span>
          </div>
          <div className="panel-body">
            <dl>
              <div className="kv"><dt>Buses / branches</dt><dd>{selected?.busCount ?? "—"} / {selected?.lineCount ?? "—"}</dd></div>
              <div className="kv"><dt>Switchable branches</dt><dd>{selected?.switchCount ?? "—"}</dd></div>
              <div className="kv"><dt>Independent loops</dt><dd>{selected?.tieCount ?? "—"} (tie switches)</dd></div>
              <div className="kv">
                <dt>Raw switch space</dt>
                <dd>2^{selected?.switchCount ?? 0} ≈ {selected ? Math.pow(2, selected.switchCount).toExponential(2) : "—"}</dd>
              </div>
              <div className="kv"><dt>Loop-one-hot space</dt><dd>≤ {(selected?.lineCount ?? 0)}^{selected?.tieCount ?? 0} proposals · lazy radiality check</dd></div>
              <div className="kv"><dt>Reference loss</dt><dd>{selected?.bestKnownLossKw ? `${selected.bestKnownLossKw.toFixed(2)} kW` : "no reference"}</dd></div>
            </dl>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">What happens when you run</div>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12, color: "#8ba0b8" }}>
            {[
              "Preprocess: contract non-switchable lines, detect fundamental loops.",
              "Build loop-one-hot QUBO with auto-tuned penalty weights.",
              "Solve for top-k candidates on the selected backend.",
              "Repair each candidate to a spanning tree (connectivity + radiality).",
              "Validate with an exact AC backward/forward sweep power flow.",
              "Select the best feasible plan, then refine and compare against baselines.",
            ].map((step, i) => (
              <div key={step} style={{ display: "flex", gap: 9 }}>
                <span className="plan-num">{i + 1}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RunMonitor({
  runId,
  status,
  stage,
  progress,
  logs,
}: {
  runId: number;
  status: string;
  stage: string;
  progress: number;
  logs: { t: string; stage: string; level: string; message: string }[];
}) {
  const router = useRouter();
  const [state, setState] = useState({ status, stage, progress, logs });
  const [transport, setTransport] = useState("polling");
  const refreshed = useRef(false);
  const active = state.status === "queued" || state.status === "running";

  useEffect(() => {
    if (!active) {
      if (!refreshed.current) {
        refreshed.current = true;
        router.refresh();
      }
      return;
    }
    let cancelled = false;
    let source: EventSource | null = null;
    try {
      source = new EventSource(`/api/runs/${runId}/events`);
      source.addEventListener("status", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            status: string;
            stage: string;
            progress: number;
            logs: typeof logs;
          };
          setTransport("sse");
          setState({
            status: payload.status,
            stage: payload.stage,
            progress: payload.progress,
            logs: payload.logs ?? [],
          });
        } catch {
          /* ignore malformed event */
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        setTransport("polling");
      };
    } catch {
      // The polling loop below covers stream failures without a synchronous
      // state update inside the effect body.
    }

    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as {
          run: { status: string; stage: string; progress: number; logs: typeof logs; error: string | null };
        };
        setState({
          status: data.run.status,
          stage: data.run.stage,
          progress: data.run.progress,
          logs: data.run.logs ?? [],
        });
        if (data.run.status === "completed" || data.run.status === "failed") {
          clearInterval(interval);
        }
      } catch {
        /* keep polling */
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, runId]);

  const stageOrder = ["queued", "loading", "preprocess", "qubo", "solve", "refinement", "baselines", "validate", "complete"];
  const currentIndex = Math.max(0, stageOrder.indexOf(state.stage));

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Run progress</div>
          <div className="panel-sub">
            {state.status === "completed" ? "Pipeline complete — results validated" : state.status === "failed" ? "Pipeline failed" : `Stage: ${state.stage}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge">{transport}</span>
          <span className={`badge ${state.status === "completed" ? "ok" : state.status === "failed" ? "bad" : "info"}`}>{state.status}</span>
        </div>
      </div>
      <div className="panel-body">
        <div className="progress" style={{ marginBottom: 12 }}>
          <span style={{ width: `${state.progress}%` }} />
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
          {stageOrder.slice(1, -1).map((s, i) => (
            <span
              key={s}
              className="pipeline-step"
              style={{
                borderColor: i < currentIndex ? "rgba(61,220,151,0.4)" : undefined,
                color: i < currentIndex ? "#8af3c4" : i === currentIndex - 1 ? "#a5e3ff" : undefined,
              }}
            >
              {s}
            </span>
          ))}
        </div>
        <div className="log">
          {state.logs.length === 0 ? <div className="helper">Waiting for worker…</div> : null}
          {state.logs.map((entry, i) => (
            <div key={`${entry.t}-${i}`} className="log-line">
              <span className="log-time">{entry.t.slice(11, 19)}</span>
              <span className="log-stage">{entry.stage}</span>
              <span style={{ color: entry.level === "error" ? "#ffb3bf" : entry.level === "warn" ? "#ffe1a0" : undefined }}>{entry.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BenchmarkRunner({ networks }: { networks: { id: number; name: string }[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>(networks.map((n) => n.id));
  const [baselines, setBaselines] = useState(true);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ networkIds: selected, includeBaselines: baselines }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) setError(data.error ?? "Benchmark failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#8ba0b8" }}>
        {networks.map((n) => (
          <label key={n.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={selected.includes(n.id)}
              onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, n.id] : prev.filter((id) => id !== n.id)))}
            />
            {n.name}
          </label>
        ))}
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={baselines} onChange={(e) => setBaselines(e.target.checked)} />
          classical baselines
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" onClick={run} disabled={running || selected.length === 0}>
          {running ? "Running suite — this can take ~20s…" : "Run comparison suite"}
        </button>
        <span className="helper">Runs every available solver plus classical baselines on the same inputs and seeds.</span>
      </div>
      {error ? <div className="callout">{error}</div> : null}
    </div>
  );
}

const sampleNetwork = {
  name: "Two-loop demo feeder",
  description: "Minimal 6-bus example with two tie switches.",
  baseMva: 10,
  baseKv: 12.66,
  buses: [
    { name: "1", kind: "slack", loadPkw: 0, loadQkvar: 0 },
    { name: "2", loadPkw: 400, loadQkvar: 250 },
    { name: "3", loadPkw: 500, loadQkvar: 300 },
    { name: "4", loadPkw: 300, loadQkvar: 180 },
    { name: "5", loadPkw: 250, loadQkvar: 150 },
    { name: "6", loadPkw: 200, loadQkvar: 120 },
  ],
  lines: [
    { branch: 1, from: "1", to: "2", rOhm: 0.2, xOhm: 0.12, ratingA: 400, switchType: "sectionalizing" },
    { branch: 2, from: "2", to: "3", rOhm: 0.3, xOhm: 0.18, ratingA: 400, switchType: "sectionalizing" },
    { branch: 3, from: "3", to: "4", rOhm: 0.35, xOhm: 0.2, ratingA: 340, switchType: "sectionalizing" },
    { branch: 4, from: "2", to: "5", rOhm: 0.4, xOhm: 0.22, ratingA: 340, switchType: "sectionalizing" },
    { branch: 5, from: "5", to: "6", rOhm: 0.3, xOhm: 0.16, ratingA: 300, switchType: "sectionalizing" },
    { branch: 6, from: "6", to: "4", rOhm: 0.5, xOhm: 0.3, ratingA: 300, switchType: "tie", initialOpen: true },
    { branch: 7, from: "3", to: "5", rOhm: 0.5, xOhm: 0.3, ratingA: 300, switchType: "tie", initialOpen: true },
  ],
  ders: [{ bus: "6", kind: "pv", pKw: 120 }],
};

export function NetworkImport() {
  const router = useRouter();
  const [text, setText] = useState(JSON.stringify(sampleNetwork, null, 2));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErrors([]);
    setOk(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setErrors(["Body is not valid JSON"]);
        setBusy(false);
        return;
      }
      const response = await fetch("/api/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = (await response.json()) as {
        errors?: string[];
        error?: string;
        network?: { id: number; name: string };
        topology?: { buses: number; branches: number; loops: number };
      };
      if (!response.ok || !data.network) {
        setErrors(data.errors ?? [data.error ?? "Import failed"]);
        setBusy(false);
        return;
      }
      setOk(`Imported ${data.network.name}: ${data.topology?.buses} buses, ${data.topology?.branches} branches, ${data.topology?.loops} loops.`);
      router.refresh();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="file"
          accept="application/json,.json"
          className="input"
          style={{ maxWidth: 280 }}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setText(await file.text());
          }}
        />
        <span className="helper">or paste JSON below. Validation checks connectivity, slack bus, radial initial state and switch definitions.</span>
      </div>
      <textarea className="textarea" rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {errors.length > 0 ? (
        <div className="callout">
          {errors.slice(0, 8).map((e) => (
            <div key={e}>• {e}</div>
          ))}
        </div>
      ) : null}
      {ok ? <div className="callout ok">{ok}</div> : null}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Validating…" : "Validate & import network"}
        </button>
        <button type="button" className="btn" onClick={() => setText(JSON.stringify(sampleNetwork, null, 2))}>
          Load example
        </button>
      </div>
    </div>
  );
}

export function SettingsForm({
  defaults,
}: {
  defaults: RunParams & { solver: SolverId };
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    solver: defaults.solver as string,
    topK: String(defaults.topK),
    iterations: String(defaults.iterations),
    restarts: String(defaults.restarts),
    refinementIterations: String(defaults.refinementIterations),
    derPenetrationPct: String(defaults.derPenetrationPct),
    voltageMin: String(defaults.voltageMin),
    voltageMax: String(defaults.voltageMax),
    maxLoadingPct: String(defaults.maxLoadingPct),
    baselineBranchExchange: defaults.baselineBranchExchange,
    baselineBruteForce: defaults.baselineBruteForce,
  });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        solver: form.solver,
        topK: num(form.topK, 12),
        iterations: num(form.iterations, 6000),
        restarts: num(form.restarts, 3),
        refinementIterations: num(form.refinementIterations, 6),
        derPenetrationPct: num(form.derPenetrationPct, 0),
        voltageMin: num(form.voltageMin, 0.9),
        voltageMax: num(form.voltageMax, 1.05),
        maxLoadingPct: num(form.maxLoadingPct, 100),
        baselineBranchExchange: form.baselineBranchExchange,
        baselineBruteForce: form.baselineBruteForce,
      }),
    });
    setBusy(false);
    setSaved(true);
    router.refresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="grid grid-3">
        <div className="field">
          <label className="label">Default solver</label>
          <select className="select" value={form.solver} onChange={(e) => update("solver", e.target.value)}>
            <option value="simulated-annealing">Simulated annealing</option>
            <option value="quantum-inspired">Quantum-inspired annealer</option>
            <option value="qaoa-simulator">QAOA simulator</option>
            <option value="dwave-hybrid">D-Wave Leap hybrid</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Top-k candidates</label>
          <input className="input" value={form.topK} onChange={(e) => update("topK", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Annealing steps</label>
          <input className="input" value={form.iterations} onChange={(e) => update("iterations", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Restarts</label>
          <input className="input" value={form.restarts} onChange={(e) => update("restarts", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Refinement passes</label>
          <input className="input" value={form.refinementIterations} onChange={(e) => update("refinementIterations", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">DER penetration %</label>
          <input className="input" value={form.derPenetrationPct} onChange={(e) => update("derPenetrationPct", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Voltage min (pu)</label>
          <input className="input" value={form.voltageMin} onChange={(e) => update("voltageMin", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Voltage max (pu)</label>
          <input className="input" value={form.voltageMax} onChange={(e) => update("voltageMax", e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Max loading %</label>
          <input className="input" value={form.maxLoadingPct} onChange={(e) => update("maxLoadingPct", e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 18, fontSize: 12, color: "#8ba0b8" }}>
        <label style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <input type="checkbox" checked={form.baselineBranchExchange} onChange={(e) => update("baselineBranchExchange", e.target.checked)} />
          Run branch-exchange baseline by default
        </label>
        <label style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <input type="checkbox" checked={form.baselineBruteForce} onChange={(e) => update("baselineBruteForce", e.target.checked)} />
          Run brute-force baseline by default
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save defaults"}
        </button>
        {saved ? <span className="badge ok">saved</span> : null}
      </div>
    </div>
  );
}

export function QuickBenchmarkButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = useMemo(() => (busy ? "Running suite…" : "Run benchmark suite"), [busy]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeBaselines: true }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) setError(data.error ?? "Benchmark failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button type="button" className="btn" onClick={run} disabled={busy}>
        {label}
      </button>
      {error ? <span className="helper" style={{ color: "#ffb3bf" }}>{error}</span> : null}
    </div>
  );
}

export function ExportButtons({ runId }: { runId: number }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <a className="btn" href={`/api/runs/${runId}/export?format=csv`}>Export CSV</a>
      <a className="btn" href={`/api/runs/${runId}/export?format=json`}>Export JSON</a>
      <a className="btn" href={`/runs/${runId}/report`}>PDF / print report</a>
    </div>
  );
}
