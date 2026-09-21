# Posts, comments and feed

Posts are `post` Things; comments share the post schema
(`thingtime: ['post', 'comment']`, `targetId` = parent) so every comment is
reactable and has a `/post/:id` permalink. Reactions, saves, votes and views are
relational children aggregated on read (`FUNDAMENTALS.md` §3).

## Where the code lives

| Concern | Path |
| --- | --- |
| Public projections (`PublicPost`, attachments, counts, audiences) | `app/api/utils/things/things.ts` (`resolvePostAttachments`, post projection block) |
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

## Tests

- `npm --prefix remix run test:feed` (card change contracts, hidden-link
  contract, reactions, algorithms), `test:things`, `test:editorjs`,
  `test:hooks` (payload shaping).
- `TESTING.md`: "Post interactions & inherit chains", "Post views", poll and
  up/down sections, "Post and comment attachments".
