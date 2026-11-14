# Performance & scalability report

Generated 2026-11-14T06:30:36.964Z on Node v22.23.4 (linux/x64), process RSS 130.1 MB, heap 29.8 MB.

## Formulation size

| Network | Buses | Branches | Switchable | Loops | QUBO variables | Quadratic terms | QUBO build | AC power flow |
|---|---|---|---|---|---|---|---|---|
| IEEE 33-bus | 33 | 37 | 37 | 5 | 64 | 1580 | 70.1 ms | 0.46 ms |
| IEEE 69-bus | 69 | 73 | 73 | 5 | 99 | 3771 | 126 ms | 0.24 ms |
| Synthetic 119-bus | 119 | 124 | 124 | 6 | 175 | 12308 | 611.3 ms | 0.13 ms |

## Hybrid pipeline runtime (4 000 annealing steps, 2 restarts, refinement on)

| Network | Buses | QUBO vars | Solver | Pipeline runtime | Validated loss | Reduction | Heap delta |
|---|---|---|---|---|---|---|---|
| IEEE 33-bus | 33 | 64 | simulated-annealing | 292 ms | 139.55 kW | 31.15% | -0.9 MB |
| IEEE 33-bus | 33 | 64 | quantum-inspired | 248 ms | 139.55 kW | 31.15% | -1.3 MB |
| IEEE 33-bus | 33 | 64 | genetic-algorithm | 262 ms | 139.55 kW | 31.15% | 6.9 MB |
| IEEE 33-bus | 33 | 64 | qaoa-simulator | 216 ms | 139.55 kW | 31.15% | -3.5 MB |
| IEEE 69-bus | 69 | 99 | simulated-annealing | 857 ms | 66.11 kW | 70.61% | 7.8 MB |
| IEEE 69-bus | 69 | 99 | quantum-inspired | 847 ms | 66.11 kW | 70.61% | 0.1 MB |
| IEEE 69-bus | 69 | 99 | genetic-algorithm | 915 ms | 66.11 kW | 70.61% | -5.2 MB |
| IEEE 69-bus | 69 | 99 | qaoa-simulator | 816 ms | 66.11 kW | 70.61% | 6.3 MB |
| Synthetic 119-bus | 119 | 175 | simulated-annealing | 3156 ms | 46.51 kW | 44.58% | 3 MB |
| Synthetic 119-bus | 119 | 175 | quantum-inspired | 2647 ms | 46.51 kW | 44.58% | 4.7 MB |
| Synthetic 119-bus | 119 | 175 | genetic-algorithm | 2374 ms | 46.51 kW | 44.58% | -6.7 MB |
| Synthetic 119-bus | 119 | 175 | qaoa-simulator | 3238 ms | 46.51 kW | 44.58% | 3.4 MB |

## Observations

- The AC backward/forward sweep is cheap (single-digit milliseconds on the 69-bus feeder) and dominates candidate validation, which is why every candidate can be validated exactly.
- QUBO construction scales with the loop-option product; the pair budget caps interaction evaluation at 40 000 pairs, after which the builder drops cross-loop terms and reports the linear surrogate.
- The QAOA simulator's runtime is driven by the 2^n statevector; truncation to ≤10 qubits keeps a run in the low seconds even on the 119-bus feeder.
- Memory growth per pipeline run stays in the low single-digit megabytes; the largest allocation is the candidate/power-flow profile set.

## Service level objectives

| SLO | Target | Current |
|---|---|---|
| Benchmark run latency (33/69-bus, local solver) | < 30 s | < 3 s measured |
| Recommendation feasibility | 100% (post-repair) | 100% in regression suite |
| API availability | 99.5% monthly | health check + container restart policy |
| Run failure rate | < 1% | tracked via `/api/v1/metrics` |
| Audit coverage of mutations | 100% | auth, runs, imports, settings, faults, scenarios |
