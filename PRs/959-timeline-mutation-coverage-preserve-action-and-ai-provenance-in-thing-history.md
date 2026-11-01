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

The final integration includes main `16bba9aa`: account draft recovery, lossless Lopu Thing inspection,
voice silence settings, schema copies, attachment saves, personal prompt settings
and XPath support are preserved. Actions advertises **1.34.1** and Lopu replies
**1.18.1**. The trusted executor wrapper still surrounds the existing tool
validation and permission checks.

- Full Vite/Nitro/Vercel build, Timeline 62, account drafts 18, capability
  manifests 90 and the disposable HTTP regression passed after integrating
  account draft recovery. The preceding changed-file lint passed with one
  existing no-script-url warning in the page-context test.
- Additional suites on the preceding lossless-inspection integration: Timeline
  62; Actions 156 with one existing skip;
  Lopu 179 + 153; Lopu UI 232; capability manifests 90; chat streaming 54;
  schemas 260. All passed.
- The full unit suite passed on the preceding combined source (4,123 passing
  summaries, zero failures). GitHub's required build/unit and API checks also
  passed for the preceding head. All required checks must pass for the final
  exact head before merging; earlier green checks do not satisfy that gate.
- Disposable replica-set HTTP regression covers nested Action updates and
  deletion, partial failure, attempted provenance forgery, subsequent API
  isolation and browser preparation, alongside CRUD, draft, restore, merge,
  branch and large-version checks. Fixtures use the real API.
- The manual Action HTTP suite passed all 100 checks. Its old prototype-input
  assertion assumed the preexisting null-prototype accumulator discarded an
  explicit key. The corrected check verifies the supplied boolean survives;
  an additional omitted-key request verifies no inherited prototype leaks.
- Browser History showed API/Action labels and the exact nested field change.
  Live AI-provider execution remains separate acceptance work; the tool tests
  exercise the actual provider-loop entry point with mocked dependencies.
- The last warning-only typecheck comparison reported 91 existing diagnostics
  versus baseline 89, with none in this increment's changed files. This is not
  a clean typecheck claim. The baseline is unchanged.
- Graphify structural output is refreshed with the merged source. Fresh Markdown
  semantic extraction is not claimed.

The user explicitly authorized tested increments into `main`; use a normal
merge commit and verify the deployed commit afterward.

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
