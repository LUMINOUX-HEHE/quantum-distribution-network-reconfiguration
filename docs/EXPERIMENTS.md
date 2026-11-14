# Experiment log

| # | Experiment | Outcome |
|---|---|---|
| 1 | Backward/forward sweep against published 33/69-bus initial losses | Success — matches within 0.02 kW |
| 2 | Reactive current sign in the sweep | Failed initially (Vmin 0.974 pu instead of 0.913); fixed by correcting `conj(S/V)` |
| 3 | 69-bus dataset from a memorised branch list | Failed — initial loss 1 243 kW, far from the 225 kW reference; replaced with MATPOWER-derived data |
| 4 | One-open-switch-per-loop branch exchange | Failure — stalled at 146.7 kW and 66.1 kW; unrestricted single-switch swaps reach 139.55 kW |
| 5 | Pair-exchange polish | Success as a safeguard; no improvement over unrestricted exchange on these feeders |
| 6 | QAOA on the full 33-bus QUBO | Not feasible — qubit budget; truncation to 10 qubits implemented and reported |
| 7 | QUBO pair interactions on large feeders | Budgeted at 40 000 pairs; linear surrogate used beyond that, disclosed in run metadata |
| 8 | 119-bus synthetic feeder with high impedance loads | Failed — all configurations violated the voltage band; load/impedance profile rebalanced |
| 9 | Fault restoration on every switchable branch (N-1) | Success — 37 contingencies, 96.9% average load restoration, 1 case with no transfer |
| 10 | Scenario sweep at high DER penetration | Success with curtailment active; reports curtailed kWh instead of hiding violations |
