# PR 1463: Shared Archive and Restore in persisted Thing menus

The shipped owner-library implementation excluded Builder mode, so the actual
app cards in the reported iPhone screenshots never received Archive. The repair
moves availability and dispatch into the shared persisted Thing menu rather than
adding a Builder exception. Common action descriptors are resolved for the exact
root on open and reauthorized at write time. Explicit root identities cover posts,
comments, messages, library cards, cloud files, linked Things and saved raw trees.
Raw nested fields name their containing Thing; unsaved values and remote inodes
do not invent persisted identities.

Archive changes private owner library placement only. It never unpublishes,
changes an audience, moves children or alters original source content. Protected
records appear in Archived as static labels with Restore only; generic content
reads, inherited source access and namespace boundaries remain intact. Non-owner
or protected refusal is settled unavailability; transient lookups offer Retry.

Validation: focused menu tests 11/11; backend route/predicate/capability 171/171;
projection 35/35; real built API archive/restore on posts/comments/chat messages;
Chrome at 1440/375 px actual Builder app-card Archive/reload/archived search/Restore,
post/comment/message menus, protected metadata/no-anchor restoration, foreign
refusal, transient retry and controlled same-ID reopen race. Evidence is retained
in the task artifact folder. Final reconciled typecheck passes with zero errors. Mobile menu top/bottom
checks pass. Graphify structural refresh is current; the 127-chunk scoped
semantic attempt exceeded its 150-second bound, so full doc semantics are not
claimed. Native source is unchanged;
production/installed acceptance remains release work after independent review.

## Embed regression correction

The required build reproduced the observed gzip regression at 827,237 bytes
against the unchanged 716,800-byte budget. A raw-tree menu import pulled
`useApi` and its unrelated API graph into the single-file IIFE. A dynamic import
inside that graph would still be inlined because the embed deliberately disables
code splitting. The full app entry now supplies the lazy authenticated controller
to a lightweight menu boundary. The controller is headless: one renderer stays
mounted while its model/handler arrive, preserving focused rows, submenu stack,
scroll and position within the same identity. Identity changes reset the renderer.

The final embed is 691,283 gzip / 2,424,912 raw bytes, within both existing
budgets (135,954 gzip bytes removed). Real Chrome desktop/mobile checks cover
an actual failed controller module request and Retry, delayed first-open, the
same pre-resolution Copy link node retaining focus, mobile close/reopen during
loading, and real Archive/Restore receipts. Local embed JSON does not provide
a persisted subject or authenticated router-root identity; its existing local
editor contract remains unchanged, with no privileged Thing action dispatch.

A separate compiled-popup check is blocked before any menu: both this branch
and a frontend-only build of unmodified main c5cc2b08a produce an empty bridge
with `useRouteLoaderData must be used within a data router`. The main embed
baseline is 684,813 gzip bytes. Matching screenshots/error JSON are retained in
`embed-lazy/baseline/1440-embed-popup-failure.*` and
`embed-lazy/1440-embed-popup-failure.*` under the task artifacts. This preexisting
standalone bridge issue is not presented as passed acceptance or fixed here.
Hosted identity hooks are reached only when a controller loader is provided.

For the correction refresh, the local semantic proxy at 127.0.0.1:4768 was
unavailable (connection refused, no registered PM2 proxy/listener). Graphify
therefore uses the supported structural fallback; changed-document semantic
coverage is not claimed.
