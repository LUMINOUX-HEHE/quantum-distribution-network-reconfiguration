# Deployment and operations

## Local

```bash
npm ci
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET
npx drizzle-kit push          # apply schema
npm run build && npm run start
npx tsx scripts/test-suite.ts # regression suite
npx tsx scripts/bench-suite.ts
```

## Containers

```bash
docker compose up --build -d          # web + postgres
docker compose --profile backup up -d # nightly pg_dump profile
docker compose logs -f web
```

The image is multi-stage, runs as a non-root user and declares a health check against `/api/health`. Nginx (`deploy/nginx.conf`) terminates TLS, sets security headers, buffers off for the SSE endpoint and proxies to `web:3000`.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| DATABASE_URL | yes | PostgreSQL connection |
| SESSION_SECRET | yes | HMAC key for session cookies and API token hashing |
| DWAVE_API_TOKEN | no | enables the Leap adapter slot (never exposed) |
| QA_DNR_USERS | no | JSON user map replacing demo accounts |

## Monitoring

- `/api/health` — dependency and solver status (used by container health checks).
- `/api/v1/metrics` — uptime, RSS/heap, CPU, run counts, duration percentiles, queue depth, rate-limit buckets.
- Per-run structured logs with stage, level and timestamp; failures persist the failing stage.

## Backup, restore and disaster recovery

1. `scripts/backup.sh` writes a compressed `pg_dump` to `./backups` and prunes files older than `RETENTION_DAYS`.
2. Off-site copy the dump (object storage or encrypted volume).
3. `scripts/restore.sh backups/app_db-<stamp>.sql.gz` restores into a fresh database.
4. Verify: `/api/health` returns ok, `/api/v1/networks` lists seeded feeders, and the regression suite passes.
5. Recovery target: restore in under 30 minutes for a database under 1 GB; the app is stateless apart from PostgreSQL.

## CI/CD

`.github/workflows/ci.yml` runs lint, type generation, type check, schema push, the regression suite, the performance harness, the production build and a dependency audit on every push and pull request, with a nightly schedule.
