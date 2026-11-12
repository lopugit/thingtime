# Shared native Builder services — 12 November 2026

This checkpoint connects canonical collaborator edits, dependency candidates and
Component/Schema catalog reads to the protected SQLite persistence context.
It also corrects the draft preview handler's database-identity comparison.

Collaborator writes retain document-owner accounting and History, with the
verified writer as actor. Fresh memberships, ACLs and all included dependencies
are checked inside the actual content transaction before quota, CAS and history.
Resolution preserves exact/system/author-local candidate priority and foreign
read boundaries. Included Actions are data dependencies, never executed here.

Catalogs use actual reaction/save/usage records and visible saved versions.
Chronology, saved libraries, popular ranking and family designs are supported;
text/relevance search explicitly refuses with 503 because native storage does
not yet implement Mongo text matching/scoring. Full catalog HTTP remains gated.

The native preview handler receives its public database identity from protected
host composition, never from caller selection. The original real-auth handler
regression returned 409 instead of 200; the failed attempt is preserved below.

## Verification

The [initial batch](verification/verification.json) passed twelve gates before
TypeScript found two missing string guards in catalog membership tests. Its
failure is retained. The [final batch](integration/verification.json) covers
freshly integrated main `f2538e19257bcfdf35ba050e7b187c94ea2252c0` and the fixed
source: **21 commands pass; 3,449 test passes, zero failures and nine explicit
skips**. Counts span commands, not unique test identities. TypeScript, zero-error
ratchet, full lint (0 errors / 376 warnings), canonical Electron build and
packaged inventory all pass. All 5,621 inventoried source files stayed unchanged.
The receipt describes a pending merge plus exact source hashes, not a clean-commit
build. The nine opt-in skips are three Things large-payload/browser checks, one
real-API Action-copy fixture and five Webpage live/browser fixtures; none is
claimed as acceptance.

Actual packaged MongoDB HTTP verifies canonical private CRUD, permission and
revision checks, folder operations and restart. Actual SQLite HTTP verifies
Electron protected storage, registration/login/logout, root data, manifests,
unsupported-route refusal and process reopen. Generic Things remains unavailable
and queued email remains undelivered. These are isolated synthetic fixtures, not
changes to an existing account or the installed stable application.

Final Nitro SHA-256:
`7942080863847d31b3f70f97a5204cfe0e1548f4b3a249524a58f224827c147b`.

Independent review found per-anchor catalog rescans. Grouping now uses bounded
128-key windows and a no-keyed-family fast path. Measured actual-provider tests:
270 unkeyed families use 14 semantic window reads; 271 Components with a
cross-batch family-key/identity collision use 21. Equal-time binary chronology,
270 reactions, 18 designs and offsets above 500 are covered. Keyed grouping still
performs repeated batch scans and is not indexed-query performance parity.

The [plan receipt](plan/verification.json) records isolated Chromium checks at
1440/390/320px, full-page scrolling, filters, search and navigation. It verifies
the tracker, not the native Builder UI. Worker results are parent-reported and
included in the canonical command run. Structural Graphify output does not imply
complete new semantic documentation indexing; the earlier proxy timeout budget
remains exhausted and the shared service/key is unchanged.

Readable logs omit ANSI display controls and trailing whitespace only. Their
original bytes are retained in deterministic gzip archives and independently
hashed in [the normalization receipt](log-normalization.json).

## Native integration

The actual AppleFileSync SwiftPM suite passes with the documented real Rust
indexer fixture: **168 passed, 14 skipped, zero failures**. The first attempt
failed because that helper was missing; both attempts are retained. The helper
was built from locked source in task-owned scratch storage, then supplied through
its documented test setting. Source inventories stayed unchanged. See
[native verification](native/filesync-verification.json). These are native
library tests, not physical Photos/cloud-provider acceptance.

The [isolated unsigned iOS development build](native/ios-compile-verification.json)
passes for the same Nitro hash above. Canonical payload bytes match the prepared
and built copies with exactly two pinned native addon substitutions; complete
LocalRuntime inventories and imported Node framework bytes match. Native source
hashes stayed unchanged. This establishes compilation only: no simulator launch,
Keychain operation, installation, signing or physical-device acceptance occurred.

## Remaining acceptance

No new native Things, resolve or catalog HTTP capabilities are activated. App/PAT
namespaces, trusted composed hooks, Actions, managed kinds, target cascades,
attachments, service-workspace/external-source audiences and native text search
still require canonical integration. Then verify actual SQLite HTTP and Builder
editing, save, reload and restart. History metadata writes, indexing, wider
adapters, iOS protected-runtime/device acceptance, distribution trust and
connected-host downloadable render/export artifacts remain open.

Local MongoDB is independently supported and verified on desktop; no iOS MongoDB
port is claimed. No merge, production deployment, stable app replacement or
existing product account-data mutation is included.
