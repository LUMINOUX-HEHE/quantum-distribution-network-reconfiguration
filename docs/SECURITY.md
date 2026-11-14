# Security model

- **Authentication**: signed HttpOnly session cookies (HMAC-SHA256, 12 h TTL, SameSite=Lax, Secure in production). Passwords are compared in constant time; `scryptHash` is provided for stored credentials.
- **Authorisation**: viewer/engineer/admin enforced in route handlers and reflected in the UI. Server components never trust client-supplied roles.
- **Secrets**: `DATABASE_URL`, `SESSION_SECRET`, `DWAVE_API_TOKEN` and `QA_DNR_USERS` are read only in server code. Availability booleans are exposed; values never are. API tokens are stored hashed (`api_keys.token_hash`).
- **Input validation**: network imports validate connectivity, slack uniqueness, numeric ranges, switch taxonomy and radial edge count; run parameters are clamped; file size is limited at the proxy.
- **Rate limiting**: per actor and IP on authentication, run creation, imports, benchmarks, fault studies and scenario evaluation, with `Retry-After`.
- **Audit**: every privileged mutation writes actor, role, action, resource, outcome, detail and IP.
- **Transport and headers**: TLS termination, HSTS, X-Frame-Options DENY, nosniff, strict referrer policy in the reverse-proxy config.
- **Residual risks**: demo credentials must be replaced before any shared deployment; the in-process queue is single-node; no external penetration test has been performed.
