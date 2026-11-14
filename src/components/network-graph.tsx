import { computeLayout } from "@/lib/viz/layout";

export type GraphBus = { name: string; loadPkw: number; isSlack: boolean };
export type GraphLine = {
  branch: number;
  from: number;
  to: number;
  switchType: string;
  isSwitch: boolean;
};

export function NetworkGraph({
  buses,
  lines,
  openBranches,
  changedBranches = [],
  width = 900,
  height = 560,
  labelMode = "key",
}: {
  buses: GraphBus[];
  lines: GraphLine[];
  openBranches: number[];
  changedBranches?: number[];
  width?: number;
  height?: number;
  labelMode?: "all" | "key";
}) {
  const slack = Math.max(0, buses.findIndex((b) => b.isSlack));
  const { points } = computeLayout(buses.length, lines, slack, width, height);
  const open = new Set(openBranches);
  const changed = new Set(changedBranches);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Distribution network topology"
      >
        <defs>
          <radialGradient id="hub-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0e9384" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0e9384" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={width / 2} cy={height / 2} r={Math.min(width, height) * 0.45} fill="url(#hub-glow)" opacity="0.5" />
        {[0.35, 0.7, 1].map((f) => (
          <circle
            key={f}
            cx={width / 2}
            cy={height / 2}
            r={Math.min(width, height) * 0.43 * f}
            fill="none"
            stroke="#eef0f3"
            strokeDasharray="2 6"
          />
        ))}
        {lines.map((line) => {
          const a = points[line.from];
          const b = points[line.to];
          if (!a || !b) return null;
          const isOpen = open.has(line.branch);
          const isChanged = changed.has(line.branch);
          const isTie = line.switchType === "tie";
          const color = isOpen ? "#d92d20" : isTie ? "#1d4ed8" : line.isSwitch ? "#0e9384" : "#c3cad4";
          return (
            <g key={`l-${line.branch}`}>
              <title>{`${buses[line.from]?.name}–${buses[line.to]?.name} · branch ${line.branch} · ${line.switchType} · ${isOpen ? "open" : "closed"}`}</title>
              {isChanged ? (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#f79009"
                  strokeWidth={6}
                  strokeOpacity={0.22}
                  strokeLinecap="round"
                />
              ) : null}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={isOpen ? 1.6 : isTie ? 2.1 : 1.5}
                strokeDasharray={isOpen ? "4 4" : isTie ? "7 3" : undefined}
                strokeOpacity={isOpen ? 0.85 : 0.95}
                strokeLinecap="round"
              />
            </g>
          );
        })}
        {buses.map((bus, i) => {
          const p = points[i];
          if (!p) return null;
          if (bus.isSlack) {
            return (
              <g key={`b-${bus.name}`}>
                <title>{`${bus.name} · substation (slack)`}</title>
                <rect x={p.x - 9} y={p.y - 9} width={18} height={18} rx={5} fill="#ffffff" stroke="#0e9384" strokeWidth={1.8} />
                <path
                  d={`M ${p.x + 1.5} ${p.y - 5} L ${p.x - 3.5} ${p.y + 1} L ${p.x - 0.5} ${p.y + 1} L ${p.x - 1.5} ${p.y + 5.5} L ${p.x + 4} ${p.y - 1.2} L ${p.x + 0.8} ${p.y - 1.2} Z`}
                  fill="#0e9384"
                />
                <text x={p.x + 12} y={p.y + 3} fontSize={9} fill="#0e9384" fontFamily="ui-monospace, monospace">
                  {bus.name} · substation
                </text>
              </g>
            );
          }
          const r = Math.min(5.5, 2.4 + Math.sqrt(Math.max(0, bus.loadPkw)) / 18);
          const showLabel = labelMode === "all" || i % 6 === 0 || bus.loadPkw > 200;
          return (
            <g key={`b-${bus.name}`}>
              <title>{`Bus ${bus.name} · ${bus.loadPkw.toFixed(1)} kW`}</title>
              <circle cx={p.x} cy={p.y} r={r} fill={bus.loadPkw > 200 ? "#1d4ed8" : "#ffffff"} stroke="#98a2b3" strokeOpacity={0.55} strokeWidth={0.8} />
              {showLabel ? (
                <text x={p.x} y={p.y - r - 3} fontSize={7.5} fill="#98a2b3" textAnchor="middle" fontFamily="ui-monospace, monospace">
                  {bus.name}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ marginTop: 10 }}>
        <span><i style={{ background: "#0e9384" }} />closed sectionalizing switch</span>
        <span><i style={{ background: "#1d4ed8" }} />closed tie switch</span>
        <span><i style={{ background: "#d92d20" }} />open switch</span>
        <span><i style={{ background: "#c3cad4" }} />fixed line</span>
        <span><i style={{ background: "#f79009" }} />changed in plan</span>
        <span>○ bus size ∝ load</span>
      </div>
    </div>
  );
}
