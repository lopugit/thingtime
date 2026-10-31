# PR #513 — Admin CI refresh resilience

## Incident

Vercel detected a burst of `GET /api/v1/admin/ci` 500 responses correlated
with MongoDB code 292 (`QueryExceededMemoryLimitNoDiskUseAllowed`). The growing
CI history was being sorted in memory before its limit was applied.

PR #511 supplied the primary database fix: every dashboard read is scoped to
the configured repository and its stable newest-first order is served by the
`things_ci_repository_updated` compound index. A real MongoDB explain selected
that index without a blocking `SORT` stage.

## Resilience follow-up

- MongoDB code 292 becomes a private, retryable 503 with `Retry-After: 30` and
  the stable `ci_dashboard_query_capacity` response code.
- Runtime logs emit `ci_dashboard_query_failed`, the exact API route, Mongo
  code/name, and retry delay. They never include the caught message, query,
  namespace, document values, or credentials.
- The browser preserves the last-known snapshot, coalesces overlapping 5s and
  30s refreshes into one request, and backs off failures from 30 seconds to a
  five-minute cap. Manual Refresh bypasses the wait.
- The API capability contract advances compatibly from 1.0.1 to 1.0.2 and the
  generated docs describe the 503 response.

## Verification

- CI Control tests: 41 passed, including Mongo 292 classification, safe
  telemetry, exponential backoff, server retry hints, manual bypass, and true
  single-flight overlap.
- MongoDB collection tests: 16 passed.
- Capability manifest tests: 2 passed.
- Targeted ESLint: passed.
- Vite + Nitro production build and Vercel output verification: passed.
- Authenticated production Admin CI failure state remained usable. Full
  desktop and 390px mobile top-to-bottom checks had no horizontal overflow.
- Graphify hooks and union merge driver were present; the project graph was
  refreshed after rebasing onto current `main`.
