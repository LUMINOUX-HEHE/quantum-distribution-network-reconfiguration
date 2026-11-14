# Test report

Harness: `npx tsx scripts/test-suite.ts` — pure-core regression suite (no database or HTTP required).

**20 passed, 0 failed** at 2026-11-14T06:30:06.645Z

| Test | Observed result |
|---|---|
| AC power flow reproduces IEEE 33-bus reference | 202.677 kW, Vmin 0.9131 pu |
| AC power flow reproduces IEEE 69-bus reference | 224.992 kW, Vmin 0.9092 pu |
| Loop discovery finds five independent loops on both benchmarks | 5 loops each; one-hot groups sized by switchable branches |
| Topology validation rejects non-radial configurations | tie closure without an opening is rejected |
| Repair restores a spanning tree from an invalid candidate | 2 repair action(s) |
| Import validator rejects disconnected networks | 1 validation error(s) reported |
| QUBO construction is complete and one-hot penalised | 64 variables, 1580 quadratic terms, λ=1793.5 |
| Simulated annealing, genetic algorithm and quantum-inspired solvers return decodable samples | three solvers produce one selection per loop |
| QAOA simulator respects its qubit budget and decodes answers | 10 qubits, 108 parameter evaluations |
| Hybrid pipeline reproduces the IEEE 33-bus optimum | 202.68 → 139.55 kW (31.1%), gap 0.00% |
| Optimisation is reproducible for a fixed seed | identical open set 7,9,14,32,37 |
| Voltage/loading band is enforced when limits tighten | strict 0.99 pu band rejects the initial configuration |
| MILP assignment baseline and branch exchange agree on feasibility | branch exchange 141.204 kW, MILP/B&B 141.916 kW |
| Brute force confirms the loop-space optimum on the 33-bus feeder | 200000 combinations, best 139.551 kW |
| Line failure is isolated and an alternative supply route is validated | section 8–9, restored 100% with 1 action(s) |
| N-1 contingency scan covers switchable branches | 37 contingencies, avg restored 96.9% |
| Renewable profiles respect physical bounds | solar night=0, noon high; wind cut-in/cut-out enforced; evening peak |
| Scenario sweep reports losses, curtailment and feasibility | 223.4 kW avg loss, utilisation 79.8%, 17/24 feasible |
| Synthetic 119-bus feeder is radial, solvable and bounded by the timeout | 119 buses, 83.9 → 46.5 kW in 3277 ms |
| IEEE 69-bus pipeline reduces loss beyond 40% | 225.0 → 66.11 kW (70.6%) |

## Known limitations

- The QUBO is a surrogate; only AC-validated configurations are ever recommended.
- QAOA is simulated in-process (no Qiskit runtime in this deployment) and truncated to 10 qubits.
- D-Wave submission is intentionally disabled; the adapter is availability-gated and falls back to local annealing.
- The 69-bus reference optimum is specific to the bundled five-tie dataset (66.11 kW); the literature 98–99 kW figure uses a different tie set.
- Scenario sweeps run sequentially; very large horizons are bounded by the request timeout rather than parallel workers.
