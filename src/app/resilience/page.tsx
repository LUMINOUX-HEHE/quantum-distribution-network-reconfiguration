import { PageHeader, Panel, Stat } from "@/components/ui";
import { FaultStudio } from "@/components/study-forms";
import { listNetworks, loadNetworkRows } from "@/lib/server/data";
import { listFaultStudies } from "@/lib/server/resilience";
import { buildModel } from "@/lib/power/model";

export const dynamic = "force-dynamic";

export default async function ResiliencePage() {
  const [networks, studies] = await Promise.all([listNetworks(), listFaultStudies(12)]);
  const branches: Record<string, { branch: number; from: string; to: string; switchType: string }[]> = {};
  for (const network of networks) {
    const rows = await loadNetworkRows(network.id);
    if (!rows) continue;
    const model = buildModel(rows, 0);
    branches[String(network.id)] = model.lines
      .filter((l) => l.isSwitch)
      .map((l) => ({
        branch: l.branch,
        from: model.buses[l.from].name,
        to: model.buses[l.to].name,
        switchType: l.switchType,
      }));
  }
  const last = studies[0];
  const summary = (last?.summary ?? {}) as {
    totals?: { studied?: number; unrestorable?: number; averageRestoredPct?: number; criticalLoadAtRiskKw?: number };
  };

  return (
    <div>
      <PageHeader
        eyebrow="Resilience"
        title="Fault isolation, restoration and contingency analysis"
        description="Simulate line and switch failures, isolate the de-energised section, search alternative supply routes that preserve radiality, prioritise critical load and validate the restored state with AC power flow. N-1 scans cover every switchable branch."
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Studies recorded" value={studies.length} hint="persisted with results" />
        <Stat label="Last study faults" value={summary.totals?.studied ?? "—"} hint={last ? new Date(last.createdAt).toISOString().slice(0, 16).replace("T", " ") : "no study yet"} tone="cyan" />
        <Stat label="Average restored" value={summary.totals?.averageRestoredPct !== undefined ? `${summary.totals.averageRestoredPct}%` : "—"} hint="load recovery via transfers" tone="violet" />
        <Stat label="Critical load at risk" value={summary.totals?.criticalLoadAtRiskKw ?? "—"} unit="kW" hint="remaining shed on critical buses" tone="amber" />
      </div>

      <Panel title="Fault studio" subtitle="Line failure, switch failure and full N-1 contingency scan">
        <FaultStudio networks={networks.map((n) => ({ id: n.id, name: n.name }))} branches={branches} />
      </Panel>

      <div style={{ marginTop: 14 }}>
        <Panel title="Study history" subtitle="Restoration outcomes are stored for audit and comparison" noBody>
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Study</th>
                  <th>Feeder</th>
                  <th>Label</th>
                  <th>Kind</th>
                  <th className="num">Faults</th>
                  <th className="num">Restored avg</th>
                  <th className="num">At risk kW</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {studies.length === 0 ? (
                  <tr><td colSpan={8} className="helper">No fault studies recorded. Run an N-1 scan above.</td></tr>
                ) : null}
                {studies.map((study) => {
                  const totals = (study.summary as { totals?: { studied?: number; averageRestoredPct?: number; criticalLoadAtRiskKw?: number } })?.totals;
                  return (
                    <tr key={study.id}>
                      <td className="num">#{study.id}</td>
                      <td>{networks.find((n) => n.id === study.networkId)?.name ?? `#${study.networkId}`}</td>
                      <td>{study.label}</td>
                      <td><span className="badge">{study.kind}</span></td>
                      <td className="num">{totals?.studied ?? "—"}</td>
                      <td className="num">{totals?.averageRestoredPct ?? "—"}%</td>
                      <td className="num">{totals?.criticalLoadAtRiskKw ?? "—"}</td>
                      <td className="helper">{new Date(study.createdAt).toISOString().slice(0, 16).replace("T", " ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
