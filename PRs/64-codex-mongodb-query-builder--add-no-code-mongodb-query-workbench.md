# PR #64 — Add no-code MongoDB query workbench

- PR: https://github.com/lopugit/thingtime/pull/64
- Branch: `codex/mongodb-query-builder`
- Base: `main`

## Goal

Replace the unfinished raw MongoDB page with an approachable admin tool that
can build and run useful MongoDB reads without hand-writing JavaScript or
shipping an unbounded collection dump.

## What shipped

- A responsive `/raw` Query Workbench with collection and operation pickers,
  nested ALL/ANY/NONE filters, projections, sorting, bounded options, and an
  exact request preview.
- Read tools for find, find one, exact and estimated counts, distinct values,
  aggregation pipelines, index inspection, collection statistics, and
  execution plans.
- Recursive typed BSON inputs for dates, ObjectIds, regular expressions,
  integer/decimal/long/timestamp types, UUIDs, binary data, documents, arrays,
  MinKey, and MaxKey.
- Clickable read-only aggregation stages with ordering and enable controls,
  including Atlas/newer-server stages; the connected deployment returns the
  capability error when it does not support a selected stage.
- Optimistic results that remain visible during refresh, JSON/table views,
  copy, JSON export, and formula-safe full-field CSV export.
- Run, explain, cancel, reset, copy-query, export-query, and Cmd/Ctrl+Enter
  actions.

## Server boundary

The API owns the collection allowlist and capability registry. Both the GET
capabilities response and POST executor require an admin session. Every query
has server-side body, depth, entry, pipeline, join, array, regex, result-count,
response-byte, and execution-time bounds.

The workbench is intentionally read-only. Write stages, server-side
JavaScript, change streams, session/current-operation inspection, and joins to
authentication collections are rejected at every nesting depth. Protected
collections disable aggregation and computed projection, redact credential
fields recursively, and reject filters, expressions, sorts, or distinct paths
that could probe those values. Query cancellation reaches the MongoDB driver,
and this expensive endpoint opts into fail-closed rate limiting.

## Verification

- 14 focused Node tests cover nested query compilation, typed Extended JSON,
  projection rules, protected-field probes, blocked stages/functions,
  complexity limits, irrelevant option omission, credential redaction, and
  safe CSV export.
- Targeted ESLint passes; changed-file TypeScript diagnostics are clean.
- Full Vite client + Nitro Vercel build passes, including the Vercel output
  shell/filesystem-route verification.
- Chrome desktop and 390px mobile QA covered nested filters, typed regex,
  projection/sort, aggregation stage add/select/enable controls, request copy,
  protected-collection messaging, full-page scrolling, and horizontal
  overflow. The real anonymous API returned 401 and the final page rendered
  only the admin-access guard.

## Notes

- The old `RawResult` row component was removed; result rendering is now owned
  by the bounded response component.
- Static capability lists follow MongoDB's official predicate and aggregation
  catalogs. Unsafe or operational tools remain excluded even if MongoDB lists
  them alongside read stages.

## Follow-up — main refresh and auth return (2026-07-12)

- Merged current `origin/main` after PR #62 landed. The only conflicts were the
  generated Graphify report/manifest pair; the branch's graph directory was
  taken atomically and regenerated from the combined source tree instead of
  hand-merging generated data.
- Login and registration now return standalone users to the last non-auth page
  they visited, preserving its query string and hash. The destination is kept
  only in session storage, consumed after a successful auth response, and
  validated as an internal non-auth/non-API path to prevent redirect loops or
  open redirects.
- Embedded account-switcher login/register remains in place and does not
  consume the pending page destination.
- Added focused auth-return tests for route preservation, reload-style reads,
  one-time consumption, auth-loop rejection, API-path rejection, and malicious
  external/backslash destinations.
