# Final technical report

## Summary

QA-DNR implements a hybrid quantum-classical pipeline for distribution network reconfiguration. A loop-based QUBO is solved by simulated annealing, a quantum-inspired parallel-tempering tuner, a genetic algorithm or a statevector QAOA simulator; every candidate is repaired to a spanning tree and validated with an exact AC backward/forward sweep before a recommendation is published.

## Results

- IEEE 33-bus: 202.68 → 139.55 kW (31.1% reduction), gap 0.00% to the literature optimum, under one second locally.
- IEEE 69-bus: 224.99 → 66.11 kW (70.6%) on the bundled five-tie dataset.
- Synthetic 119-bus: 83.92 → 46.51 kW (44.6%) in roughly three seconds with the quantum-inspired tuner.
- N-1 scan on the 33-bus feeder: 37 contingencies, 96.9% average load restoration, every restored state AC-validated.
- Scenario sweeps expose curtailment and worst-case voltage rather than hiding limit violations.

## Engineering contributions

Reproducible run records (seed, parameters, solver version, signature-based caching), exact adjudication of surrogate proposals, a role-scoped audited API with rate limiting and versioning, an operator workspace covering optimisation, resilience and renewable planning, and a 20-case regression harness with measured performance reporting.

## Limitations

Balanced steady-state modelling only; single substation per feeder; quadratic surrogate assumption; QAOA truncation to 10 qubits; D-Wave submission disabled in this deployment; no quantum advantage demonstrated; infrastructure artefacts (containers, CI, TLS proxy, backups) are provided but not executed inside this sandbox.

## Recommendation

Operate in advisory mode with engineering review of switching plans, extend to unbalanced three-phase and feeder decomposition beyond ~1 000 buses, and keep the benchmark harness as the gate for any new solver backend.
