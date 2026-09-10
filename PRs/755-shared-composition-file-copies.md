# PR #755 — Independent files in shared app forks

## Contract and implementation — 2026-09-10

The internal exact-version copy primitive is now called by `/things/fork`.
The route advertises `api.things-fork` 1.3.3 on both manifests; the Copy button
requires that version. `filesCopied` is additive and counts new attachments,
not executable Things. Original Things, ACLs and files are never changed.

The existing composition resolves the program; authored media discovery builds
a copy plan without granting access. Each file copy freshly checks the shared
root/audience and exact stored object version. Normal upload start/finalization
own quota, checksums, type detection, moderation and deferred cleanup.
The internal copy service also checks the recipient's current user-account and
post-purpose upload approval before reservation and between parts/finalization;
it cannot bypass the upload HTTP adapter's permission gate. Denied/unavailable
approval starts no writes, and mid-copy revocation cleans only the new upload.
One abort signal bounds the whole copy phase to 120 seconds. Source composition
access is checked again before and after creating the private copied Things.

New media IDs replace exact first-party URL scalars (including stored component
arguments), parsed CSS URLs and parsed HTML rendering attributes. The 1.3.1
correction also maps exact attachment IDs in persisted argument values/defaults,
nested lists and page-instance overrides. Matching `ttMap` keys and `ttIf`
comparison values are retargeted with those IDs so selection still works.
URL template strings, argument names/labels and unrelated prose remain unchanged. HTML source
patches preserve unrelated text, comments and raw-text containers. No blanket
ID/string replacement or arbitrary external fetch is performed. Each new file
is bound in the target Thing's insertion transaction. Shared references reuse
one copied file, with the existing 25-file limit per binding target.

The 1.3.2 correction also discovers relational ready post-purpose galleries
across contained Things in one bounded home-store query. File bindings prefer
the original contained target over the first page embedding, keeping post/data
galleries intact and ordered while still deduplicating shared files. Discovery
does not grant access; every file uses the same freshly authorized copy path.
Other attachment purposes are excluded. Unsupported or unavailable gallery
files fail the operation rather than silently disappearing.

The 1.3.3 correction copies linked gallery entries through the same quota-
accounted linked-record lifecycle as ordinary linked attachments. Validated URL
and annotations are preserved; external bytes are not fetched or stored, and
downloads still reject linked records rather than redirecting. Source access,
URL/metadata and upload approval are rechecked around creation; late changes
clean only the new private record. Pending, blocked or NSFW linked sources
cannot become unflagged copies. Real-browser linked-gallery acceptance remains
part of the pending storage/copy acceptance check.

Missing dependencies, unsupported split-ID media and excessive target
file counts fail before quota reservation. Write failures clean only preallocated
new Things and files, reporting delayed cleanup rather than claiming rollback
has finished. A revoked source composition also triggers that cleanup.

## Evidence and remaining acceptance

The f3ecf0fbd follow-up passed Web CI run 34461266645 and received the
exact-head preview deployment dpl_2GRHArvYgCTA88Twpi3FHjRPutoV. The subsequent
develop reconciliation preserves both fork 1.3.3 and device-pairing 1.1.0
contracts; it does not change the copy implementation or remove the acceptance
requirements below.

Unit coverage includes saved URLs, nested CSS, entity-encoded HTML, unrelated
URLs/text, source immutability, shared-file deduplication, exact caller/root
propagation, transactional binding, copy/write failure cleanup and late source
revocation. Exact ID arguments interpolated into content URLs are covered. A
component that assembles one file ID from multiple partial strings is still
explicitly rejected before writes; supporting that case remains unfinished.

Real private-object-store copying and the browser Copy button after source
revocation still require acceptance. Mocked storage and a healthy preview shell
are not evidence of those outcomes. Do not treat this PR as full-goal completion
until those cases have been exercised.
