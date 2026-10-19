# PR #1047 — Editable live agent overview

Branch: `codex/agent-overview-builder`. PR: https://github.com/lopugit/thingtime/pull/1047

## Current architecture

Committed code provides the reusable, ACL-checked work-graph read adapter at
`GET /api/v1/agent-overview`. It consumes caller-selected Thing schema
references, projects authorized records, supports cursor paging and live SSE,
and negotiates `api.agent-overview` 2.0.0. This is a breaking change from the
earlier preview contract: clients now own titles, labels, indentation, and
layout; the response exposes raw statuses and numeric hierarchy depth without
CSS indent, column labels, or fallback titles. Optional CSV status groups
classify active, blocked, and complete work.

The repository does not ship a dashboard page, component, schema, or write
Action definition. Author those as saved Things in Thingtime. The saved page
owns presentation and ordinary Thing writes; the adapter only reads through
the canonical authorization boundary. No automatic ChatGPT/Codex transcript,
tool, process, billing-token, or runtime capture is provided.

## Historical preview implementation and validation — 2026-10-19

The following checks ran against the previous preview architecture, which
included committed editable suite/page definitions. They are retained as
historical evidence of that implementation, not as verification of the current
schema-parameterized adapter or separately authored saved Thing page.

- Overview: 46, capabilities: 103, schemas: 279 and webpages: 167 tests passed
  before integration, with 4 existing webpage skips. Both client and Node
  server built.
- Latest-main integration preserved subspace content-slot rendering. Focused
  renderer/template tests: 42 passed; combined capability tests: 104 passed.
- The isolated acceptance runner used a fresh Mongo replica set, generated
  disposable identity and an OS-enforced loopback-only backend/browser boundary.
  Direct-IP and redirected external requests were denied. No real account
  secrets or production data entered that environment.
- Chromium verified API writes streaming into the then-open page, task
  creation/status, question answers, search, preview views, desktop/mobile
  overflow and expanded forms, measured runtime, nested Builder edits,
  reconnect and session revocation. Values matched the then-stored records.
- The previous global typecheck baseline was nonblocking: 92 errors against 89
  baseline, with no errors identified in that feature's changed files.
- The prior Graphify refresh retained legacy semantic-cache, partial Swift
  extraction and out-of-scope semantic-entry caveats. It was a navigation aid,
  not evidence of global code correctness.

## Current framework and saved-Thing acceptance — 2026-10-19

- Capability/source-gate checks: 113 passed. Overview and actor-fence checks
  passed; client and Node server builds passed.
- The external authored file was created through ordinary Thing APIs as six
  Schema Things, sixteen Action Things and two Webpage Things, with no suite
  installation. A mismatched test-helper kind was fixed before the successful run.
- The loopback-fenced Chromium run passed live API writes, saved Action writes,
  four views, search, desktop/mobile layouts including expanded forms, actual
  runtime ticking/stopping, independent Builder heading/button/icon/repeated-card
  edits saved and reloaded, reconnect and session revocation. Rendered values
  matched independent Thing readbacks. All disposable services were cleaned up.

## Current-main integration — 2026-10-19

- Follow-up integration includes `origin/main` at `ace31f5c9c928529d6d0f4b9ad324319f48b7507` and preserves its shared MongoDB health pooling and diagnostics tests. Only the additive changelog entries required manual resolution.

- Integrated `origin/main` at `f8fb34d8e6536cea5d36caa33de7af9ca6119b7e`, preserving file-sync imports, validation and capability contracts alongside the reusable live-source framework. No saved page, Component, Schema or Action definitions were added.
- Advanced live-source creation negotiation to `api.things` 1.37.0 because current main already advertises 1.36.0 for file-sync support. Retained `api.agent-overview` 2.0.0, update 1.11.0 and resolve 1.7.0.
- Corrected the focused overview script's obsolete saved-suite test path. Overview/actor/source checks (42), capability checks (106), schema checks (275), and webpage checks passed. The SSE heartbeat check now waits for the observed event and cancels its reader rather than relying on a 16 ms wall-clock deadline.
- Client and Node server builds passed. Restored the locked local `@noble/hashes` dependency after the incoming file-sync tests exposed a stale install, and aligned their manifest assertion with 1.37.0.
- The local-proxy semantic refresh returned incomplete/hollow document chunks and was safely refused by Graphify's shrink guard. Kept the prior semantic data and used the structural incremental refresh; current integration documentation is not claimed to be freshly semantically indexed.

## Production release acceptance — pending

Use a local disposable identity and the external, uncommitted
`AGENT_OVERVIEW_AUTHORED_THINGS` JSON fixture to identify the actual saved page,
components, schemas, Actions and sample Things. Verify the adapter's 2.0.0
manifest negotiation, ACL-scoped reads, current response shape, live updates,
reconnect, revocation, measured/unknown values and the real Builder edit-save-
reload flow. Compare the rendered page with its source Things at desktop and
mobile sizes. Do not claim current production acceptance until the separately
authored page and deployed endpoint pass this check. See
[the adapter guide](../docs/agent-overview.md) and
[the manual checklist](../TESTING.md#agent-overview-and-task-reporting).
