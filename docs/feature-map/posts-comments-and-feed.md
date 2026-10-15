# Posts, comments and feed

Posts are `post` Things; comments share the post schema
(`thingtime: ['post', 'comment']`, `targetId` = parent) so every comment is
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
