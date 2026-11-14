import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

const SLIDES = [
  {
    title: "Problem",
    points: [
      "DER growth makes distribution power flow bidirectional and volatile.",
      "Reconfiguration chooses switch states: 2^n raw combinations, most non-radial.",
      "Operators need loss-optimal, voltage-safe plans fast enough to act on.",
    ],
  },
  {
    title: "Approach",
    points: [
      "Formulate reconfiguration as a loop-encoded QUBO on a LinDistFlow loss surrogate.",
      "Let quantum / quantum-inspired solvers propose the top-k candidates.",
      "Repair each proposal to a spanning tree and adjudicate with exact AC power flow.",
    ],
  },
  {
    title: "Formulation",
    points: [
      "One binary per candidate open switch inside each fundamental loop.",
      "Objective: quadratic loss deltas plus cross-loop interactions.",
      "Constraint: auto-tuned one-hot penalty; voltage and loading left to physics.",
    ],
  },
  {
    title: "Solvers",
    points: [
      "Simulated annealing, quantum-inspired parallel tempering, genetic algorithm.",
      "QAOA statevector simulator (≤10 qubits) with OpenQASM export for Qiskit Aer.",
      "D-Wave adapter slot gated on server-side credentials with graceful fallback.",
    ],
  },
  {
    title: "Adjudication",
    points: [
      "Island reconnection and cycle breaking produce a spanning tree.",
      "Exact backward/forward sweep reports true loss, Vmin and peak loading.",
      "Only feasible configurations can be published as a recommendation.",
    ],
  },
  {
    title: "Results — IEEE 33-bus",
    points: [
      "202.68 kW → 139.55 kW, a 31.1% reduction.",
      "Open set {7, 9, 14, 32, 37} matches the published optimum.",
      "Gap to reference 0.00%; runtime under one second locally.",
    ],
  },
  {
    title: "Results — IEEE 69-bus & 119-bus",
    points: [
      "69-bus: 224.99 kW → 66.11 kW (70.6%) on the bundled five-tie set.",
      "Synthetic 119-bus: 83.92 kW → 46.51 kW (44.6%) in about three seconds.",
      "Scaling behaviour and memory reported in docs/PERFORMANCE.md.",
    ],
  },
  {
    title: "Resilience",
    points: [
      "Line, switch-open and switch-closed failure simulation with island detection.",
      "Transfer search prioritises critical load and preserves radiality.",
      "N-1 scan of 37 branches: 96.9% average load restoration, every plan AC-validated.",
    ],
  },
  {
    title: "Renewable intelligence",
    points: [
      "Solar, wind and demand profiles with weather, season and cloud controls.",
      "Curtailed energy reported explicitly rather than hidden in averages.",
      "Robust comparison ranks configurations by worst-case loss and feasibility.",
    ],
  },
  {
    title: "Governance",
    points: [
      "Signed sessions with viewer, engineer and admin roles.",
      "Every mutation audited; API versioned; rate limits per actor.",
      "Run records store seed, parameters, solver version and signature.",
    ],
  },
  {
    title: "Honest comparison",
    points: [
      "Classical branch exchange reaches the same 33-bus optimum in milliseconds.",
      "No quantum advantage is claimed: the value is feasibility guarantees and reproducibility.",
      "Partial substitutions are documented rather than glossed over.",
    ],
  },
  {
    title: "Next steps",
    points: [
      "Unbalanced three-phase modelling and transformer tap representation.",
      "Feeder decomposition for networks beyond ~1 000 buses.",
      "Hardware runs (D-Wave Leap, gate-based) against the same benchmark harness.",
    ],
  },
];

export default function PresentationPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Final delivery"
        title="Project presentation and demonstration"
        description="A printable deck summarising problem, approach, results and limitations, together with the demonstration script. Use the browser print dialog to export a PDF for the review pack."
        actions={
          <>
            <Link className="btn" href="/progress">Program status</Link>
            <Link className="btn btn-primary" href="/">Open the console</Link>
          </>
        }
      />

      <div className="grid grid-2">
        {SLIDES.map((slide, i) => (
          <Panel
            key={slide.title}
            title={`${String(i + 1).padStart(2, "0")} · ${slide.title}`}
            subtitle={`Slide ${i + 1} of ${SLIDES.length}`}
          >
            <ul className="doc-list">
              {slide.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel title="Demonstration script" subtitle="Five-minute walkthrough used in the recorded walkthrough">
          <ol className="doc-list" style={{ paddingLeft: 20 }}>
            <li>Overview: pipeline strip, capabilities and benchmark headline metrics.</li>
            <li>Benchmarks: run a comparison suite and read the loss-by-method chart.</li>
            <li>Run detail: before/after topology, switching plan, voltage profile, candidate table.</li>
            <li>Topology editor: toggle switches and watch radiality, loss and voltage react live.</li>
            <li>Resilience: run an N-1 scan and inspect one validated restoration plan.</li>
            <li>Scenarios: storm weather sweep with curtailment and robust comparison.</li>
            <li>Program status and documentation: evidence for every checklist item.</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}
