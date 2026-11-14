export type DocBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "h"; text: string };

export type DocChapter = { id: string; title: string; summary: string; blocks: DocBlock[] };

export const DOCS: DocChapter[] = [
  {
    id: "architecture",
    title: "System architecture",
    summary: "Layered hybrid pipeline: dashboard → versioned API → services → optimisation core → PostgreSQL.",
    blocks: [
      { kind: "p", text: "A single Next.js deployment serves the operator dashboard and a versioned REST/SSE API. Route handlers delegate to a modular service layer (data, runs, benchmarks, resilience, auth, audit, rate limiting) which owns persistence through Drizzle. The optimisation core is a pure TypeScript library with no framework dependencies, so it is exercised identically by the UI, the API and the regression harness." },
      { kind: "list", items: [
        "Job orchestration: POST /api/v1/runs persists a queued run (seed, params, signature) and enqueues it to an in-process worker. The worker reports stage, progress and structured logs; the client follows via SSE with polling fallback.",
        "Solver layer: a single Solver protocol returns top-k samples. Simulated annealing, parallel tempering, a genetic algorithm and a statevector QAOA simulator are implemented locally; the D-Wave adapter is availability-gated on server-side credentials and degrades to the local annealer when unavailable.",
        "Adjudication: every sample is repaired to a spanning tree and validated with an exact AC backward/forward sweep. Only feasible configurations can become the recommendation.",
        "Resilience and scenario services reuse the same topology, repair and power-flow primitives, which keeps fault restoration and renewable analysis physically consistent with optimisation.",
      ] },
      { kind: "code", text: "dashboard (React 19 / App Router)\n  └─ /api/v1/*  (rewritten to /api/*)  RBAC · rate limit · audit\n        └─ services: data · runs · benchmarks · resilience · auth\n              └─ optimisation core: preprocess → QUBO → solver → repair → AC PF → refine\n                    └─ PostgreSQL (networks, runs, candidates, results, scenarios, faults, audit)" },
    ],
  },
  {
    id: "formulation",
    title: "Mathematical formulation",
    summary: "Decision variables, loss objective, radiality and limit constraints, and the assumptions that bound the model.",
    blocks: [
      { kind: "p", text: "For a feeder with branch set E, closed-switch set X and bus set B, active loss is the sum of I²R over energised branches. Reconfiguration chooses which switchable branches are open so that the resulting graph is a spanning tree rooted at the substation with minimum loss subject to voltage and ampacity limits." },
      { kind: "code", text: "min  P_loss(x) = Σ_{e∈X} R_e |I_e(x)|²\ns.t. |X| = |B| − 1                  (edge count)\n     G(x) is connected at slack      (no islands)\n     no cycles in G(x)               (radiality)\n     V_min ≤ V_b(x) ≤ V_max          (voltage band)\n     |I_e(x)| ≤ I_rated,e            (ampacity)\n     x_e ∈ {0,1}                      (open / closed)" },
      { kind: "p", text: "Because the loss term is non-linear in the switch states and the power flow is implicit, the platform optimises a LinDistFlow-derived quadratic surrogate over a loop encoding and then adjudicates exactly. Radiality is enforced by requiring one open switch per fundamental loop (|L| open switches for |L| independent loops) plus a lazy connectivity/cycle check that discards or repairs anything that is not a spanning tree." },
      { kind: "h", text: "Assumptions and limitations" },
      { kind: "list", items: [
        "Balanced three-phase, steady-state operation; no unbalanced or transient modelling.",
        "One substation (single slack bus) per feeder; transformers are represented as series branches.",
        "Switch operations are instantaneous and free unless a switching-count limit is supplied.",
        "The QUBO surrogate is approximate, so the recommendation is only ever the best AC-validated configuration.",
        "No quantum-advantage claim: local classical solvers currently match or beat the simulated quantum backends.",
        "Output is advisory; there is no control path to field devices.",
      ] },
    ],
  },
  {
    id: "qubo",
    title: "QUBO derivation",
    summary: "Loop one-hot encoding, loss deltas, quadratic coupling and the penalty heuristic.",
    blocks: [
      { kind: "p", text: "For each fundamental loop l, let O_l be the switchable branches on that loop. Introduce binary x_{l,e} = 1 when branch e is the open switch of loop l. Exactly one such variable per loop is 1, giving Σ_l |O_l| variables instead of 2^|E| switch subsets." },
      { kind: "code", text: "H(x) = Σ_{l,e} a_{l,e} x_{l,e} + Σ_{l<l'} Σ_{e∈O_l,e'∈O_l'} b_{l,e,l',e'} x_{l,e} x_{l',e'}\n       + λ Σ_l ( Σ_{e∈O_l} x_{l,e} − 1 )²\n\na_{l,e} = P̃_loss(open set with e open in loop l) − P̃_loss(reference)\nb_{l,e,l'} derived from pairwise loss evaluations, islanding pairs penalised\nλ = max(25, 3·max|a| + 50)  (auto-tuned unless overridden)" },
      { kind: "p", text: "The quadratic term captures cross-loop interaction that a purely linear surrogate misses; when the pair budget would exceed the configured limit (40 000 evaluations) the builder drops interactions and records that the linear surrogate was used. Both cases are reported in the run's formulation panel so results are interpretable." },
    ],
  },
  {
    id: "quantum",
    title: "Quantum and quantum-inspired solvers",
    summary: "QAOA statevector simulation, truncation strategy, D-Wave adapter slot and honest comparison.",
    blocks: [
      { kind: "p", text: "The QAOA simulator builds a p=2 statevector circuit over a truncated sub-QUBO (≤10 qubits): Hadamard initialisation, per-layer phase separation exp(−iγH_C) using the exact diagonal, and a transverse-field mixer of angle β. γ and β are optimised by deterministic coordinate search on the energy expectation, then the state is measured and decoded. If the loop space exceeds the qubit budget, only the cheapest options per loop are encoded and the remainder are fixed, which is reported in the run metadata." },
      { kind: "list", items: [
        "Quantum-inspired annealer: 10 temperature replicas with replica exchange, which accepts larger QUBOs than the simulator.",
        "QAOA: physically faithful statevector evolution, but a simulator — it therefore demonstrates formulation correctness rather than hardware advantage.",
        "D-Wave hybrid: adapter is wired to the same solver protocol and gated on DWAVE_API_TOKEN; submission is disabled in this deployment, so requests degrade to the local annealer with an explicit fallback flag.",
      ] },
    ],
  },
  {
    id: "api",
    title: "API reference",
    summary: "Versioned endpoints, authentication, rate limits and error envelope.",
    blocks: [
      { kind: "p", text: "All endpoints are available under /api/v1 (rewritten to the same handlers as /api). Authentication uses a signed, HttpOnly session cookie issued by POST /api/auth/login. Mutations require a role: viewer reads, engineer writes operational resources, admin changes settings and reads the audit trail. Limits are per actor and IP; exceeded limits return 429 with Retry-After." },
      { kind: "code", text: "GET  /api/v1/health              database, queue, solver availability\nGET  /api/v1/version             API and capability metadata\nPOST /api/auth/login             { username, password } → session cookie\nGET  /api/v1/networks            list with topology counts\nPOST /api/v1/networks            import + validate a network (engineer)\nGET  /api/v1/networks/:id        buses, lines, loops, initial state\nPOST /api/v1/runs                queue a run (engineer, cached by signature)\nGET  /api/v1/runs/:id            status, params, candidates, results\nGET  /api/v1/runs/:id/events     SSE progress stream\nGET  /api/v1/runs/:id/export     ?format=csv|json\nGET  /api/v1/benchmarks          suites; POST runs a comparison suite\nGET  /api/v1/scenarios           scenario sets; POST creates one\nPOST /api/v1/scenarios/evaluate  24h sweep, curtailment, robust ranking\nGET  /api/v1/faults              fault studies; POST runs N-1 / contingency\nGET  /api/v1/metrics             runtime, memory, queue, rate-limit stats (engineer)\nGET  /api/v1/audit               audit trail (admin)" },
      { kind: "p", text: "Errors are JSON with a stable code: { error, code, version }. Validation failures return 422 with an errors array; unauthenticated requests return 401; insufficient role returns 403; rate limits return 429." },
    ],
  },
  {
    id: "operations",
    title: "Operations and security",
    summary: "Deployment, secrets, monitoring, backups and recovery.",
    blocks: [
      { kind: "list", items: [
        "Secrets: DATABASE_URL and SESSION_SECRET are required; DWAVE_API_TOKEN and QA_DNR_USERS are optional. All are read server-side only. /api/health reports whether a token exists, never its value.",
        "Roles: viewer/engineer/admin. Demo credentials are shown on the sign-in page; override with QA_DNR_USERS.",
        "Audit: authentication, imports, runs, settings changes, fault studies and scenario creation are recorded with actor, role, outcome and IP.",
        "Observability: per-run stage logs, /api/health for dependencies, /api/metrics for process and queue statistics.",
        "Backups: scripts/backup.sh performs a compressed pg_dump with retention; the compose file exposes a backup profile. Restore with scripts/restore.sh and verify via /api/health.",
        "Containers: multi-stage Dockerfile and docker-compose.yml (web + postgres + backup). Nginx terminates TLS and proxies to the app with security headers.",
        "Optional Python artifacts: services/api/main.py (FastAPI gateway with OpenAPI docs) and services/qaoa_aer.py (runs the exported OpenQASM circuit on Qiskit Aer). Neither is required at runtime.",
        "Access mode: with QA_DNR_REQUIRE_AUTH unset the workspace opens as a demo operator; set it to \"true\" (or provide QA_DNR_USERS) to enforce the sign-in wall and role accounts.",
      ] },
    ],
  },
];
