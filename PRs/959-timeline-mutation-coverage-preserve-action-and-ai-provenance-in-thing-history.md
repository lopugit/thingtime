# PR #959 — Preserve Action and AI provenance in Thing history

Server Action and Lopu tool mutations previously appeared as generic API edits.
Canonical Thing writes now inherit trusted server executor context: the
authenticated actor, initiating Action/AI source, and one operation id. Nested
writes keep separate immutable events and relational operation links. An
AI-invoked Action retains AI attribution, including first-party browser flows
executed on the server through the ordinary API dispatcher.

The context grants no authority. Concurrent invocations, unrelated actors and
anonymous shared runs stay isolated. Headers, provider input and authored
program fields cannot establish it. Explicit restore/merge captures preserve
their existing exact-retry identity and source contract. Local and remote
event/link formats are unchanged; no extra embedded histories are introduced.

A partially failed Action retains events for committed changes only. Preparing
a browser Action does not claim execution. Operation grouping is not an Action
retry token: external effects must never be replayed to repair missing history.

## Validation

- Full Vite/Nitro/Vercel build and changed-file lint passed.
- Timeline: 62 passed. Actions: 156 passed, one existing skip. Lopu: 169 + 151
  passed. After integrating main `c25edbf3`, capability tests: 90 passed;
  Web Standards: 157 passed, one existing skip.
- Disposable replica-set HTTP regression passed nested Action updates and
  deletion, partial failure, attempted provenance forgery, subsequent API
  isolation and browser preparation, alongside existing CRUD, draft, restore,
  merge, branch and large-version checks. It creates fixtures through the API.
- Browser History showed API/Action labels and the exact nested field change.
- The initial warning-only typecheck ratchet reported 91 existing diagnostics
  versus baseline 89, with none in changed files. This is not a clean typecheck
  claim. Required remote checks must pass on the final head before merge.
- Graphify structural output is refreshed with the merged source. Fresh Markdown
  semantic extraction is not claimed.

The merge preserves main's XPath support and publishes Actions **1.34.1** and
Lopu replies **1.16.1**. The user explicitly authorized tested increments into
`main`; use a normal merge commit and verify the deployed commit afterward.

## Remaining scope

The full [Unified Timeline contract](../docs/unified-timeline.md) remains active:
complete Action outcomes/external-effect receipts, ordinary browser execution
receipts, folder reparenting history and dedicated protected writers are not
completed by this PR. Folder deletion still needs a bounded transactional drain,
recorded child moves and a shared destination-folder write fence so concurrent
creates/moves cannot leave children pointing at a deleted folder.
