# API reference

Base path: `/api/v1` (rewritten by middleware to `/api`). Legacy `/api` paths remain available for the UI.

## Authentication

`POST /api/auth/login` with `{ "username", "password" }` sets an HttpOnly signed cookie (`qa_dnr_session`). Roles: `viewer` (read), `engineer` (runs, imports, fault studies, scenarios), `admin` (settings, audit).

## Endpoints

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | /health | public | database, queue and solver availability |
| GET | /version | public | API version and capability metadata |
| POST | /auth/login · /auth/logout · GET /auth/session | public | session lifecycle |
| GET | /networks | viewer | library with topology counts |
| POST | /networks | engineer | validate and import topology |
| GET | /networks/:id | viewer | buses, branches, loops, initial evaluation |
| POST | /runs | engineer | queue a run (idempotent by signature) |
| GET | /runs · /runs/:id | viewer | history and detailed results |
| GET | /runs/:id/events | viewer | SSE progress stream |
| GET | /runs/:id/export?format=csv\|json | viewer | download results |
| GET/POST | /benchmarks | viewer/engineer | comparison suites |
| GET/POST | /scenarios | viewer/engineer | scenario library |
| POST | /scenarios/evaluate | engineer | horizon sweep, curtailment, robust ranking |
| GET/POST | /faults | viewer/engineer | fault studies and N-1 scans |
| GET | /metrics | engineer | runtime, memory, queue, rate limits |
| GET | /audit | admin | audit trail |

## Errors

`{ "error": string, "code": string, "version": "v1" }` with 400 invalid body, 401 unauthenticated, 403 insufficient role, 422 validation failure (`errors[]`), 429 rate limited (`Retry-After`), 500 study or pipeline failure.
