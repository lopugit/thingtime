# PR #908 — Save edited Web standards examples as reusable Components

The workbench previously ran an edited program but saved the catalogue's
original example. Its authored `save-draft` Action now receives the current
validated program and stores it as a private Component through the Things API.
The optional named field on the reusable Web Platform primitive carries JSON
form data; no save endpoint is hardcoded into that primitive.

## Data and compatibility

- Run and Save share one draft snapshot. Current parameter values become saved
  defaults, preserving false, zero, empty strings, null and nested arrays.
  Changed parameter definitions discard incompatible stale overrides.
- JSON Action inputs are reusable across browser and server Actions. Forms
  decode text before transport; API strings remain literal through nested calls.
  The schema rejects executable/non-JSON data, cycles and unbounded structures.
  Resolved defaults and child invocations spend their input byte budgets.
- Component resolution treats complete `tt-web-platform.props.program` values
  as opaque data. It preserves `{tokens}`, template-shaped objects and array
  nesting. An explicit top-level `ttArg` still binds a program from scope.
  Opaque copies use the shared resolver budget and refuse partial programs.
- Main PR #905 is integrated. JSON additions use `api.things` 1.33.0,
  `api.things-update` 1.10.0 and `api.actions-run` 1.12.0. The execution grammar
  retains main's 1.11.0 version. Suite installation requires 1.3.0.
- The original catalogue-template save Action stays available for older pages.
  New installations contain seven Things. Production upgrade should install
  only the missing Action and PATCH the exact owned workbench with its current
  `expectedUpdatedAt`; customized unrelated Things must remain untouched.

## Validation — 2026-09-26

- Focused post-merge tests: 199 passed. Full Action suite: 155 passed, one
  opt-in integration skipped. Webpage suite: 131 passed, three opt-in tests
  skipped. Schema suite: 236 passed.
- Web Platform suite: 35 passed, including real HTTP installation, private
  readback and saved-program execution preparation on a disposable loopback
  replica. The extended API test separately passed nested JSON strings and
  root/child input-budget refusals. Fixture Things were removed by exact ID.
- In-app Browser used a separately registered disposable local account.
  Authored a program, changed all four input types, ran it, attempted an invalid
  save (form error, zero saved Components), corrected and saved it once. Exact
  API readback preserved its program/defaults and denied an anonymous read.
- Opened the saved Thing and ran its live Component. Reused that same ID on a
  new private page, ran it in Builder View, visited the page and reloaded it.
  Every result remained `[0,false,"",[[null,false],[0,"{name} $input.other"]]]`.
- Measured the saved page at 390×844 and 1440×1000: document scroll widths were
  390 and 1440 respectively; the program stayed within the viewport. Inspected
  mobile and desktop screenshots. Reset the viewport override afterward.
- Full Vercel build and output verifier passed after main integration. Current
  typecheck has 89 errors, matching the existing baseline; no new diagnostic.
  Changed-file lint had zero errors and three existing warnings.

## Delivery

Branch: `codex/web-standards-save-drafts`.
PR: https://github.com/lopugit/thingtime/pull/908 .
Hosted preview, final CI, merge and production upgrade verification are pending.
The full standards goal is still incomplete; this batch fixes reusable saving,
not the remaining feature coverage.
