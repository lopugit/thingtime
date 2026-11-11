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

## CI unit regression correction

The build reached unit tests, where `postInteractiveThing.test.ts` still required
`thing` to be the first JSX attribute on the generic ThingView fallback. Adding
the explicit saved `subjectId` changed attribute order without changing the
presentation behavior. The test now inspects TypeScript syntax rather than JSX
text order: it verifies the generic-kind guard, one ThingView delegation, the
canonical crystal presentation helper, exact saved-root identity, compact prop,
and the dedicated Component/Webpage branches. Runtime checks preserve plain
data, legacy nested payloads and explicit render-pointer precedence, including
invalid/null declarations. Product source and API behavior are unchanged.

The exact CI command `corepack pnpm --dir remix run test:unit` is run locally
for this correction, rather than only the previously focused menu suites. It passes in full after both test repairs; focused regressions pass 9/9.
Evidence is retained in the task artifact folder under `unit-fix/`.

The full run also found an old recording-handoff fixture advertising Thing
actions 1.0 after the shared contract moved to 1.1. Its valid fixture now uses
1.1, restoring positive/cancellation/account-change coverage. Separate old,
missing, prerelease and breaking action-contract cases verify refusal before
consent reads, confirmation or writes; a compatible newer minor remains accepted.

## Distinct Archive read contract after current main integration

Main now publishes api.things 1.62 for Component row argument bindings. Archive's
extended owner-library projections therefore deliberately move to api.things
1.63; the Component client floor remains 1.62 (update 1.27, resolve 1.19).
Archive actions/search/bulk retain 1.1/1.7/1.9. Both manifests derive these
versions from the merged canonical registry.

Archive clients compose the existing origin and active-API checkers through a
small shared helper before dependent reads/actions. A frontend advertising 1.63
cannot enable extended queries against an active 1.62 API. Regressions cover
that mixed deployment, missing/breaking versions, and a fresh compatible retry.
The real built-server/Builder contract fixture checks refusal before any
libraryArchive query, then the compatible Archive/Restore path at desktop/mobile.

Combined validation on merged main b3374a16: full CI unit command passed; both
capability generators/checkers passed 178 tests; typecheck passed with zero
errors. Embed remains within the unchanged gzip budget (691,529 / 716,800 bytes).
The rebuilt Nitro API and isolated Chrome contract fixture passed at 1440px and
375px, including active-API 1.62 refusal before a query and compatible recovery.
Focused lint reports zero errors (98 existing hook warnings). Evidence is retained
in the task's `version-163` artifacts. Previously documented standalone embed
router limitation remains unchanged; no new standalone live acceptance is claimed.

Graphify: scoped semantic extraction of the four changed Markdown documents
was bounded at 60 seconds while the healthy local proxy was occupied; it did
not complete. The final structural snapshot is refreshed, but this round does
not claim new semantic indexing of those documents.
