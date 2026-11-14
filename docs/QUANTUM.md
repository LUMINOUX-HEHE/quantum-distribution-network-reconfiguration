# Quantum and quantum-inspired implementations

## QAOA simulator

- Encoding: one qubit per retained loop option (≤10 qubits). Options beyond the budget are fixed to the cheapest linear option and the truncation is reported.
- Circuit: uniform superposition, then per layer `exp(-iγH_C)` applied with the exact diagonal of the QUBO, followed by a transverse-field mixer `Rx(2β)` on every qubit.
- Parameters: deterministic coordinate search over γ, β (2 layers) minimising the energy expectation.
- Measurement: Born-rule probabilities for the top-amplitude states plus 128 shot samples; each bitstring decodes into a loop selection and is repaired and AC-validated downstream.
- Honest position: the simulator demonstrates formulation and decoding correctness. Current local classical solvers are faster and at least as accurate, so no quantum advantage is claimed.

## Quantum-inspired annealer

Ten temperature replicas with geometric ladder, Metropolis updates within replicas and replica exchange between neighbours. Accepts larger QUBOs than the simulator and is the recommended backend for the 69/119-bus feeders.

## D-Wave Leap adapter

Uses the same `Solver` contract and BQM-compatible formulation. Availability is determined server-side from `DWAVE_API_TOKEN`; outbound submission is disabled in this deployment, and requests degrade to local annealing with `fallbackUsed` recorded in the run.
