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

Validation after integrating main `b96507b4` (schema copies, durable attachment
saves and Lopu prompt settings), preserving the earlier XPath integration:

- Full Vite/Nitro/Vercel build and changed-file lint passed.
- Full `test:unit` passed: 4,123 passing test summaries, zero failures. Relevant
  suites include Timeline 62; Actions 156 with one existing skip; Lopu 176 + 152;
  Lopu UI 221; capability manifests 90; schemas 259; attachments 9 + 280; Web
  Standards 157 with one existing skip.
- Disposable replica-set HTTP regression passed nested Action updates and
  deletion, partial failure, attempted provenance forgery, subsequent API
  isolation and browser preparation, alongside existing CRUD, draft, restore,
  merge, branch and large-version checks. Fixtures use the real API.
- The manual Action HTTP suite passed all 100 checks. Its old prototype-input
  assertion assumed the preexisting null-prototype accumulator discarded an
  explicit key. The corrected check verifies the supplied boolean survives;
  an additional omitted-key request verifies no inherited prototype leaks.
- Browser History showed API/Action labels and the exact nested field change.
  Live AI-provider execution remains separate acceptance work; the tool tests
  exercise the actual provider-loop entry point with mocked dependencies.
- A previous remote run caught Lopu UI version assertions pinned to 1.16.0.
  Both manifests and every asserted reply version now agree on 1.17.1. Final
  required remote CI must validate the updated head before merge.
- The warning-only typecheck ratchet remains at 91 existing diagnostics versus
  baseline 89, with none in this increment's changed files. This is not a clean
  typecheck claim.
- Graphify structural output is refreshed with the merged source. Fresh Markdown
  semantic extraction is not claimed.

The merge publishes Actions **1.34.1** and Lopu replies **1.17.1**. The user
explicitly authorized tested increments into `main`; use a normal merge commit
and verify the deployed commit afterward.

## Remaining scope

The full [Unified Timeline contract](../docs/unified-timeline.md) remains active:
complete Action outcomes/external-effect receipts, ordinary browser execution
receipts, folder reparenting history and dedicated protected writers are not
completed by this PR. Folder deletion still needs a bounded transactional drain,
recorded child moves and a shared destination-folder write fence so concurrent
creates/moves cannot leave children pointing at a deleted folder.

An API-only reproduction in the disposable replica set confirmed both remaining
folder gaps: a moved child's history stayed at one event, and three of 24
concurrent creates retained a deleted folder id. These are pre-existing paths,
not claimed fixed by this attribution increment.
