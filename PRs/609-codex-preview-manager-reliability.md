# PR #609 — Restore Lopu and preview admission

## Outcome

The protected Lopu PR manager stays below GitHub's workflow run-graph size
boundary, with a deterministic 510,000-byte contract ceiling. The preview
controller continues after GitHub drops a previously verified listener run's
pull-request association, provided the immutable same-repository SHA and ref
still match, and retries only HTTP 403 responses proven to be rate limits.

## Live diagnosis

- The last-known-good 510,325-byte Lopu controller revision created a titled
  run and real job graph immediately.
- The first 514,886-byte revision and 218 later dispatches remained generically
  titled, queued, jobless, logless, and rejected both normal and force-cancel
  API requests.
- A diagnostic dispatch at the last-known-good revision started normally while
  those malformed runs remained present, isolating controller size rather than
  runner capacity as the admission failure.
- Preview failures showed both transient GitHub API rate limiting and GitHub
  removing a source run's pull-request association after the listener had
  already dispatched it.

## Security boundary

The association-loss fallback still requires the exact source run id,
pull-request-target event, trusted workflow path, repository id, triggering
actor, same-repository head, SHA, and ref. The controller then independently
reloads the live PR and revalidates its head before build or publication.
Arbitrary permission-denied 403 responses remain terminal.

## Validation

- Develop preview self-test: 114/114 pass
- Lopu routing contract self-test: pass
- Routing contract fixtures: 10/10 pass
- Workflow control-plane contract: pass
- Workflow YAML parse and diff whitespace checks: pass
- Graphify code and semantic refresh: pass
- Live post-merge Lopu and preview deployment evidence: pending merge
