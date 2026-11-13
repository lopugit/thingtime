# Sharing and audiences

Who may read a Thing is decided by its `acl` (v2) — `tt:all`, `tt:user`
(owner only), `tt:userFriends`, `tt:userFamily`, `tt:hidden` (anyone with the
canonical link), `tt:custom` + `tt:user/<name>[/comment|/write]` and
`tt:group/<id>` grants, `tt:inherit` (children follow their target). Legacy
`visibility` maps onto `acl` at read time.

## Where the code lives

Growing ACL subject entries are protected relational `acl-entry` Things.
`things/relationalAcl.ts` owns selective authorization lookups, list candidate
joins and transactional generations; `aclBaseline` stores the finite logical
audience while `acl` protects older readers. Legacy API projections still return
complete ACL arrays. The
owner-only `/api/v1/things/acl` route pages and atomically adds/removes grants
under `api.things-acl` 1.0.0. See [relational access](../relational-access.md)
for migration, concurrency, reporting recovery and verification.

| Concern | Path |
| --- | --- |
| ACL evaluation (`canView`, `canViewInherited`, `aclAllows`, inherit chains) | `app/api/utils/things/things.ts` |
| Database-enforced legacy writer fence and operational timestamp floor | `app/api/utils/mongodb/aclWriteFence.ts`, `thingMutationTimestamp.ts`, `collections.ts` |
| Viewer shape and enrichment (`viewerOf`, `withFriendIds`, `withLinkKeys`, `withThingLink`) | `app/api/utils/things/things.ts` |
| Hidden-post discovery receipts (anonymous browser identity) | `app/api/utils/things/foundPosts.ts`, `foundPostRequest.ts`, `app/hooks/foundPostIdentity.client.ts` |
| ACL grammar, constants, `visibilityFromAcl`, `aclFromVisibility` | `app/schemas/registry.ts` |
| Custom audiences UI (compose `tt:custom` ACLs) | `app/components/Feed/CustomAudienceModal.tsx` |
| Audience group membership (transactional add/remove batches, legacy replacement, owner session fence) | `app/routes/api/v1/groups/_groups.tsx`, `app/api/utils/groups/groups.ts`, `app/hooks/useApi.tsx` (`groups.createWithMembers` / `groups.updateMembers`), `app/hooks/groupMemberBatches.ts` |
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
- `npm --prefix remix run test:acl:relational` includes validator readiness,
  monotonic timestamps, generation races and protected metadata checks. The
  isolated mixed-runtime HTTP checks are in `scripts/agent-reporting-acceptance.mjs`.
- Group delta batches, uncertain outcomes and identity changes: `node --experimental-test-module-mocks --import tsx --test app/api/utils/groups/groups.test.mts` and `node --import tsx --test app/hooks/groupMemberBatches.test.mts` from `remix/`. Built HTTP acceptance is `node scripts/group-membership-acceptance.mjs`; `--browser-only` checks the real picker at desktop/mobile widths, interrupted responses and inline recovery. `--legacy-only` with `GROUP_MEMBERSHIP_LEGACY_BUILD` pointing to a built pre-change API creates an unstamped group through that prior API, verifies finite-quota edits fail closed, then runs `backfill-user-storage-accounting` through the admin API and verifies editing and exact ledger refund. These need local `mongod`, a Node-preset build, and Playwright for the browser variant. The disposable admin test setup raises registration throughput only inside its isolated replica set. Foreign owners receive 404.
- Rollout prerequisite for existing PR1497 groups: run the supported `backfill-user-storage-accounting` admin migration after deployment and verify storage readiness before accepting group edits. Those older content rows have no storage stamps; finite-quota growth correctly returns `accounting_unavailable` until migration. Preserve the normal subscription quota and ledger. No group/member count ceiling or new index is introduced.
- `TESTING.md`: "Post interactions & inherit chains", "Things page" (share
  dialog), sharing sections under the attachments and webpages checklists.


Branch visual previews use `webpages/componentPreview.ts`: caller-authored
blocks never supply an inherited root audience. Resolution is batched under
the actual viewer in the selected data plane; guessed private components
return missing refs. Branch audience edits are version content, not a live
sharing operation. See the visual branch checks in `TESTING.md`.


Timeline page versions retain readable component definitions as owner-private
`component-binding` events. Capture uses the same batched page resolver and
inherited audience rules, then projects only id/crystal. It never borrows another
owner's private Timeline, credentials, grants or hidden-link keys. A retained
readable definition is a private point-in-time copy after source revocation;
subsequent captures reevaluate access. `test:timeline:components` checks both
retention and refused guessed private refs. Historical previews do not execute
Actions or live data; they do not grant access to linked media or nested sources.


Named-branch merge previews read only that owner's retained capture records,
validate exact linked event/Thing identities, and never resolve current components
as a historical fallback. Choosing a definition changes the private branch event's
links, not live sharing or the source component. Preview Actions and sources
stay inert. The ordinary owner/source fences apply to comparison and upload.

Canonical Builder content carries `builder-thing` provenance alongside its
content kind. `forkThingCore.ts` ignores only that passive marker when checking
standalone shared composition roots; the marker alone, unknown/control kinds
and target-attached records remain ineligible. This keeps sharedRoot media,
dependency reads, read-only Actions, copies and exports working for newly saved
Webpages/Components without changing their audiences. Run the fork-core and
capability suites, then verify original/thumbnail media on a real anonymous
saved page, including denial for private roots.
