# Canonical native Things services — 12 November 2026

The canonical Things service now uses the protected SQLite request scope for
ordinary Data/Folder create, get, batch/list, update, folder move and delete.
Canonical validators, public projection, ACL decisions, storage and Timeline
remain in use. Friend/group/subspace-role reads and execution receipts use actual
local records; absent native data never borrows hosted records.

The focused regressions use real SQLite. Native service commands explicitly bind
both Mongo environment aliases to an unreachable loopback fixture destination;
the execution-receipt fixture also uses a module-level forbidden-Mongo sentinel.
These are service/primitive fixtures, not a claim of native HTTP activation.

## Review findings covered

- Existing Mongo destinations must not be misclassified as folder cycles after
  projection omits fields only the native branch needs.
- Unauthorized unsupported native items remain indistinguishable from missing
  items; supported bodies retain canonical ACL and public projection.
- Legacy child history requires normal quota admission before deleting/refunding
  the root. History/accounting commits with each child move. The overall folder
  drain permits partial progress, matching canonical Mongo behavior; a later
  refusal can leave earlier child moves committed.
- Protected/history and literal archived=true records are excluded before
  chronological pagination; they do not consume visible page slots. Selection
  changes invalidate opaque cursors. Unsupported ordinary types do not silently
  disappear from mixed libraries.
- Request/provider/identity/lifetime, membership pagination, completion-receipt
  binding and no-hosted-fallback checks are retained.

## Latest main integration

Main `762afab2fd157f8490c53fb497cbb31fcf2071b3` is integrated with the service
checkpoint. The combined contract is `api.things` 1.65.0: both parents used 1.64
for different additions, so affected attachment-mutation and upload-policy clients
must reject either incomplete older contract. New requirement regressions cover
that refusal before mutation. Incoming multipart recovery and iOS upload limits
are retained alongside the native account/root-data contracts.

All 13 [combined verification commands](main-integration/verification.json) pass
against 5,493 unchanged inventoried source files (including iOS source). The six
test commands record 2,138 passes, zero failures and the same three skipped Things
checks. TypeScript, zero-error ratchet, full lint (0 errors/375 warnings), canonical
build/inventory and real Mongo/SQLite HTTP restart checks pass. Final Nitro:
`a8816bc20947b965719b6c55c8fb6a40f0c570bc0bfa081c16e15dbcf4488801`.

A [final test-only correction](main-integration/postbuild-test-correction.json)
tightens the Mongo fixture to require Things 1.65+ and agreement between both
built manifest formats. That fixture passes again against unchanged compiled
bytes; its test-file hash change is recorded separately from the frozen run.

The [isolated unsigned iOS compile](ios-main-integration/verification.json) also
passes with this same Nitro payload. All 1,846 canonical payload files match in
prepared and built copies, with only the two pinned native addon substitutions;
native source stays unchanged. This proves compilation and payload integrity,
not simulator launch, Keychain retention, account HTTP, physical-device behavior
or source-to-binary reproducibility of the supplied runtime archive.

The [first integration attempt](main-integration-attempt-1/verification.json)
stopped at a stale file-route capability assertion (1.13.0 instead of the already
documented 1.13.1); its earlier passing checks are retained without claiming the
stopped build/runtime checks ran. [Merge review evidence](merge-review.json)
records the version-collision finding and worker-reported targeted regressions.

The [current chat tool inventory](host-tool-inventory.json) exposes no dedicated
anonymous render/export artifact tool. Current-host artifact invocation remains
unverified; this is separate from local runtime verification.

## Pre-merge service verification and remaining work

All 15 ordered verification commands passed against 5,257 unchanged source
files. The eight test commands recorded 1,300 passes, zero failures and three
skips: native permalink browser acceptance, the 513 MiB Blob round-trip, and the
4 GiB+1 ZIP64 fixture. Those skipped checks are not acceptance evidence.
TypeScript and its zero-error ratchet pass. Full lint reports zero errors and
374 warnings. The canonical Electron web build and packaged inventory pass.

Both actual bundled HTTP fixtures pass: MongoDB includes the new folder
move/cycle/deletion/restart regression; SQLite verifies the account/root-data
slice through actual macOS safeStorage and a fresh process. It explicitly reports
`thingsSupported:false` and `externalMailDelivered:false`.
Built Nitro SHA-256:
`756f299d694d02ab319145defeb1494cd159e1f3d2d61fc763bc66d7d1ed7550`.

[Service command/source receipt](verification/verification.json) records the exact
base plus source inventory, commands, exits and built payload hashes. The
[plan receipt](plan/verification.json) covers isolated Chromium at 1440/390/320px.
The actual bundled Mongo HTTP fixture now covers valid folder moves, cycle
refusal, child-preserving deletion and fresh-process retention in addition to
account/private-content checks. SQLite account HTTP remains a separate test.

Generic native Things HTTP remains unavailable. Full contract support still needs
schema/composition dependencies, app/PAT namespaces, trusted composed hooks,
managed kinds and target cascades, then truthful capability activation and real
SQLite HTTP/native UI acceptance. The whole api.things feature must not be
advertised from a small supported service subset. Remaining history writes
(notes/version names), saved-page captures, indexed queries, broader UI/iOS and
production/hosted-MCP acceptance remain open.
No production deployment, stable-app replacement or existing account content
mutation is part of this checkpoint.

Graphify is refreshed structurally for this checkpoint. Earlier semantic
extraction exhausted its bounded timeout; new complete semantic documentation
coverage is not claimed, and the shared LLM proxy remains unchanged.
