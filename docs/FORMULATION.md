# Mathematical formulation

## 1. Scope

Balanced, steady-state MV distribution feeder with one substation (slack bus), series branch impedances, spot loads and distributed generation. Switch states are the only decision variables; the platform is advisory.

## 2. Optimisation problem

```
min  P_loss(x) = Σ_{e ∈ X(x)} r_e · |I_e(x)|²
s.t. |X(x)| = |B| − 1
     G(x) connected at the slack bus
     no cycles in G(x)
     V_min ≤ V_b(x) ≤ V_max    for all buses
     |I_e(x)| ≤ I_rated,e      for all energised branches
     x_e ∈ {0,1}               (1 = branch open)
```

`I_e(x)` is obtained from an exact AC solution, so the feasible set is defined by physics rather than by the surrogate.

## 3. AC power flow

Complex backward/forward sweep on the radial tree: nodal current injection `I = conj(S/V)`, downstream accumulation, then voltage update `V_to = V_from − (r + jx)I`. Convergence is declared when the maximum nodal voltage change is below `1e-9` pu (typically 8–18 iterations). Loss is `Σ |I|² r` per branch, converted to kW with the MVA base.

Validation against public benchmarks: IEEE 33-bus 202.677 kW / 0.9131 pu and IEEE 69-bus 224.992 kW / 0.9092 pu, both matching the literature.

## 4. Radiality encoding

Fundamental loops are found from a spanning tree that prefers non-tie branches; every remaining branch is a chord defining exactly one independent loop. Requiring exactly one open switch per loop yields `|L|` open branches, i.e. a spanning tree, provided connectivity holds — which is verified by a lazy union-find/BFS check and repaired classically.

## 5. Constraints and repair

`repairConfiguration` first drops redundant openings, reconnects islands through the lowest-impedance open switch on the cut, then breaks remaining cycles by opening the lowest approximate-flow switch on the cycle. The repaired configuration is re-checked and only then validated by AC power flow.

## 6. Assumptions and limitations

Balanced three-phase; single substation; transformers as series branches; switch actions free and instantaneous unless a switching-count limit is supplied; surrogate loss is quadratic and therefore approximate; no quantum-advantage claim; outputs are advisory with no SCADA write path.
