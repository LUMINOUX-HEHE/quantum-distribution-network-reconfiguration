type Point = { label: string; value: number };

export function VoltageChart({
  profile,
  vmin = 0.9,
  vmax = 1.05,
  compare,
}: {
  profile: { bus: string; v: number }[];
  vmin?: number;
  vmax?: number;
  compare?: { bus: string; v: number }[];
}) {
  if (profile.length === 0) return <div className="helper">No voltage profile available.</div>;
  const width = 720;
  const height = 240;
  const pad = { l: 44, r: 12, t: 14, b: 26 };
  const values = [...profile.map((p) => p.v), ...(compare ?? []).map((p) => p.v), vmin, vmax];
  const lo = Math.min(...values) - 0.006;
  const hi = Math.max(...values) + 0.006;
  const x = (i: number, n: number) => pad.l + (i / Math.max(1, n - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const path = (data: { v: number }[]) =>
    data.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i, data.length).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const minIndex = profile.reduce((best, p, i) => (p.v < profile[best].v ? i : best), 0);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const v = lo + f * (hi - lo);
        return (
          <g key={f}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="#eef0f3" />
            <text x={pad.l - 6} y={y(v) + 3} fontSize={9} textAnchor="end" fill="#98a2b3" fontFamily="ui-monospace, monospace">
              {v.toFixed(3)}
            </text>
          </g>
        );
      })}
      <line x1={pad.l} x2={width - pad.r} y1={y(vmin)} y2={y(vmin)} stroke="#b42318" strokeDasharray="4 4" opacity={0.75} />
      <text x={width - pad.r} y={y(vmin) - 4} fontSize={9} textAnchor="end" fill="#b42318" fontFamily="ui-monospace, monospace">
        limit {vmin.toFixed(2)} pu
      </text>
      {compare ? (
        <path d={path(compare)} fill="none" stroke="#98a2b3" strokeWidth={1.3} strokeDasharray="4 3" opacity={0.9} />
      ) : null}
      <path d={`${path(profile)} L ${x(profile.length - 1, profile.length)} ${height - pad.b} L ${pad.l} ${height - pad.b} Z`} fill="rgba(29,78,216,0.08)" stroke="none" />
      <path d={path(profile)} fill="none" stroke="#1d4ed8" strokeWidth={2} />
      <circle cx={x(minIndex, profile.length)} cy={y(profile[minIndex].v)} r={3.4} fill="#b42318" />
      <text x={x(minIndex, profile.length) + 6} y={y(profile[minIndex].v) - 6} fontSize={9} fill="#ffb3bf" fontFamily="ui-monospace, monospace">
        min {profile[minIndex].v.toFixed(4)} @ bus {profile[minIndex].bus}
      </text>
      {profile.map((p, i) =>
        i % Math.ceil(profile.length / 12) === 0 ? (
          <text key={p.bus} x={x(i, profile.length)} y={height - 8} fontSize={8.5} textAnchor="middle" fill="#98a2b3" fontFamily="ui-monospace, monospace">
            {p.bus}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function LoadingBars({ profile, limit }: { profile: { branch: number; from: string; to: string; pct: number }[]; limit: number }) {
  if (profile.length === 0) return <div className="helper">No loading data available.</div>;
  const rows = profile.slice(0, 10);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => {
        const width = Math.min(100, row.pct);
        const tone = row.pct > limit ? "#b42318" : row.pct > limit * 0.8 ? "#b54708" : "#067647";
        return (
          <div key={row.branch} style={{ display: "grid", gridTemplateColumns: "92px 1fr 52px", gap: 10, alignItems: "center" }}>
            <span className="mono" style={{ fontSize: 10.5, color: "#667085" }}>
              {row.from}–{row.to}
            </span>
            <div style={{ height: 7, borderRadius: 4, background: "#eef0f3", overflow: "hidden" }}>
              <div style={{ width: `${width}%`, height: "100%", background: tone, opacity: 0.85 }} />
            </div>
            <span className="mono" style={{ fontSize: 10.5, textAlign: "right", color: "#344054" }}>
              {row.pct.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function LossComparison({ initial, final }: { initial: number; final: number }) {
  const max = Math.max(initial, final, 1);
  const rows = [
    { label: "Initial configuration", value: initial, color: "#b42318" },
    { label: "Recommended", value: final, color: "#067647" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((row) => (
        <div key={row.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
            <span style={{ color: "#667085" }}>{row.label}</span>
            <span className="mono" style={{ color: "#101828" }}>{row.value.toFixed(2)} kW</span>
          </div>
          <div style={{ height: 12, background: "#eef0f3", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${(row.value / max) * 100}%`, height: "100%", background: row.color, opacity: 0.85 }} />
          </div>
        </div>
      ))}
      <div className="helper">
        Reduction {(initial - final).toFixed(2)} kW · {initial > 0 ? (((initial - final) / initial) * 100).toFixed(2) : "0"}% vs the current state
      </div>
    </div>
  );
}

const solverColors: Record<string, string> = {
  "simulated-annealing": "#067647",
  "quantum-inspired": "#a78bfa",
  "qaoa-simulator": "#1d4ed8",
  "baseline:branch-exchange": "#b54708",
  "baseline:brute-force": "#b42318",
};

export function SolverComparison({
  entries,
}: {
  entries: { solver: string; lossKw: number | null; networkName: string }[];
}) {
  const networks = [...new Set(entries.map((e) => e.networkName))];
  const solvers = [...new Set(entries.map((e) => e.solver))];
  const max = Math.max(...entries.map((e) => e.lossKw ?? 0), 1);
  const width = 720;
  const height = 260;
  const pad = { l: 40, r: 12, t: 16, b: 46 };
  const groupWidth = (width - pad.l - pad.r) / Math.max(1, networks.length);
  const barWidth = Math.min(28, (groupWidth - 20) / Math.max(1, solvers.length));
  const y = (v: number) => pad.t + (1 - v / (max * 1.12)) * (height - pad.t - pad.b);
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
        {[0, 0.5, 1].map((f) => {
          const v = f * max * 1.12;
          return (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="#eef0f3" />
              <text x={pad.l - 6} y={y(v) + 3} fontSize={9} textAnchor="end" fill="#98a2b3" fontFamily="ui-monospace, monospace">
                {v.toFixed(0)}
              </text>
            </g>
          );
        })}
        {networks.map((network, ni) => {
          const base = pad.l + ni * groupWidth + 12;
          return (
            <g key={network}>
              {solvers.map((solver, si) => {
                const entry = entries.find((e) => e.networkName === network && e.solver === solver);
                if (!entry || entry.lossKw === null) return null;
                const h = height - pad.b - y(entry.lossKw);
                return (
                  <g key={solver}>
                    <rect
                      x={base + si * (barWidth + 5)}
                      y={y(entry.lossKw)}
                      width={barWidth}
                      height={Math.max(1, h)}
                      rx={3}
                      fill={solverColors[solver] ?? "#98a2b3"}
                      opacity={0.85}
                    />
                    <text
                      x={base + si * (barWidth + 5) + barWidth / 2}
                      y={y(entry.lossKw) - 4}
                      fontSize={8.5}
                      textAnchor="middle"
                      fill="#667085"
                      fontFamily="ui-monospace, monospace"
                    >
                      {entry.lossKw.toFixed(0)}
                    </text>
                  </g>
                );
              })}
              <text x={base + (groupWidth - 24) / 2} y={height - 24} fontSize={10} textAnchor="middle" fill="#667085">
                {network}
              </text>
              <text x={base + (groupWidth - 24) / 2} y={height - 11} fontSize={8.5} textAnchor="middle" fill="#98a2b3" fontFamily="ui-monospace, monospace">
                loss kW
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {solvers.map((s) => (
          <span key={s}>
            <i style={{ background: solverColors[s] ?? "#98a2b3" }} />
            {s.replace("baseline:", "baseline · ").replace(/-/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ScalingChart({
  entries,
}: {
  entries: { solver: string; busCount: number; runtimeMs: number | null; networkName: string }[];
}) {
  const width = 720;
  const height = 240;
  const pad = { l: 46, r: 16, t: 16, b: 34 };
  const maxBus = Math.max(...entries.map((e) => e.busCount), 10);
  const maxTime = Math.max(...entries.map((e) => e.runtimeMs ?? 0), 100);
  const x = (v: number) => pad.l + (v / (maxBus * 1.15)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / (maxTime * 1.15)) * (height - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={width - pad.r} y1={y(f * maxTime * 1.15)} y2={y(f * maxTime * 1.15)} stroke="#eef0f3" />
          <text x={pad.l - 6} y={y(f * maxTime * 1.15) + 3} fontSize={9} textAnchor="end" fill="#98a2b3" fontFamily="ui-monospace, monospace">
            {(f * maxTime * 1.15).toFixed(0)}
          </text>
        </g>
      ))}
      {entries.map((entry, i) => (
        <g key={`${entry.solver}-${entry.busCount}-${i}`}>
          <circle
            cx={x(entry.busCount)}
            cy={y(entry.runtimeMs ?? 0)}
            r={5}
            fill={solverColors[entry.solver] ?? "#98a2b3"}
            opacity={0.85}
          />
          <text x={x(entry.busCount) + 8} y={y(entry.runtimeMs ?? 0) + 3} fontSize={8.5} fill="#667085" fontFamily="ui-monospace, monospace">
            {entry.networkName.replace("IEEE ", "")} · {(entry.runtimeMs ?? 0).toFixed(0)}ms
          </text>
        </g>
      ))}
      <text x={pad.l} y={height - 10} fontSize={9} fill="#98a2b3" fontFamily="ui-monospace, monospace">
        buses →
      </text>
      <text x={pad.l} y={pad.t - 4} fontSize={9} fill="#98a2b3" fontFamily="ui-monospace, monospace">
        runtime (ms)
      </text>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={x(f * maxBus)} y={height - 10} fontSize={8.5} textAnchor="middle" fill="#98a2b3" fontFamily="ui-monospace, monospace">
          {Math.round(f * maxBus)}
        </text>
      ))}
    </svg>
  );
}

export function Sparkbars({ points }: { points: Point[] }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 72 }}>
      {points.map((p) => (
        <div key={p.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div
            style={{
              width: "100%",
              height: `${Math.max(3, (p.value / max) * 52)}px`,
              background: "linear-gradient(180deg, #067647, #1b7f62)",
              borderRadius: 3,
              opacity: 0.9,
            }}
            title={`${p.label}: ${p.value}`}
          />
          <span style={{ fontSize: 9, color: "#98a2b3", fontFamily: "ui-monospace, monospace" }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

export function ProfileChart({
  points,
  series,
  unit,
  height = 230,
}: {
  points: number[];
  series: { label: string; values: number[]; color: string; dashed?: boolean }[];
  unit?: string;
  height?: number;
}) {
  const width = 720;
  const pad = { l: 40, r: 14, t: 16, b: 30 };
  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all, 1);
  const min = Math.min(0, ...all);
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (height - pad.t - pad.b);
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
        {[0, 0.5, 1].map((f) => {
          const v = min + f * (max - min);
          return (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="#eef0f3" />
              <text x={pad.l - 6} y={y(v) + 3} fontSize={9} textAnchor="end" fill="#98a2b3" fontFamily="ui-monospace, monospace">
                {v.toFixed(0)}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <path
            key={s.label}
            d={s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={1.9}
            strokeDasharray={s.dashed ? "4 3" : undefined}
          />
        ))}
        {points.map((hour, i) =>
          hour % 3 === 0 ? (
            <text key={hour} x={x(i)} y={height - 8} fontSize={8.5} textAnchor="middle" fill="#98a2b3" fontFamily="ui-monospace, monospace">
              {String(hour).padStart(2, "0")}h
            </text>
          ) : null,
        )}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {unit ? <span>{unit}</span> : null}
      </div>
    </div>
  );
}
