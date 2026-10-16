# Posts, comments and feed

Posts are `post` Things; comments share the post schema
(`thingtime` includes `comment`, including canonical comment-only records;
`targetId` = parent) so every comment is
reactable and has a `/post/:id` permalink. Reactions, saves, votes and views are
relational children aggregated on read (`FUNDAMENTALS.md` §3).

## Where the code lives

| Concern | Path |
| --- | --- |
| Public projections (`PublicPost`, attachments, counts, audiences) | `app/api/utils/things/things.ts` (`resolvePostAttachments`, post projection block) |
| Anonymous local algorithm profiles | `app/local-workspace/algorithms.ts`, `api.client.ts`; canonical `api/utils/algorithms/algorithmContent.ts`, `algorithmTransferCore.ts` and `utils/thingTransfer/algorithm.ts` |
| Feed ranking / algorithms | `app/api/utils/things/feedRanking.ts`, `app/components/Feed/defaultAlgorithms.ts`, `AlgorithmMenu.tsx` |
| Engagement | `app/api/utils/things/updown.ts`, `vote.ts`, `saved.ts`, `views.ts`; routes under `app/routes/api/v1/things/{react,save,vote,updown,views,comment,share}` |
| Client types | `app/components/Feed/feedTypes.ts` (`PublicPost`, `PublicComment`, `CIRCLE_META`) |
| Request payload shaping (carry every new field through here) | `app/hooks/thingsRequestPayload.ts` |
| Card | `app/components/Feed/PostCard.tsx` (body, actions, edit, privacy, reactions, comments, `mediaThing`, `gallery`) |
| Post ⋯ menu (privacy submenu, moderation, flair, Files section) | `app/components/Feed/PostThingMenu.tsx` |
| Composer (Editor.js rich text, attachments, tags, audience) | `app/components/Feed/PostComposer.tsx`, `app/components/Editor/*` |
| Lists and pages | `app/components/Feed/PostList.tsx`, `Feed.tsx`, `app/routes/feed.tsx`, `post.tsx`, `media.tsx`, `explore.tsx` |
| Account offline read snapshots and conditional bookmarks/reactions | `app/local-workspace/accountPosts.ts`, `accountInteractions.ts`, `accountApi.client.ts`; native Saved and post permalink consumers |
| Reaction overlays and thread cache (optimistic rendering) | `app/components/Feed/reactionOverlay.ts`, `threadCache.ts`, `useFeedEngagement.ts` |
| Subspaces (communities) moderation on posts | `app/api/utils/subspaces/*`, `app/components/Subspaces/*` |

## Authorization helper

Reads go through `findViewableThing` / `canViewInherited`; engagement on
`tt:custom` Things needs the comment capability. Attachments on a post are
authorized per file (see [attachments-and-media.md](attachments-and-media.md)).
Moderation actions require subspace moderator roles (`canModerateSubspace`).

## Rules that bite

- Trace new fields end to end: composer → `thingsRequestPayload.ts` →
  route/body validation → `createThing`/`updateThing` → storage → public
  projection → `PostCard`. Adding a field to one layer is not enough.
- Await the live Editor.js snapshot before freezing a create/edit payload.
  Draft account sync and cleanup run independently: neither may block a post,
  edit, comment or reply. Retire only the completed draft, preserving newer input.
- Optimistic rendering: paint cached state, reconcile in the background, revert
  on failure; never flash a spinner when prior state exists.
- Retries after an uncertain write reuse the original operation identity
  (`shareId`/`requestId`) — never create a second post or upload.
- Every user-facing notification goes through `useLopu()`.

## Shared Thing discussions and references

`app/components/Things/ThingComments.tsx` uses the canonical `PostCard` discussion
on the original Thing id, including cached first paint, nested replies and rich
comments. `PostThingPicker.tsx` selects bounded existing-Thing collections;
`PostLinkedThings.tsx` and `PostInteractiveThing.tsx` render Data/Interactive
choices without registering a viewed attachment as an editable builder target.
`resolvePostLinkedThings` in `things.ts` checks every source ACL using one
request-local viewer so workspace membership lookups can be shared safely.
`test:things` includes `postLinkedThings.test.ts`; `test:feed` covers attachment
registration. Reader revocation must remove linked content on the next read.

Builder Components can render the same discussion through `tt-discussion`
(`app/components/Builder/ComponentDiscussion.tsx`). It accepts a Thing id,
description and collection-controls preference, stays inert in previews, and
refreshes page sources after a comment. It never accepts an authored post
projection or changes target permissions.

## Tests

- `npm --prefix remix run test:feed` (card change contracts, hidden-link
  contract, reactions, algorithms), `test:things`, `test:editorjs`,
  `test:hooks` (payload shaping).
- `TESTING.md`: "Post interactions & inherit chains", "Post views", poll and
  up/down sections, "Post and comment attachments".

## Account drafts and templates

See [account-drafts-and-templates.md](account-drafts-and-templates.md) for the
private draft API, editor recovery, account isolation and independent media copies.

## Device-only algorithms (rollout in progress)

The workspace adapter stores protected algorithm Things locally, trains only on
bounded credential-free public-feed features and ranks each returned page on the
device. Settings and the feed menu use content identity without changing account
authentication. Training flushes, including page-hide, use the captured workspace
facade; identity changes discard queued/session events. Canonical exports omit
lineage and authority and imports do not change active selection. Account profile
sync and full multi-tab acceptance remain outstanding in
[the coverage matrix](../local-workspaces.md).


## Anonymous post authoring

`local-workspace/posts.ts` and `LocalThings.savePost` map and validate native
composer inputs, bind local attachments atomically and project native PostCards.
`anonymousApi` supplies local post GET, comment/reply list and mutation adapters.
Feed creation navigates to the local permalink without injecting it into public
feed results. Local identity and audience never grant server access. Run
`test:local-workspace`, `test:feed`, `test:drafts` and `test:hooks`; verify cold
reload of images and relational comments with the network disabled. `local-workspace/interactions.ts` supplies scoped relational saves, reactions,
polls and up/down votes through the same facade, validators and tally helpers.
The normal Saved page is discoverable without login and isolates caches by full
workspace scope. Content export excludes these managed activity rows; deletion
cascades them. Account interaction sync and full acceptance remain tracked in the
coverage matrix.


Anonymous post/reply controls derive local identity from the adapter's local
author projection matching the active workspace, including restored components'
discussions. `PersistedThingMenu` uses workspace content identity and separately
checks the resolved author for Rename. `restoredRouting.test.ts` plus the clean
offline History/detail browser regressions cover this path; public discussions
and remote recipient operations keep their account requirements.

Account post snapshots are read-only, scoped by account/origin/data plane and
bounded by the existing workspace quota. They never enter owned Things or
content sync. Retain only normal authorized projections, strip bearer-link and
server-only envelopes, and keep attachment bytes behind their existing resolver.
A known 403/404/410 removes the snapshot and nested retained references; refusal
watermarks fence older in-flight reads. The Saved page's first-paint cache is
cleared only for the affected scope. Anonymous workspaces never adopt these
snapshots or account interaction intents.

`accountPosts.browser.test.ts` uses `TT_LOCAL_ACCOUNT_POSTS_URL` and optional
`TT_LOCAL_ACCOUNT_POSTS_ARTIFACTS` with the shared Playwright/Chrome paths. It
creates two disposable local accounts and a username-granted private post,
then exercises offline Save/react, Saved/permalink reload, two tabs, reconnect,
logout isolation and permission revocation. `test:local-workspace` includes its
unit tests; enable the browser test separately against the disposable stack.


Account generic discussions use `local-workspace/accountDiscussions.ts` through
`accountApi.client.ts`. `accountDiscussionProjection` shares the post cache's
allowlisted serializer while retaining the separate discussion shape. Native
`ThingComments` and its pager carry partial-coverage/retention diagnostics.
`accountReadRevocation.ts` atomically clears both read projections, descendants
and embedded references; watermarks fence older responses. Read snapshots never
create owned Things or authorize writes. Run `test:local-workspace`, `test:feed`,
`test:things`, and the opt-in `accountDiscussions.browser.test.ts`; see the
[discussion checkpoint](../local-workspaces.md#account-discussion-reads-and-refusal-cleanup--2026-10-17).


Account post/comment authorship reuses `LocalThings.savePost`, `AccountThingSync`
and the normal `accountThingTransport` comment endpoint. Retained foreign
projections authorize only device storage; server access is checked on sync.
`accountAuthoring.browser.test.ts` exercises the native private post composer;
`accountDiscussions.browser.test.ts` also creates offline comments and replies.
Known refusal prunes synced owned read copies while preserving pending work.
Bound media and remaining native mutation coverage stay open in the matrix.


Offline permalink parent/root navigation uses `posts.postThreadContext` and
`AccountDiscussionCache.threadContext`. Account context reads owned content,
read-only snapshots and refusal/deletion fences in one scoped transaction.
`AccountPostCache` retains the canonical response's root reference without
fabricating intervening targets. `accountReadRevocation` clears those references
with descendants; generic parents remain discussion snapshots. Regressions:
`threadContext.test.ts`, plus enabled `details.browser.test.ts`,
`accountDiscussions.browser.test.ts` and `accountBoundRetention.browser.test.ts`.
See the [context checkpoint](../local-workspaces.md#offline-conversation-context--2026-10-17).
