import Link from "next/link";
import { notFound } from "next/navigation";
import { fmt, pct } from "@/components/ui";
import { NetworkGraph } from "@/components/network-graph";
import { VoltageChart } from "@/components/charts";
import { getRunDetail } from "@/lib/server/runs";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel } from "@/lib/power/model";
import type { SwitchingStep } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function RunReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isFinite(runId)) notFound();
  const detail = await getRunDetail(runId);
  if (!detail) notFound();
  const rows = await loadNetworkRows(detail.run.networkId);
  if (!rows) notFound();
  const result = detail.result;
  if (!result) {
    return (
      <div className="panel">
        <div className="panel-body">This run has no validated results yet. Return to the run page and wait for completion.</div>
      </div>
    );
  }
  const model = buildModel(rows, Number((detail.run.params as { derPenetrationPct?: number })?.derPenetrationPct ?? 0));
  const initialOpenBranches = model.lines.filter((l) => l.initialOpen).map((l) => l.branch);
  const rec = detail.candidates.find((c) => c.id === result.recommendedCandidateId);
  const recBranches = (rec?.openSwitches ?? []).map((i) => model.lines[i]?.branch);
  const plan = (result.switchingPlan ?? []) as SwitchingStep[];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }} className="no-print">
        <Link className="btn" href={`/runs/${detail.run.id}`}>← Back to run</Link>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn" href={`/api/runs/${detail.run.id}/export?format=json`}>JSON</a>
          <a className="btn" href={`/api/runs/${detail.run.id}/export?format=csv`}>CSV</a>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 14, marginBottom: 18 }}>
        <div className="eyebrow">QA-DNR · reconfiguration summary</div>
        <h1 className="page-title">{rows.name} — run #{detail.run.id}</h1>
        <div className="page-desc">
          Solver {detail.run.solver} · seed {detail.run.seed} · generated {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC ·
          advisory only, validated with AC power flow
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="stat-label">Initial loss</div><div className="stat-value">{fmt(result.initialLossKw)}<small>kW</small></div></div>
        <div className="stat"><div className="stat-label">Recommended loss</div><div className="stat-value">{fmt(result.finalLossKw)}<small>kW</small></div></div>
        <div className="stat"><div className="stat-label">Reduction</div><div className="stat-value">{pct(result.lossReductionPct)}</div></div>
        <div className="stat"><div className="stat-label">Gap to reference</div><div className="stat-value">{result.gapToBestKnownPct !== null ? pct(result.gapToBestKnownPct) : "—"}</div></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Current configuration</div></div>
          <div className="panel-body">
            <NetworkGraph
              buses={model.buses.map((b) => ({ name: b.name, loadPkw: b.loadPkw, isSlack: b.isSlack }))}
              lines={model.lines.map((l) => ({ branch: l.branch, from: l.from, to: l.to, switchType: l.switchType, isSwitch: l.isSwitch }))}
              openBranches={initialOpenBranches}
              width={800}
              height={420}
            />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Recommended configuration</div></div>
          <div className="panel-body">
            <NetworkGraph
              buses={model.buses.map((b) => ({ name: b.name, loadPkw: b.loadPkw, isSlack: b.isSlack }))}
              lines={model.lines.map((l) => ({ branch: l.branch, from: l.from, to: l.to, switchType: l.switchType, isSwitch: l.isSwitch }))}
              openBranches={recBranches.filter((b): b is number => typeof b === "number")}
              width={800}
              height={420}
            />
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head"><div className="panel-title">Switching plan</div></div>
        <div className="panel-body">
          <table className="data">
            <thead>
              <tr><th className="num">#</th><th>Action</th><th>Branch</th><th>Section</th><th>Type</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {plan.length === 0 ? <tr><td colSpan={6}>No switching operations required.</td></tr> : null}
              {plan.map((s) => (
                <tr key={`${s.step}-${s.branch}`}>
                  <td className="num">{s.step}</td>
                  <td>{s.action}</td>
                  <td className="num">{s.branch}</td>
                  <td>{s.fromBus}–{s.toBus}</td>
                  <td>{s.switchType}</td>
                  <td className="helper">{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Voltage profile</div></div>
          <div className="panel-body">
            <VoltageChart profile={result.finalVoltageProfile ?? []} compare={result.initialVoltageProfile ?? []} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Validation summary</div></div>
          <div className="panel-body">
            <dl>
              <div className="kv"><dt>Recommended Vmin</dt><dd>{result.finalVmin?.toFixed(4)} pu</dd></div>
              <div className="kv"><dt>Initial Vmin</dt><dd>{result.initialVmin?.toFixed(4)} pu</dd></div>
              <div className="kv"><dt>Peak loading</dt><dd>{fmt(result.finalMaxLoadingPct, 1)}%</dd></div>
              <div className="kv"><dt>Raw feasibility</dt><dd>{pct(result.feasibilityRate * 100)}</dd></div>
              <div className="kv"><dt>Runtime</dt><dd>{result.runtimeMs} ms</dd></div>
              <div className="kv"><dt>Open switches</dt><dd>{recBranches.join(", ") || "—"}</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
