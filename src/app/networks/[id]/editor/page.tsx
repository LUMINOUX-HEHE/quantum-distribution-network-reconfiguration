import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel, Callout } from "@/components/ui";
import { SwitchEditor } from "@/components/switch-editor";
import { loadNetworkRows } from "@/lib/server/data";
import { buildModel } from "@/lib/power/model";
import { latestRecommendation } from "@/lib/server/resilience";

export const dynamic = "force-dynamic";

export default async function NetworkEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const networkId = Number(id);
  if (!Number.isFinite(networkId)) notFound();
  const rows = await loadNetworkRows(networkId);
  if (!rows) notFound();
  const model = buildModel(rows, 0);
  const recommendation = await latestRecommendation(networkId);
  const recommendedOpen = recommendation?.openSwitches
    ? model.lines.filter((l) => recommendation.openSwitches.includes(l.index)).map((l) => l.branch)
    : null;

  return (
    <div>
      <PageHeader
        eyebrow="Digital twin · switch state editor"
        title={`${rows.name} — topology editor`}
        description="Explore the feasible operating space directly: open and close sectionalising and tie switches, and see radiality, exact AC loss, minimum voltage and peak loading for every state. Saved optimisation recommendations can be applied for comparison."
        actions={
          <>
            <Link className="btn" href={`/networks/${networkId}`}>Topology detail</Link>
            <Link className="btn btn-primary" href={`/runs/new?network=${networkId}`}>Optimise this feeder</Link>
          </>
        }
      />

      <SwitchEditor
        networkId={networkId}
        networkName={rows.name}
        buses={model.buses.map((b) => ({ name: b.name, loadPkw: b.loadPkw, isSlack: b.isSlack }))}
        lines={model.lines.map((l) => ({ branch: l.branch, from: l.from, to: l.to, switchType: l.switchType, isSwitch: l.isSwitch }))}
        initialOpen={model.lines.filter((l) => l.initialOpen).map((l) => l.branch)}
        recommendedOpen={recommendedOpen}
        recommendedLabel={recommendation ? `run #${recommendation.runId}` : null}
      />

      <div style={{ marginTop: 14 }}>
        <Callout tone="info">
          Editing is a study tool. Any configuration you build here is advisory: final plans are produced by the hybrid
          optimiser, validated by AC power flow and recorded in the audit trail.
        </Callout>
      </div>
    </div>
  );
}
