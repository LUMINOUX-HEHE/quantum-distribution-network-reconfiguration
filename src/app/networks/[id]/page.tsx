import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel, Stat, fmt, pct } from "@/components/ui";
import { NetworkGraph } from "@/components/network-graph";
import { VoltageChart, LoadingBars } from "@/components/charts";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel, initialOpenSet } from "@/lib/power/model";
import { findLoops } from "@/lib/power/topology";
import { evaluateConfiguration } from "@/lib/optimization/baselines";

export const dynamic = "force-dynamic";

export default async function NetworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const networkId = Number(id);
  if (!Number.isFinite(networkId)) notFound();
  const rows = await loadNetworkRows(networkId);
  if (!rows) notFound();

  const model = buildModel(rows, 0);
  const topology = findLoops(model);
  const open = initialOpenSet(model);
  const initial = evaluateConfiguration(model, open, { voltageMin: 0.9, voltageMax: 1.05, maxLoadingPct: 100 });
  const openBranches = model.lines.filter((l) => open.has(l.index)).map((l) => l.branch);
  const derTotal = rows.ders.reduce((a, d) => a + d.pKw, 0);

  return (
    <div>
      <PageHeader
        eyebrow={`${rows.source} · ${rows.baseKv} kV feeder`}
        title={rows.name}
        description={rows.description || "Custom imported distribution network."}
        actions={
          <>
            <Link className="btn" href="/networks">Library</Link>
            <Link className="btn" href={`/networks/${networkId}/editor`}>Switch editor</Link>
            <Link className="btn btn-primary" href={`/runs/new?network=${networkId}`}>Optimize this feeder</Link>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <Stat label="Initial active loss" value={fmt(initial.lossKw)} unit="kW" hint="backward/forward sweep AC" />
        <Stat label="Minimum voltage" value={initial.vMin.toFixed(4)} unit="pu" hint="limit 0.90 pu" tone="cyan" />
        <Stat label="Peak line loading" value={fmt(initial.maxLoadingPct, 1)} unit="%" hint="of branch ampacity" tone="amber" />
        <Stat
          label="Reference optimum"
          value={rows.bestKnownLossKw ? fmt(rows.bestKnownLossKw) : "—"}
          unit="kW"
          hint={rows.bestKnownLossKw && initial.lossKw ? `${pct(((initial.lossKw - rows.bestKnownLossKw) / initial.lossKw) * 100)} headroom` : "no stored reference"}
          tone="violet"
        />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <Panel title="Topology — initial configuration" subtitle="Open switches dashed red, closed ties cyan, fixed lines grey" actions={<span className="badge warn">{openBranches.length} open</span>}>
          <NetworkGraph
            buses={model.buses.map((b) => ({ name: b.name, loadPkw: b.loadPkw, isSlack: b.isSlack }))}
            lines={model.lines.map((l) => ({ branch: l.branch, from: l.from, to: l.to, switchType: l.switchType, isSwitch: l.isSwitch }))}
            openBranches={openBranches}
            width={800}
            height={480}
          />
        </Panel>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel title="Voltage profile — initial state" subtitle={`Minimum ${initial.vMin.toFixed(4)} pu · converged AC solution`}>
            <VoltageChart profile={initial.voltageProfile} vmin={0.9} vmax={1.05} />
          </Panel>
          <Panel title="Most loaded branches" subtitle="Current relative to ampacity">
            <LoadingBars profile={initial.loadingProfile} limit={100} />
          </Panel>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <Panel
          title="Fundamental loops"
          subtitle={`${topology.loops.length} independent loops · one-hot QUBO groups`}
          actions={<span className="badge violet">{topology.switchableCount} switchable</span>}
        >
          <div style={{ display: "grid", gap: 10 }}>
            {topology.loops.map((loop) => (
              <div key={loop.index} className="loop-card">
                <div className="loop-title">
                  <span>Loop {loop.index + 1} · chord {model.lines[loop.chord].branch} ({loop.label})</span>
                  <span>{loop.options.length} options</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                  {loop.options.map((lineIndex) => {
                    const line = model.lines[lineIndex];
                    const isOpen = open.has(lineIndex);
                    return (
                      <span key={lineIndex} className={`chip ${isOpen ? "open" : "close"}`}>
                        {line.branch}:{model.buses[line.from].name}–{model.buses[line.to].name}
                        {line.switchType === "tie" ? " tie" : ""}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel title="Model summary" subtitle="Contraction and scaling">
            <dl>
              <div className="kv"><dt>Buses / lines</dt><dd>{model.buses.length} / {model.lines.length}</dd></div>
              <div className="kv"><dt>Slack bus</dt><dd>{model.buses[model.slack].name}</dd></div>
              <div className="kv"><dt>Contracted lines</dt><dd>{topology.contractedCount}</dd></div>
              <div className="kv"><dt>Required open branches</dt><dd>{topology.requiredOpenCount}</dd></div>
              <div className="kv"><dt>Total load</dt><dd>{fmt(model.totalLoadKw, 1)} kW</dd></div>
              <div className="kv"><dt>DER nameplate</dt><dd>{fmt(derTotal, 1)} kW ({rows.ders.length} units)</dd></div>
              <div className="kv"><dt>Raw switch space</dt><dd>2^{topology.switchableCount}</dd></div>
              <div className="kv"><dt>Loop-one-hot space</dt><dd>{topology.loops.reduce((a, l) => a * l.options.length, 1).toLocaleString()} assignments</dd></div>
            </dl>
          </Panel>
          <Panel title="DER placements" subtitle="Scaled by the DER penetration scenario parameter">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {rows.ders.map((d, i) => (
                <span key={`${d.bus}-${i}`} className="chip close">bus {d.bus} · {d.pKw} kW</span>
              ))}
              {rows.ders.length === 0 ? <span className="helper">No distributed sources in this dataset.</span> : null}
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Branches" subtitle="Impedance, ampacity and switch metadata" noBody>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th className="num">Branch</th>
                <th>From</th>
                <th>To</th>
                <th className="num">R (Ω)</th>
                <th className="num">X (Ω)</th>
                <th className="num">Rating (A)</th>
                <th>Type</th>
                <th>Initial</th>
              </tr>
            </thead>
            <tbody>
              {model.lines.map((l) => (
                <tr key={l.index}>
                  <td className="num">{l.branch}</td>
                  <td>{model.buses[l.from].name}</td>
                  <td>{model.buses[l.to].name}</td>
                  <td className="num">{(l.rPu * ((rows.baseKv * rows.baseKv) / rows.baseMva)).toFixed(4)}</td>
                  <td className="num">{(l.xPu * ((rows.baseKv * rows.baseKv) / rows.baseMva)).toFixed(4)}</td>
                  <td className="num">{l.ratingA}</td>
                  <td><span className={`badge ${l.switchType === "tie" ? "info" : l.isSwitch ? "" : "warn"}`}>{l.switchType}</span></td>
                  <td><span className={`chip ${open.has(l.index) ? "open" : "close"}`}>{open.has(l.index) ? "open" : "closed"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
