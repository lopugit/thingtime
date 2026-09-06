# PR #613 — Re-land hidden 🕵️ links + PAT GET bridge + custom audiences 🎭 (`claude/hidden-links-custom-audiences-reland`)

## Why

PR #413 (`claude/hidden-links-get-bridge`, base `claude/token-permissions-scope-toggles-8844f0`)
and PR #431 (`claude/custom-audience-groups`, base `claude/hidden-links-get-bridge`)
both merged on 2026-08-29 at 01:06 — one minute AFTER PR #411 had merged their
common base into `develop` at 01:05. Both merge commits landed only on the
stacked base branches, which nobody merged again, so develop and main never
received the feature stack: no `/api/v1/get`, no `tt:custom`, no
`/api/v1/groups`, no `CustomAudienceModal`, `VISIBILITIES` still four circles.
The local worktree `token-permissions-scope-toggles-8844f0` (checked out on
`claude/custom-audience-groups`) was the clue: 17 local commits that the audit
showed were published to the remote branch in rewritten form, but the remote
branch itself was an orphan relative to develop.

This branch starts at `origin/claude/hidden-links-get-bridge` (d826cf6ce, the
#431 merge) and merges current `develop`.

## Merge resolutions (8 conflicting files)

- `remix/app/api/utils/things/things.ts` — imports: both sides (`groupIdsOf` +
  `emitMentionNotifications` / `NotificationActor`); `patVisibilityBlocksAcl`
  exported (develop) with the branch's bucket comment; circle filtering keeps
  `REQUESTABLE_VISIBILITIES` next to develop's tag normalization; `updateThing`
  keeps the custom-audience shared-editing branch AND develop's
  `expectedUpdatedAt` optimistic-concurrency check (the branch's owner-less
  `findOne` stays, since writers may be non-owners).
- `remix/app/api/utils/auth/patTokens.ts` — `allowGet` and develop's
  `createdVia: 'chatgpt-oauth'` both survive (mint input + stored row).
- `remix/app/components/Feed/PostCard.tsx` — develop's `onChanged(post.id, …)`
  contract applied to the branch's three audience / linkKey updates (the feed
  contract test counts every call).
- `remix/app/components/Feed/PostComposer.tsx` — custom acl on edit + develop's
  attachment-panel ids. `share/_share.tsx` — `withLinkKeys` viewer + develop's `tags`.
- `TESTING.md` — both checklists (dropped the branch's stale five-circle duplicate
  of the circle-filter item). Raycast converter and the deprecated API CORS
  shim — develop's versions (both sides fixed the same CodeQL findings).
- `patScopes.test.ts` — the visibility catalog test expects four modes (`hidden`).
- `scripts/verify-pat-tokens.mjs` — develop's search responses key `posts` by
  thing id; the script's `postRows()` helper accepts both shapes.

## Verification (2026-09-05, worktree stack on 11890/11892)

- Unit groups after the merge: acl 6, things 24, pat-scopes 6, api-capabilities 7,
  schemas 120, feed 33, feed-contract 8, hooks 27, nav, auth-introspection 10 — green.
- `pnpm exec eslint` clean on every conflict-resolved file.
- `node scripts/verify-pat-tokens.mjs http://127.0.0.1:11892` — **149 passed, 0 failed**
  across sections A–I (F visibility fence, G hidden visibility, H GET bridge,
  I custom audiences + groups + hidden-only fence).
- CI on the PR: CodeQL, API suite, Build + typecheck ratchet + unit tests — green.

## Lopu review (2026-09-06, head `bdbe02a0`)

Read the full head against `develop` @ `b1f8e212`, concentrating on the three
surfaces this stack widens (bearer-secret reads, a cookie-free *mutating* GET
route, and non-owner writes). CodeQL snapshot for this head is empty; PR checks
are green (23 pass / 63 skipping / 0 failing).

**One defect fixed: the GET bridge silently dropped `expectedUpdatedAt`.**
`updateThing`/`deleteThing` implement it as a real compare-and-swap — validate
the ISO string, compare against the stored `updatedAt`, anchor `updatedAt` into
the write/anchored-delete filter, 409 on mismatch — and `_things.tsx` threads it
through on both PATCH and DELETE. `_get.tsx` passed neither, so the bridge
answered 200 for a write the caller had explicitly asked to be conditional. That
is a lost-update guarantee, not a missing convenience, and this branch is what
makes it reachable: `tt:user/<name>/write` grants give a single thing genuinely
concurrent writers for the first time.

- `app/routes/api/v1/get/_get.tsx` — thread `expectedUpdatedAt` into `op=update`
  and `op=delete`. An ISO stamp survives the URL surface untouched
  (`overlayValue` leaves non-`{[\"` values as strings) and both callees already
  400 a malformed one, so a mis-encoded timestamp fails loudly, never open.
- `app/docs/apiDocs.ts` — document the guard on the bridge endpoint.
- `scripts/verify-pat-tokens.mjs` — section H gains five checks: stale stamp
  409s on update, current stamp lands, the now-stale stamp 409s on delete
  (which also proves the update really moved `updatedAt`), current stamp
  deletes. Spends 5 of the 12 uses `minted` has left, so the existing
  "use accounting matches the call count" assertion is untouched.

`op=upsert` deliberately keeps no guard: `upsertThing` stays owner-fenced
(`existing.ownerId !== ownerId` → 404), so shared editing is PATCH-only and a
racing writer cannot reach it. `replaceCrystal` is likewise left off the bridge
— `op=upsert` already *is* whole-crystal replacement.

### Verified, no change needed

- **Group membership cannot be self-granted.** `groupIdsOf` trusts any
  `group-member` doc naming the viewer in `targetId`, with no owner constraint,
  so the whole model rests on those docs being unforgeable. They are: `group`
  and `group-member` are both in `PROTECTED_THINGTIME`, generic thing CRUD
  refuses protected kinds, and `groups.ts` only ever writes `crystal.groupId`
  from an owner-fenced `findOwnedGroup` lookup.
- **`updateThing`'s ownership filter was removed** (`{shareId, ownerId}` →
  `{shareId}`) to allow shared editing. Everything downstream still keys off
  `doc.ownerId`, not the writer: storage ledger, `boundAttachmentPresence`,
  the app-namespace stamp. The writer only supplies content — `acl`,
  `visibility`, `folderId`, `tokenAcl` are refused for non-owners, so the
  folder/cycle paths that key off `viewer.id` stay unreachable for them.
- **`linkKey` is treated as a credential, not a field.** Owner-only in both
  projections and gated on the acl *still* saying hidden, re-minted on every
  entry into hidden so retired links can't resurrect, and added to
  `MONGO_PROTECTED_THING_FIELDS` so the admin Mongo surface hard-strips it at
  every pipeline ingress rather than relying on key-name redaction.
- **`splitCapability` anchoring.** `tt:user/write` (the account literally named
  "write") parses as subject `write` with cap `read`, not as base `tt:user`
  (the OWNER entry) — the failure mode would have been a phantom owner grant.
  Backed by the `/`-in-username guard added to `registerUser.ts`.
- `visibilityQueryFor`'s grant clause is gated on the 🎭 circle and narrowed to
  the requested circles, so a grant cannot smuggle a custom thing into a
  public-only filter; `unfiltered` requires the full `REQUESTABLE_VISIBILITIES`
  set rather than a length comparison.

### Validation

- `node --experimental-strip-types --test app/schemas/acl.test.ts` — 12/12 pass.
- `node --check scripts/verify-pat-tokens.mjs`, and syntax checks on
  `apiDocs.ts` / `_get.tsx` — clean.
- CI on `bdbe02a0`: API suite, Build + typecheck ratchet + unit tests, CodeQL —
  all green (run 34009044941).
- The five new section-H checks were authored but NOT executed in this session:
  `verify-pat-tokens.mjs` needs a running stack + database, which the review
  runner does not have. They should be exercised on the next live QA pass.
