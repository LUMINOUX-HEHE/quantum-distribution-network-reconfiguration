import Link from "next/link";
import { PageHeader, Panel, Stat, fmt, fmtInt } from "@/components/ui";
import { NetworkImport } from "@/components/client";
import { listNetworks } from "@/lib/server/data";
import { NetworkGraph } from "@/components/network-graph";
import { buildModel, initialOpenSet } from "@/lib/power/model";
import { loadNetworkRows } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function NetworksPage() {
  const networks = await listNetworks();
  const previews = await Promise.all(
    networks.slice(0, 4).map(async (network) => {
      const rows = await loadNetworkRows(network.id);
      if (!rows) return null;
      const model = buildModel(rows, 0);
      const open = initialOpenSet(model);
      return {
        id: network.id,
        buses: model.buses.map((b) => ({ name: b.name, loadPkw: b.loadPkw, isSlack: b.isSlack })),
        lines: model.lines.map((l) => ({
          branch: l.branch,
          from: l.from,
          to: l.to,
          switchType: l.switchType,
          isSwitch: l.isSwitch,
        })),
        openBranches: model.lines.filter((l) => open.has(l.index)).map((l) => l.branch),
      };
    }),
  );

  const totalBuses = networks.reduce((a, n) => a + n.busCount, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Network library"
        title="Feeder models and validated imports"
        description="Built-in IEEE 33-bus and 69-bus benchmarks plus custom CSV/JSON imports. Import validation checks connectivity from the substation, single slack bus, numeric branch data, switch definitions and the radial edge count of the initial state."
        actions={<Link className="btn" href="/runs/new">Configure a run</Link>}
      />

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <Stat label="Networks" value={networks.length} hint={`${totalBuses} buses modelled`} />
        <Stat label="Switchable branches" value={fmtInt(networks.reduce((a, n) => a + n.switchCount, 0))} hint="decision variables before contraction" tone="cyan" />
        <Stat label="Independent loops" value={fmtInt(networks.reduce((a, n) => a + n.tieCount, 0))} hint="one-hot groups in the QUBO" tone="violet" />
        <Stat label="Reference optima" value={networks.filter((n) => n.bestKnownLossKw).length} hint="stored for gap reporting" tone="amber" />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        {networks.map((network) => {
          const preview = previews.find((p) => p?.id === network.id);
          return (
            <Panel
              key={network.id}
              title={network.name}
              subtitle={`${network.source} · ${network.baseKv} kV · ${network.baseMva} MVA`}
              actions={<Link className="btn btn-ghost" href={`/networks/${network.id}`}>Open →</Link>}
            >
              {preview ? (
                <div style={{ marginBottom: 10 }}>
                  <NetworkGraph
                    buses={preview.buses}
                    lines={preview.lines}
                    openBranches={preview.openBranches}
                    width={760}
                    height={330}
                  />
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <span className="badge info">{network.busCount} buses</span>
                <span className="badge info">{network.lineCount} branches</span>
                <span className="badge violet">{network.switchCount} switches</span>
                <span className="badge warn">{network.tieCount} ties</span>
                <span className="badge ok">{network.bestKnownLossKw ? `${fmt(network.bestKnownLossKw)} kW reference` : "no reference"}</span>
              </div>
              <p className="helper" style={{ marginBottom: 10 }}>{network.description}</p>
              <div style={{ display: "flex", gap: 8 }}>
                <Link className="btn btn-primary" href={`/runs/new?network=${network.id}`}>Optimize</Link>
                <Link className="btn" href={`/networks/${network.id}`}>Topology & loops</Link>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel
        title="Import a custom network"
        subtitle="JSON with buses, lines, switches and DERs — validated before it is stored"
      >
        <NetworkImport />
      </Panel>
    </div>
  );
}
