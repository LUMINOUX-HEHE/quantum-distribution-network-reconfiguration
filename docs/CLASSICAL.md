# Classical solvers and baselines

| Component | Method | Notes |
|---|---|---|
| Simulated annealing | Geometric cooling, random loop-option moves, restarts, greedy polish | Default local solver |
| Genetic algorithm | Tournament selection, uniform crossover, single-loop mutation, elitism | Population 12–64, generations bounded by step budget |
| Quantum-inspired tuner | Parallel tempering replicas with replica exchange | Recommended for 69/119-bus |
| Branch exchange | Unrestricted single-switch exchange scored by exact AC power flow | Classical baseline and refinement stage |
| Pair exchange | Joint two-loop exchange | Escapes first-order local optima |
| Brute force | Enumerates loop combinations, pre-screens with the surrogate, validates a shortlist | Reports truncation honestly |
| MILP-style assignment | LP relaxation of the linearised assignment plus bounded branch-and-bound | Surrogate objective; AC validation of leaves |

All components implement the same energy-evaluation contract and write results in the same schema, which is what makes the benchmark comparison meaningful.
