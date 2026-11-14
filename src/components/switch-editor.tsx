"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { computeLayout } from "@/lib/viz/layout";

type Bus = { name: string; loadPkw: number; isSlack: boolean };
type Line = { branch: number; from: number; to: number; switchType: string; isSwitch: boolean };

type Evaluation = {
  radial: boolean;
  edgesClosed: number;
  expectedEdges: number;
  components: number;
  openBranches: number[];
  converged: boolean;
  lossKw: number | null;
  vMin: number;
  vMax: number;
  vMinBus: string;
  maxLoadingPct: number;
  feasible: boolean;
  violation: string | null;
  message: string | null;
};

export function SwitchEditor({
  networkId,
  networkName,
  buses,
  lines,
  initialOpen,
  recommendedOpen,
  recommendedLabel,
}: {
  networkId: number;
  networkName: string;
  buses: Bus[];
  lines: Line[];
  initialOpen: number[];
  recommendedOpen: number[] | null;
  recommendedLabel: string | null;
}) {
  const [open, setOpen] = useState<number[]>(initialOpen);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ label: string; lossKw: number | null; feasible: boolean }[]>([]);

  const evaluate = useCallback(
    async (openBranches: number[], label?: string) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/v1/networks/${networkId}/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ openBranches }),
        });
        const data = (await response.json()) as Evaluation & { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Evaluation failed");
          return;
        }
        setEvaluation(data);
        if (label) {
          setHistory((prev) => [{ label, lossKw: data.lossKw, feasible: data.feasible }, ...prev].slice(0, 6));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [networkId],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void evaluate(initialOpen, "Initial configuration");
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slack = Math.max(0, buses.findIndex((b) => b.isSlack));
  const { points } = useMemo(() => computeLayout(buses.length, lines, slack, 900, 520), [buses, lines, slack]);
  const switchable = lines.filter((l) => l.isSwitch);
  const openSet = new Set(open);
  const toggle = (branch: number) => {
    const next = openSet.has(branch) ? open.filter((b) => b !== branch) : [...open, branch];
    setOpen(next);
    void evaluate(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="grid grid-4">
        <div className="stat">
          <div className="stat-label">Radial spanning tree</div>
          <div className="stat-value" style={{ fontSize: 16, color: evaluation?.radial ? "var(--green)" : "var(--red)" }}>
            {evaluation ? (evaluation.radial ? "valid" : "invalid") : "—"}
          </div>
          <div className="stat-hint">
            {evaluation ? `${evaluation.edgesClosed}/${evaluation.expectedEdges} closed edges · ${evaluation.components} component(s)` : "awaiting evaluation"}
          </div>
        </div>
        <div className="stat accent-cyan">
          <div className="stat-label">Active loss</div>
          <div className="stat-value">{evaluation?.lossKw !== null && evaluation?.lossKw !== undefined ? evaluation.lossKw.toFixed(2) : "—"}<small>kW</small></div>
          <div className="stat-hint">{evaluation?.converged ? "AC sweep converged" : "not converged"}</div>
        </div>
        <div className="stat accent-amber">
          <div className="stat-label">Minimum voltage</div>
          <div className="stat-value">{evaluation ? evaluation.vMin.toFixed(4) : "—"}<small>pu</small></div>
          <div className="stat-hint">{evaluation?.vMinBus ? `bus ${evaluation.vMinBus}` : "—"}</div>
        </div>
        <div className="stat accent-violet">
          <div className="stat-label">Peak loading</div>
          <div className="stat-value">{evaluation ? evaluation.maxLoadingPct.toFixed(1) : "—"}<small>%</small></div>
          <div className="stat-hint">{evaluation?.feasible ? "within limits" : evaluation?.violation ?? "—"}</div>
        </div>
      </div>

      {evaluation && !evaluation.feasible ? (
        <div className="callout">
          {evaluation.message ?? evaluation.violation ?? "Configuration violates the operating limits."} The editor never
          publishes a plan: this state is shown for exploration only.
        </div>
      ) : null}
      {error ? <div className="callout">{error}</div> : null}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">{networkName} — switch state editor</div>
            <div className="panel-sub">Click a switch to open or close it. Every toggle is validated by exact AC power flow.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setOpen(initialOpen); void evaluate(initialOpen, "Reset to initial"); }}>
              Reset to initial
            </button>
            {recommendedOpen ? (
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => { setOpen(recommendedOpen); void evaluate(recommendedOpen, "Recommended plan"); }}>
                Apply {recommendedLabel ?? "recommendation"}
              </button>
            ) : null}
            <a className="btn btn-sm" href={`/networks/${networkId}`}>Feeder detail</a>
          </div>
        </div>
        <div className="panel-body">
          <svg viewBox="0 0 900 520" style={{ width: "100%", height: "auto" }} role="img" aria-label="Interactive network topology">
            <defs>
              <radialGradient id="editor-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={450} cy={260} r={240} fill="url(#editor-glow)" />
            {lines.map((line) => {
              const a = points[line.from];
              const b = points[line.to];
              if (!a || !b) return null;
              const isOpen = openSet.has(line.branch);
              const color = !line.isSwitch ? "#cbd5e1" : isOpen ? "#d92d20" : line.switchType === "tie" ? "#1d4ed8" : "#0e9384";
              return (
                <g
                  key={line.branch}
                  onClick={() => line.isSwitch && toggle(line.branch)}
                  style={{ cursor: line.isSwitch ? "pointer" : "default" }}
                >
                  <title>
                    {`${buses[line.from]?.name}–${buses[line.to]?.name} · branch ${line.branch} · ${line.switchType} · ${isOpen ? "open" : "closed"}${line.isSwitch ? " · click to toggle" : ""}`}
                  </title>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={color}
                    strokeWidth={isOpen ? 2 : 2.4}
                    strokeDasharray={isOpen ? "5 4" : line.switchType === "tie" ? "8 3" : undefined}
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            {buses.map((bus, i) => {
              const p = points[i];
              if (!p) return null;
              return (
                <g key={bus.name}>
                  <title>{`Bus ${bus.name} · ${bus.loadPkw.toFixed(1)} kW`}</title>
                  {bus.isSlack ? (
                    <>
                      <rect x={p.x - 8} y={p.y - 8} width={16} height={16} rx={4} fill="#ffffff" stroke="#0e9384" strokeWidth={1.8} />
                      <text x={p.x + 11} y={p.y + 3} fontSize={8} fill="#0e9384" fontFamily="ui-monospace, monospace">substation</text>
                    </>
                  ) : (
                    <>
                      <circle cx={p.x} cy={p.y} r={Math.min(5, 2.2 + Math.sqrt(bus.loadPkw) / 24)} fill="#ffffff" stroke="#98a2b3" strokeWidth={1} />
                      <text x={p.x} y={p.y - 6} fontSize={7} textAnchor="middle" fill="#98a2b3" fontFamily="ui-monospace, monospace">{bus.name}</text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="legend" style={{ marginTop: 8 }}>
            <span><i style={{ background: "#0e9384" }} />closed switch</span>
            <span><i style={{ background: "#1d4ed8" }} />closed tie</span>
            <span><i style={{ background: "#d92d20" }} />open switch</span>
            <span><i style={{ background: "#cbd5e1" }} />fixed line</span>
            <span>click a switch to toggle</span>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel" style={{ maxHeight: 320, overflow: "auto" }}>
          <div className="panel-head">
            <div className="panel-title">Switch list</div>
            <span className="badge">{open.length} open / {switchable.length}</span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {switchable.map((line) => (
              <button
                key={line.branch}
                type="button"
                className={`chip ${openSet.has(line.branch) ? "open" : "close"}`}
                style={{ cursor: "pointer" }}
                onClick={() => toggle(line.branch)}
              >
                {line.branch}: {buses[line.from]?.name}–{buses[line.to]?.name}
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Exploration history</div>
            <span className="badge">{history.length} evaluated</span>
          </div>
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr><th>Action</th><th className="num">Loss kW</th><th>Feasible</th></tr>
              </thead>
              <tbody>
                {history.length === 0 ? <tr><td colSpan={3} className="helper">Toggle a switch to start recording states.</td></tr> : null}
                {history.map((entry, i) => (
                  <tr key={`${entry.label}-${i}`}>
                    <td>{entry.label}</td>
                    <td className="num">{entry.lossKw === null ? "—" : entry.lossKw.toFixed(2)}</td>
                    <td>{entry.feasible ? <span className="badge ok">yes</span> : <span className="badge bad">no</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
