# QUBO derivation

## Variables

For each loop `l` with switchable branch set `O_l`, one binary `x_{l,e}` meaning "branch e is the open switch of loop l". Variable count is `Σ_l |O_l|` (64 for the 33-bus feeder) instead of `2^37`.

## Hamiltonian

```
H(x) = Σ_{l,e} a_{l,e} x_{l,e}
     + Σ_{l<l'} Σ_{e,e'} b_{l,e,l',e'} x_{l,e} x_{l',e'}
     + λ Σ_l ( Σ_{e∈O_l} x_{l,e} − 1 )²
```

- `a_{l,e}` is the LinDistFlow surrogate loss delta when `e` is opened in loop `l` relative to the initial configuration.
- `b` terms come from exact pairwise surrogate evaluations; pairs that island the feeder receive a structural deterrent equal to `10·(max|a| + 100)`.
- `λ = max(25, 3·max|a| + 50)` unless overridden; the value is stored per run.

## Reference implementation notes

- Interactions are only computed when the cross-loop pair count is ≤ 40 000; otherwise the builder records that the linear surrogate was used.
- The builder returns the reference open set, surrogate reference loss, term counts and the variable-to-switch mapping for full reproducibility.
- Energy evaluation in the solvers includes the one-hot penalty, so infeasible one-hot patterns are visible in the candidate table.
