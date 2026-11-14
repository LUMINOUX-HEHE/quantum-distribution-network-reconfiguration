# Architecture

## Layering

```
Browser (React 19 / App Router)
   │  signed session cookie · RBAC · rate limits
   ▼
Next.js route handlers  ── /api/v1/* (middleware rewrite)  ── SSE progress
   │
   ├── service layer (src/lib/server): data · runs · benchmarks · resilience · auth · audit · ratelimit
   │        │
   │        └── PostgreSQL via Drizzle ORM
   │
   └── optimisation core (framework-free TypeScript)
            preprocess → QUBO builder → solver → repair → AC power flow → refinement → selection
```

## Responsibilities

| Module | Responsibility |
|---|---|
| `src/lib/power` | Network model, topology/radiality, AC power flow, renewable profiles, fault restoration |
| `src/lib/optimization` | QUBO construction, solvers (SA/QI/GA/QAOA), baselines (branch exchange, brute force, MILP), hybrid pipeline |
| `src/lib/server` | Persistence, async job orchestration, auth, audit, rate limiting, benchmark and resilience services |
| `src/app` | Pages and versioned REST/SSE handlers |
| `src/db` | Drizzle schema and pool |

## Async job flow

1. `POST /api/v1/runs` validates the payload, enforces the engineer role and rate limit, computes an experiment signature and returns a cached completed run when the signature matches.
2. Otherwise a `runs` row is written with `queued`, the seed, parameters and solver version, then enqueued to the in-process worker.
3. The worker updates stage, progress and structured logs after each pipeline phase; clients subscribe to `/api/v1/runs/:id/events` (SSE) with polling fallback.
4. Candidates, the recommendation, metrics and the switching plan are persisted; failures record the failing stage and message.

## Scaling strategy

Variable reduction through loop contraction, loop one-hot encoding, pair budgets, warm-started refinement, result caching by signature and bounded fault scans. For feeders beyond ~1 000 buses the documented path is feeder decomposition plus coordinated boundary reconciliation; the schema and pipeline already accept arbitrary imported topologies.
