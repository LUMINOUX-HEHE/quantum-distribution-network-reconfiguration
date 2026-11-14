import { PageHeader, Panel, Callout } from "@/components/ui";
import { RunForm } from "@/components/client";
import { getSettings, listNetworks } from "@/lib/server/data";
import { SOLVERS } from "@/lib/networks/types";
import { solverAvailability } from "@/lib/optimization/solvers";

export const dynamic = "force-dynamic";

export default async function NewRunPage({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const [networks, defaults, sp] = await Promise.all([listNetworks(), getSettings(), searchParams]);
  const preselected = Number(sp.network);
  const ordered = Number.isFinite(preselected)
    ? [...networks].sort((a, b) => (a.id === preselected ? -1 : b.id === preselected ? 1 : 0))
    : networks;
  const initialNetworkId = ordered[0]?.id;

  const solvers = SOLVERS.map((s) => {
    const availability = solverAvailability(s.id);
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      description: s.description,
      available: availability.available,
      reason: availability.reason,
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Optimisation run"
        title="Configure a reconfiguration run"
        description="Pick a feeder, a solver backend and the formulation controls. The run is queued to an in-process worker and progresses through preprocessing, QUBO construction, solving, repair, AC validation and refinement."
      />

      {solvers.some((s) => !s.available) ? (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="info">
            Cloud backends stay disabled unless their credentials are configured server-side. Nothing secret is ever sent to
            the browser; unavailable adapters show the reason in the solver picker.
          </Callout>
        </div>
      ) : null}

      <RunForm
        networks={ordered.map((n) => ({
          id: n.id,
          name: n.name,
          source: n.source,
          busCount: n.busCount,
          lineCount: n.lineCount,
          switchCount: n.switchCount,
          tieCount: n.tieCount,
          bestKnownLossKw: n.bestKnownLossKw,
        }))}
        solvers={solvers}
        defaults={defaults}
        initialNetworkId={initialNetworkId}
      />

      <div style={{ marginTop: 14 }}>
        <Panel title="Formulation notes" subtitle="Why the pipeline is hybrid">
          <div className="grid grid-3" style={{ fontSize: 12, color: "#8ba0b8", lineHeight: 1.6 }}>
            <div>
              <strong style={{ color: "#e6edf6" }}>Loop-based variables.</strong> Only switchable branches become decision
              variables. The one-hot group per fundamental loop shrinks the space from 2^n to the product of loop sizes and
              removes most of the radiality penalty terms.
            </div>
            <div>
              <strong style={{ color: "#e6edf6" }}>Surrogate, not truth.</strong> The QUBO minimises a quadratic
              LinDistFlow loss approximation. It is deliberately imperfect — connectivity, voltage and loading are judged
              only by exact AC power flow.
            </div>
            <div>
              <strong style={{ color: "#e6edf6" }}>Termination.</strong> The refinement stage warm-starts a classical
              exchange search from the best feasible sample and refreshes the loss coefficients from the power-flow solution
              each iteration.
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
