# PR 1465 — Reusable Component argument bindings

Saved Component instances can bind explicit scalar arguments to parent data.
Nested controls and asynchronous Action completion remain bound to the current
Component invocation. Private application definitions remain saved Things.

The required semantic contracts are `api.things` 1.62.0,
`api.things-update` 1.27.0 and `api.webpages-resolve` 1.19.0.

## Verification and integration

- Desktop/mobile nested-row checks covered independent drafts, identity changes,
  delayed saves, editable expansion and inspector controls. Marker/iframe and
  real HTTP API authorization checks passed before this release recovery.
- Capability assertions were updated for the additive contracts; older client
  requirement maps retain compatibility checks rather than exact-version equality.
- At `cab80a291`, GitHub build, zero-error TypeScript ratchet, full unit suite,
  real API suite and both CodeQL analyses passed. The matching Vercel preview
  was reachable and advertised all three required capabilities.
- Main subsequently merged PR 1466. Its File Sync contract additions merged
  automatically; the sole conflict was adjacent Unreleased changelog entries.
  Both entries were preserved. New-head CI remains required after integration.
- The structural Graphify snapshot is refreshed. The earlier bounded semantic
  refresh timed out; unrefreshed Markdown semantics are not acceptance evidence.

A successful preview or source check does not prove production acceptance.
Confirm the actual merged commit, production alias source and exact-origin
capability manifest before reporting release completion.
