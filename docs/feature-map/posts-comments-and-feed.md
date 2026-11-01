# Posts, comments and feed

Typed Posts and comments retain explicit `crystal.renderComponent` metadata.
The root declaration takes precedence over legacy nested `crystal.thing` in
`PostInteractiveThing`; the linked embed still reads its Component through its
own ACL. See [the presentation contract](api-endpoints-and-capabilities.md)
for validation, versions and regression checks.

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
| Emoji picker, retained input and personal quick reactions | `app/components/Emoji/EmojiPicker.tsx`, `useRecentReactions.tsx`, `reactionPickerState.ts`; `PostCard.tsx` shares them across posts/comments |
| Messenger reaction chips and retained emoji input | `app/components/Messenger/MessageRow.tsx`, `MessengerEmojiPicker.tsx`, `Composer.tsx`; shared `Emoji/useEmojiPickerDraft.ts` scopes drafts to identity and message/chat/thread |
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
- `test:feed` includes reaction token/schema, recent ordering and identity-scope
  regressions. `test:emoji-picker-acceptance` exercises long combinations,
  dismissal/reopening, nine quick recents and real post/comment reaction readback
  in an isolated API/browser environment at desktop and mobile sizes. It also
  checks Messenger Chats/Spaces reaction readback, full wrapping chips, dismissal
  drafts and composer insertion; `test:messenger` covers its API contracts.

Reaction combinations share `utils/reactionTokens.ts` across feed, Messenger
and the canonical reaction schema. `api.things-react` 1.2.1,
`api.chats-react` 1.0.3, `api.things` 1.46.2, `api.things-update` 1.15.1 and
`api.schemas` 1.1.1 remove the obsolete token-length caps. Emoji-only grammar,
ACLs, storage accounting and request transport validation remain enforced.
The custom input survives popover dismissal per account/origin/database/target;
the quick popup supplements defaults with nine unique recent tokens. Server
snapshots retain current server order, including other-device use; delayed
older replies cannot displace newer confirmed selections.

## Account drafts and templates

See [account-drafts-and-templates.md](account-drafts-and-templates.md) for the
private draft API, editor recovery, account isolation and independent media copies.

## Post as a Character

`components/Characters/CharacterComposer.tsx` supplies the selected account to
the existing PostComposer, useApi and private drafts through a keyed context.
Quick comments and nested replies use PostAsSelect with a captured actor header.
See [Characters](../characters.md). Subspace permissions are checked as the
selected Character; owning the Character does not inherit private membership.

## Subspace messages and embedded Things

Subspaces provision a stable Messenger space and general channel through
`api/utils/messenger/subspaceMessages.ts`. `subspaceAccess.ts` checks current
subspace membership for chats, previews and media. The registered
`subspace-messaging-spaces` migration provisions existing subspaces.

`SubspaceViewControls.tsx` uses editable Builder blocks. Viewer-scoped
`subspaceViewPrefs.ts` persists Posts/Messages and automatic comment expansion.
`SubspaceMessagesPanel.tsx` shares Messenger's ChatView; hidden views preserve
drafts without advancing message read receipts.

Moderators manage sidebar and above-feed Thing placements with
`/api/v1/subspaces/embeds` (`api.subspaces-embeds` 1.0.0). Each placement is a
protected relational `subspace-embed` Thing. Readers must pass the subspace gate
and the referenced Thing's independent ACL on every load. Embedding never
changes an audience or shares a hidden link secret.

`PostInteractiveThing` delegates ordinary data Things to the shared `ThingView`.
Human-facing data declares `renderComponent: { id: "<saved Component Thing ID>" }`
or embeds the canonical Component crystal directly, for example
`renderComponent: { render: { tag: "p", children: ["{text}"] } }`.
`ThingRenderComponent` reads a referenced Component through the normal Things
API and its independent ACL, then uses the existing Component argument/template
resolver and inert HTML/Chakra renderers. Bindings receive the displayed data
(also available as `thing`), defaults and saved arguments. Sources and Actions
do not execute in this display context. Saved Component/Webpage Things retain
their existing editable definitions and rendering paths.

An explicit declaration takes priority over legacy kind rendering, including
when invalid or inaccessible; it never falls back to a type alias. The data
inspector is a deliberate toggle. Identity changes fence pending reads, and
focus/visibility refreshes recheck referenced Component access. The containing
Thing does not grant access to its renderer or dependencies. Preserve data,
ownership and audiences when assigning renderers to older Things.
`TransientBlockHost` captures only its own transient Action controls, allowing
the embedded Thing's native view toggle and nested controls to receive events.

Run `test:subspaces`, `test:messenger`, `test:feed`, `test:api-capabilities`, then
`test:subspace-messages-acceptance` against the built server. The latter creates
its own OS-fenced disposable replica and real API fixtures; `--ui` additionally
checks desktop/mobile rendering and saved controls.
The feed suite includes `thingRenderComponent.test.ts`; the acceptance harness
covers saved/embedded render declarations, exact saved content and both embed
placements with rendered/data views and reload.
