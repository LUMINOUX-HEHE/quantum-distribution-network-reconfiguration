# QA-DNR — Quantum-Assisted Distribution Network Reconfiguration

Hybrid quantum-classical optimisation, resilience analysis and renewable scenario planning for
distribution network reconfiguration, with a role-scoped operator workspace.

## What it does

- **Formulation** — loop one-hot QUBO of the LinDistFlow active-loss surrogate with automatic penalty tuning.
- **Solvers** — simulated annealing, quantum-inspired parallel tempering, genetic algorithm, statevector QAOA
  (≤10 qubits, truncation reported) and a D-Wave adapter slot gated on server-side credentials.
- **Adjudication** — classical repair to a spanning tree, then exact AC backward/forward power flow; only feasible
  configurations can be recommended.
- **Resilience** — line/switch failure simulation, restoration search with critical-load priority, N-1 scans.
- **Renewables** — solar/wind/load profiles, weather and season scenarios, curtailment, robust comparison.
- **Platform** — seeded sessions with viewer/engineer/admin roles, rate limiting, audit trail, `/api/v1` versioning,
  SSE progress, CSV/JSON/PDF export, health and metrics endpoints.

## Benchmark results

| Feeder | Initial | Validated | Reduction | Gap |
|---|---|---|---|---|
| IEEE 33-bus | 202.68 kW | **139.55 kW** | 31.1% | 0.00% |
| IEEE 69-bus | 224.99 kW | **66.11 kW** | 70.6% | 0.00% |
| Synthetic 119-bus | 83.92 kW | **46.51 kW** | 44.6% | n/a |

Classical branch exchange reaches the same 33-bus optimum; the platform reports that honestly rather than
claiming quantum advantage.

## Quick start

```bash
npm ci
cp .env.example .env      # DATABASE_URL + SESSION_SECRET
npx drizzle-kit push
npm run build && npm run start     # http://localhost:3000
```

Demo accounts: `admin/admin123`, `engineer/engineer123`, `viewer/viewer123` (override with `QA_DNR_USERS`).

## Verification

```bash
npx next typegen
npm exec tsc -- --noEmit
npx tsx scripts/test-suite.ts     # 20 regression cases
npx tsx scripts/bench-suite.ts    # runtime/memory by network size
npm run build
curl -s localhost:3000/api/health
```

## Optional service artifacts

| File | Purpose |
|---|---|
| `services/api/main.py` | FastAPI gateway exposing the same resources with OpenAPI docs; forwards the session cookie so RBAC and audit still apply. |
| `services/qaoa_aer.py` | Runs the exact QAOA circuit exported by `GET /api/v1/qaoa/circuit` (OpenQASM 3) on Qiskit Aer. |

The platform runs without them; they exist for deployments that standardise on Python tooling and to
cross-check the quantum formulation outside the application runtime.

## Operator surfaces

| Route | Purpose |
|---|---|
| `/` | Overview: recommendation KPIs, pipeline, capability entry points |
| `/networks`, `/networks/:id` | Feeder library, topology, loops, branch data |
| `/networks/:id/editor` | Interactive switch-state editor with live radiality + AC metrics |
| `/runs/new`, `/runs`, `/runs/:id` | Configure, monitor and inspect runs (candidates, plans, baselines) |
| `/resilience` | Fault studio and N-1 contingency scans |
| `/scenarios` | Renewable/weather sweeps, curtailment and robust comparison |
| `/benchmarks` | Solver vs classical baseline comparison and scaling charts |
| `/progress`, `/docs`, `/presentation` | Checklist evidence, engineering handbook, delivery deck |

## Documentation

`docs/ARCHITECTURE.md` · `FORMULATION.md` · `QUBO.md` · `QUANTUM.md` · `CLASSICAL.md` · `API.md` ·
`DEPLOYMENT.md` · `USER_GUIDE.md` · `BENCHMARKS.md` · `PERFORMANCE.md` · `TEST_REPORT.md` ·
`EXPERIMENTS.md` · `SECURITY.md` · `DEMO.md` · `REPORT.md`. The same material is browsable in-app under
**Documentation**, and the full delivery checklist is tracked under **Program status**.
