import { PageHeader, Panel, Stat } from "@/components/ui";
import { ScenarioStudio } from "@/components/study-forms";
import { listNetworks } from "@/lib/server/data";
import { latestRecommendation, listScenarios } from "@/lib/server/resilience";

export const dynamic = "force-dynamic";

export default async function ScenariosPage() {
  const [networks, scenarios] = await Promise.all([listNetworks(), listScenarios()]);
  const recommended: Record<string, { label: string; openSet: number[] } | null> = {};
  for (const network of networks) {
    const rec = await latestRecommendation(network.id);
    recommended[String(network.id)] = rec
      ? { label: `Recommended (run #${rec.runId})`, openSet: rec.openSwitches ?? [] }
      : null;
  }
  const derNameplate = 0;

  return (
    <div>
      <PageHeader
        eyebrow="Renewable scenarios"
        title="Scenario management and curtailment analysis"
        description="Sweep solar and wind availability, weather, season and demand across a horizon. The evaluation reports hourly losses, worst-case voltage and loading, curtailed DER energy and utilisation — comparing the current configuration against the latest validated recommendation."
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Saved scenarios" value={scenarios.length} hint="weather / season / load sets" />
        <Stat label="Feeders covered" value={new Set(scenarios.map((s) => s.networkId)).size} hint="across the network library" tone="cyan" />
        <Stat label="Recommendations linked" value={Object.values(recommended).filter(Boolean).length} hint="used for robust comparison" tone="violet" />
        <Stat label="Default horizon" value="24 h" hint={`DER nameplate ${derNameplate || "per feeder"}`} tone="amber" />
      </div>

      <Panel title="Scenario workspace" subtitle="Weather, demand and variability controls with live evaluation">
        <ScenarioStudio networks={networks.map((n) => ({ id: n.id, name: n.name }))} recommended={recommended} />
      </Panel>

      <div style={{ marginTop: 14 }}>
        <Panel title="Scenario library" subtitle="Stored scenario sets" noBody>
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">ID</th>
                  <th>Name</th>
                  <th>Feeder</th>
                  <th>Kind</th>
                  <th>Season</th>
                  <th>Weather</th>
                  <th className="num">Cloud</th>
                  <th className="num">Wind m/s</th>
                  <th className="num">Load ×</th>
                  <th>Created by</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.length === 0 ? (
                  <tr><td colSpan={10} className="helper">No saved scenarios yet — configure a sweep above and save it.</td></tr>
                ) : null}
                {scenarios.map((s) => (
                  <tr key={s.id}>
                    <td className="num">#{s.id}</td>
                    <td>{s.name}</td>
                    <td>{networks.find((n) => n.id === s.networkId)?.name ?? `#${s.networkId}`}</td>
                    <td><span className="badge">{s.kind}</span></td>
                    <td>{s.config.season}</td>
                    <td>{s.config.weather}</td>
                    <td className="num">{Math.round(s.config.cloudCover * 100)}%</td>
                    <td className="num">{s.config.windSpeed}</td>
                    <td className="num">{s.config.loadMultiplier}</td>
                    <td className="helper">{s.createdBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
