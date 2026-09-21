# Sharing and audiences

Who may read a Thing is decided by its `acl` (v2) — `tt:all`, `tt:user`
(owner only), `tt:userFriends`, `tt:userFamily`, `tt:hidden` (anyone with the
canonical link), `tt:custom` + `tt:user/<name>[/comment|/write]` and
`tt:group/<id>` grants, `tt:inherit` (children follow their target). Legacy
`visibility` maps onto `acl` at read time.

## Where the code lives

| Concern | Path |
| --- | --- |
| ACL evaluation (`canView`, `canViewInherited`, `aclAllows`, inherit chains) | `app/api/utils/things/things.ts` |
| Viewer shape and enrichment (`viewerOf`, `withFriendIds`, `withLinkKeys`, `withThingLink`) | `app/api/utils/things/things.ts` |
| Hidden-post discovery receipts (anonymous browser identity) | `app/api/utils/things/foundPosts.ts`, `foundPostRequest.ts`, `app/hooks/foundPostIdentity.client.ts` |
| ACL grammar, constants, `visibilityFromAcl`, `aclFromVisibility` | `app/schemas/registry.ts` |
| Custom audiences UI (compose `tt:custom` ACLs) | `app/components/Feed/CustomAudienceModal.tsx` |
| Audience labels, share paths (`sharePathForThing`, `thingPath`) | `app/components/Sharing/audienceCore.ts` |
| Shared compositions (pages/components embedding media), collaborator writes | `app/api/utils/actions/sharedComposition.ts`, `compositionMediaCore.ts`, `forkCompositionCore.ts` |
| Fork / private copy of shared Things | `app/components/Sharing/forkThingCore.ts`, `ForkSharedThingButton.tsx`, `app/routes/api/v1/things/fork` |
| Shared-link context in the client (`key`, `sharedRoot`) | `app/components/Sharing/SharedMedia.tsx`, `sharedMediaCore.ts` |
| Canonical link copying (never leaks legacy keys) | `app/components/Thingtime/ContextMenu/thingEntityLink.ts` |

## Authorization helper

- Single Thing reads: `findViewableThing(id, viewer)` — enriches friends,
  applies `withThingLink` (knowing an unlisted Thing's canonical id is the read
  capability) and `canViewInherited`.
- Lists/pages: filter with `canViewInherited` per doc; never disclose a child
  because its target is viewable when the child carries its own ACL.
- Attachments: the target's ACL via `canViewHomeAttachmentTarget` (see
  [attachments-and-media.md](attachments-and-media.md)).
- Engagement on `tt:custom` Things needs the comment capability; shared editing
  needs write. Saves are private bookmarks and exempt.

## Decisions to respect

- Canonical URLs authorize unlisted Things (PR #860): share controls emit the
  plain permalink, never `?key=`. Legacy keyed URLs still work while the ACL
  says hidden. Removing `tt:hidden` revokes anonymous access immediately.
- Folder audience never leaks into folder contents; each child is judged on
  its own inherited ACL.
- A shared read-only action or page cannot mint grants from visitor input,
  query values, labels or condition operands.
- Private copies (`fork`) need fresh owned identities and rewritten media
  bindings; copying a copy must work.

## UI entry points

- Post menu privacy submenu and hidden-link toast: `app/components/Feed/PostThingMenu.tsx`, `PostCard.tsx` (`handleVisibilityChange`).
- `/things` share dialog (folder audience, optional recursive apply): `app/components/Things/ThingsDialogs.tsx` `ShareDialog`.
- Audience chip text: `audienceDescription` in `audienceCore.ts`.

## Tests

- `npm --prefix remix run test:acl` (inherit chains), `test:feed`
  (`hiddenLinkContract.test.ts`, audience stacking), `test:actions`
  (shared compositions), `test:things`.
- `TESTING.md`: "Post interactions & inherit chains", "Things page" (share
  dialog), sharing sections under the attachments and webpages checklists.
