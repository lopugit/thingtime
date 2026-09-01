# PR #533 — Feature Stack progress heartbeats

## Outcome

Thingtime accepts fresh HMAC-signed progress snapshots only for the exact
stored Feature Stack dispatch, appends them as idempotent relational CI events,
and renders Lopu's phase, percentage, exact Actions link, and viewer-local ETA
in the existing chronological merge console.

## Contract

- `POST /api/v1/integrations/ci/progress`
- semantic capability `api.integration-ci-progress` `1.0.0`
- exact repository, stack ID, durable run ID, workflow run ID/URL, attempt,
  delivery ID, timestamp, target, status, phase, and percentage validation
- same `THINGTIME_CI_ROUTER_SECRET` boundary as the provider router and
  credential delivery; no new account-named GitHub secret
- immutable delivery IDs make reporter retries idempotent

## Validation

- Focused Node tests: 8/8
- Focused ESLint: pass
- Full Remix/Nitro/Vercel build and output verification: pass
- Graphify refreshed; hooks and merge driver verified
