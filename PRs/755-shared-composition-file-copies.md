# PR #755 — Independent files in shared app forks

## Contract and implementation — 2026-09-10

The internal exact-version copy primitive is now called by `/things/fork`.
The route advertises `api.things-fork` 1.4.0 on both manifests; the Copy button
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
cannot become unflagged copies. Real-browser linked-gallery acceptance is
recorded below.

Missing dependencies, unretargetable media and excessive target
file counts fail before quota reservation. Write failures clean only preallocated
new Things and files, reporting delayed cleanup rather than claiming rollback
has finished. A revoked source composition also triggers that cleanup.

## Evidence

The f3ecf0fbd follow-up passed Web CI run 34461266645 and received the
exact-head preview deployment dpl_2GRHArvYgCTA88Twpi3FHjRPutoV. The subsequent
develop reconciliation preserves both fork 1.3.3 and device-pairing 1.1.0
contracts; it does not change the copy implementation. Subsequent acceptance
is recorded below.

Unit coverage includes saved URLs, nested CSS, entity-encoded HTML, unrelated
URLs/text, source immutability, shared-file deduplication, exact caller/root
propagation, transactional binding, copy/write failure cleanup and late source
revocation. Exact ID arguments interpolated into content URLs are covered. A
component that assembles a file ID from partial strings now uses bounded root
render `ttMediaRefs` bindings. They apply after interpolation only to media
props and parsed CSS, preserve inputs and labels, and compose on re-fork.
Attachment-content 1.6.3 uses the same mapping during dependency discovery.
Unused pairs grant nothing. Real browser and storage acceptance remains
separate from these focused tests.

## Lopu review correction — non-destructive binding bounds

The `ttMediaRefs` pass runs over an already resolved render tree on its own
visit/depth caps, which are smaller than the resolver's `MAX_RESOLVED_NODES`
budget. It previously returned `undefined` past those caps, so a copied
component nested deeper than about 24 element levels silently lost every node
below that depth: measured at 25 levels, the authored `<img>` disappeared from
the rendered output entirely, while the same template rendered in full before
the copy. The pass now hands the already resolved value back untouched instead.
It stays equally bounded, and the unmapped URL still names only the source
owner's attachment, which `canViewSharedCompositionAttachment` cannot authorize
through this copy — it skips every boundary whose owner differs from the
attachment owner — so a broken image is the worst case, never lost content or
a new grant.

## Deployed storage and browser acceptance — 2026-09-11

Tested revision `5ceb018316c54e7e0435e5779211415de2b7c2ea` on the exact
PR preview. Web CI 34501629665 and CodeQL 34501629651 passed at that revision.
The user explicitly approved a generated tiny image, disposable source/copy
Things, source revocation and cleanup. No account privileges, upload approval,
storage configuration or existing user content were changed.

- A signed-out browser rendered the hidden page's generated 4x4 PNG. Its
  scoped content request returned 200, image/png and 186 bytes matching the
  original SHA-256. Missing-key and unscoped reads both returned 404.
- The signed-in browser API playground copied the page through the real fork
  endpoint: 200 in 2742 ms, one Thing and one file copied. The private copied
  page used a different attachment ID without a source key/sharedRoot.
- After the source became private, the original keyed content request returned
  404. The copied Builder still rendered after reload. After explicit deletion
  of the original stored file (200, deferred=false), a further reload still
  rendered the copied file at natural size 4x4.
- A separate linked-file gallery copied through the same browser playground:
  200 in 515 ms, one Thing and one file copied. Its private post rendered the
  linked-file row after the source post and its attachment were deleted.
  This verifies copied linked metadata, not availability of an external URL;
  the fixture used an example.com .txt URL and never fetched its bytes.
- All four deployed fixture Things and their generated/copied attachments
  were removed through the normal owner routes. Stored file deletions returned
  deferred=false. An initial local gallery fixture was also deleted; its data
  store differs from the preview and is not counted as deployed acceptance.

These real-storage copies used the owner-authenticated API playground because
the owner page shows Edit, not the non-owner Copy button. The button's sign-in
gate and prior non-file composition checks are separate evidence; this is not
a claim of an additional non-owner, file-bearing button-flow test.

## Separate post-login error report — 2026-09-11

The reported `Failed to fetch` stack in deployed `index-CB-14E68.js` maps to
`fetchJson` and `rootLoader` in `remix/app/routes.tsx`. A rejected network fetch
for `/api/root-data` escapes to the default React Router error boundary. The
recovered browser was signed in successfully. The original failed request was
not retained, so CORS, an authentication race or downtime are not established
causes. This PR does not change that separate transient-error recovery path.
