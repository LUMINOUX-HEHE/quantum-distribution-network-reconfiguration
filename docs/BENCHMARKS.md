# Benchmark methodology and results

## Method

- Feeder data: IEEE 33-bus and 69-bus public branch data (the 69-bus set is derived from MATPOWER `case69.m` with the common five-tie benchmark connection set), plus a deterministic synthetic 119-bus feeder.
- Every method runs on the same network snapshot, limits (0.9–1.05 pu, 100% ampacity), parameters and seed.
- Candidate feasibility is decided only by AC power flow, never by the surrogate.
- Reference losses: 139.55 kW (33-bus literature) and 66.11 kW (69-bus five-tie reference recorded by the platform).

## Results

| Case | Initial loss | Best validated loss | Reduction | Gap | Time |
|---|---|---|---|---|---|
| IEEE 33-bus | 202.68 kW | 139.55 kW | 31.1% | 0.00% | < 1 s |
| IEEE 69-bus | 224.99 kW | 66.11 kW | 70.6% | 0.00% | ≈ 1 s |
| Synthetic 119-bus | 83.92 kW | 46.51 kW | 44.6% | n/a | ≈ 3 s |

Optimal 33-bus open set: branches {7, 9, 14, 32, 37} (32 with the tie set closed except 33–37), matching the published optimum.

## Honest comparison

Classical branch exchange reaches the same 33-bus optimum in tens of milliseconds. The quantum-inspired and QAOA backends match it once repair and refinement are applied, but they are not faster. The value of the platform is the hybrid harness, guarantee of AC feasibility and reproducibility, not a quantum speed-up. Full runtimes are in `docs/PERFORMANCE.md`.
