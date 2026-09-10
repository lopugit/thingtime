# PR #755 — Independent files in shared app forks

## Contract and implementation — 2026-09-10

The internal exact-version copy primitive is now called by `/things/fork`.
The route advertises `api.things-fork` 1.3.0 on both manifests; the Copy button
requires that version. `filesCopied` is additive and counts new attachments,
not executable Things. Original Things, ACLs and files are never changed.

The existing composition resolves the program; authored media discovery builds
a copy plan without granting access. Each file copy freshly checks the shared
root/audience and exact stored object version. Normal upload start/finalization
own quota, checksums, type detection, moderation and deferred cleanup.
One abort signal bounds the whole copy phase to 120 seconds. Source composition
access is checked again before and after creating the private copied Things.

New media IDs replace exact first-party URL scalars (including stored component
arguments), parsed CSS URLs and parsed HTML rendering attributes. HTML source
patches preserve unrelated text, comments and raw-text containers. No blanket
ID/string replacement or arbitrary external fetch is performed. Each new file
is bound in the target Thing's insertion transaction. Shared references reuse
one copied file, with the existing 25-file limit per binding target.

Missing dependencies, unsupported template-fragment media and excessive target
file counts fail before quota reservation. Write failures clean only preallocated
new Things and files, reporting delayed cleanup rather than claiming rollback
has finished. A revoked source composition also triggers that cleanup.

## Evidence and remaining acceptance

Unit coverage includes saved URLs, nested CSS, entity-encoded HTML, unrelated
URLs/text, source immutability, shared-file deduplication, exact caller/root
propagation, transactional binding, copy/write failure cleanup and late source
revocation. A component that assembles its content URL from non-URL fragments
is explicitly rejected before writes; supporting that case remains unfinished.

Real private-object-store copying and the browser Copy button after source
revocation still require acceptance. Mocked storage and a healthy preview shell
are not evidence of those outcomes. Do not treat this PR as full-goal completion
until those cases have been exercised.
