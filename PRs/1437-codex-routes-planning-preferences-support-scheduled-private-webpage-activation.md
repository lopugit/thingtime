# PR 1437 — Scheduled private webpage activation

Private pages can opt in to a local civil-day cutoff and ensure consecutive
dated records through their existing saved Actions.

- A cutoff can be literal or read from an exact owner-private Data Thing. The
  server verifies the page, Action and settings revisions before automatic
  work. Daylight-saving gaps advance at the clock jump and repeated wall
  times take effect at their first occurrence.
- Ordered `things.ensure` batches share the existing Action key namespace.
  Exact scalar matching can reuse an existing owned record of the same schema
  while preserving its content and placement.
- Passive webpage sources provide data to descendants through the existing
  source runtime. Descendant controls keep their own form and event boundaries.
- Stale settings trigger a fresh resolve. Explicit retries verify the current
  schedule before they run. Navigation that carries the same selection keeps
  the scheduled change eligible, and an explicitly changed selection stays
  pinned.

The private Routes settings, theme and generator are authored separately as
saved Things. This PR contains the reusable framework contracts.

## Verification

- The compiled Nitro server published both origin manifests with `api.things`
  1.57.0, `api.things-update` 1.23.0, `api.actions-run` 1.45.0 and
  `api.webpages-resolve` 1.15.0.
- The disposable replica-set Action suite passed 130 HTTP checks. Coverage
  includes ordered 7-, 14- and 30-day batches, concurrent opens, prior keyed
  and manual record reuse, stale and revoked sources, and the operation budget.
- The TypeScript ratchet passed at zero errors. Schema, Action, Builder and
  capability suites passed. Earlier broad runs encountered the pre-existing
  run-deletion interleaving documented in the run-record writer.
- The isolated desktop and mobile browser fixtures exercised the exact private
  candidate. Coverage included cutoff rollover during an in-flight run, local
  settings saves, stale schedules, explicit Retry, automatic and manual route
  selection, passive theme bindings and existing form payloads.

The structural Graphify refresh covers source changes. The semantic proxy
timed out, so changed Markdown lacks refreshed semantic coverage. Hosted
deployment and private saved-Thing acceptance are separate checks.
