# Native Builder services — 12 November 2026

Saved Component, Schema and Webpage definitions now use canonical native Things
services alongside Data and Folder. Schema-stamped Data uses the real visible
schema and authoritative name. Page history resolves approved direct Component
references using the same SQLite transaction as content, head and accounting.
Missing or inaccessible Components capture null, matching hosted semantics.
This does not capture a complete recursive Action/Schema/Data dependency closure.

Bound content, relationship and completion-receipt reads use that exact active
transaction. Cursor translation preserves the caller's original selection and
owner/candidate scope; it does not grant access. Foreign/expired transactions,
invalid cursors and caught callback failures prevent commit. After-commit reads
use the normal outer repository. Component scans retain the best candidate per
requested group, rather than retaining every revision; indexed query parity is
still unimplemented.

## Verification

The first three [initial commands](verification/verification.json) passed: the
canonical native suite, document-store and Things suites (651 passes, 3 skipped).
The initial Webpages run exposed a source-inspection test tied to the previous
Mongo-only expression. That failure is retained. The test now locates the actual
resolver and checks both authorization paths, with a real SQLite unlisted-page
regression added before and after database reopen.

Only those two test files changed between inventories; runtime source is
identical. The [continuation](integration/verification.json) reruns Webpages and
completes the remaining checks. Earlier passing suites are reused, not relabeled
as fresh runs. The source receipts identify the exact tree by hashes rather than
claiming a clean-commit build. The canonical `test:native-things` entry is included
in `test:unit`; it overrides both Mongo URI aliases with an unreachable fixture
destination. All SQLite data is synthetic and isolated.

All 17 applicable commands pass, combining the three unchanged initial suites
with 14 continuation checks: **1,883 test passes, 0 failures and 8 explicit skips**.
Counts span commands and are not claimed to be unique tests. TypeScript, the
zero-error ratchet, full lint (0 errors / 375 warnings), canonical Electron
web/Nitro build and packaged inventory pass. Both actual packaged HTTP/restart
fixtures pass: MongoDB covers canonical private content, and SQLite covers the
protected account/root-data slice (`thingsSupported:false`, no external mail
delivery). The continuation inventories 5,503 unchanged source files.

Final Nitro SHA-256: `e84fb066c4bded7d5c5680a7b0c1bcac5d2625abf5c9bdb88c7bfe08a49c4371`.
See the [combined receipt](verification-summary.json) for skipped check names.
Skipped browser, installation and large-payload checks are not acceptance.

Actual cases cover schema provenance, inaccessible schemas, stale CAS,
Component priority, private/hidden page boundaries, snapshot projection and
immutability, reopen, quota-failure rollback of content/head/captures/charges,
foreign transaction refusal, and above-quota page deletion retaining prior
captures. The normal resolver must not expose management link keys or token
permissions, and an unsaved block list cannot inherit a stored page's authority.

The [plan receipt](plan/verification.json) records actual isolated Chromium
1440/390/320px checks, scrolling through the full page, filters, search and
navigation. This validates the progress artifact, not the native Builder UI.

## Remaining acceptance

Generic native Things HTTP remains disabled. Shared writes, app/PAT namespaces,
trusted composed hooks, Actions, managed kinds, target cascades, catalog/picker
counts/search and attachment bindings still need canonical native integration.
Then verify actual SQLite API and Builder editing, save, reload and restart.
Remaining history note/version-name writes, indexed query planning, broader
provider controls, iOS protected runtime and physical-device acceptance,
distribution trust and connected-host anonymous artifact delivery remain open.
MongoDB is independently verified on desktop; this does not establish an iOS
MongoDB server port. No new iOS compile or installed UI acceptance is claimed.

Structural Graphify refresh covers this checkpoint. Earlier semantic extraction
exhausted its bounded timeout; complete new semantic documentation indexing is
not claimed. The shared proxy/key remains unchanged. No merge, production
deployment, stable app replacement or existing product account-data mutation.
