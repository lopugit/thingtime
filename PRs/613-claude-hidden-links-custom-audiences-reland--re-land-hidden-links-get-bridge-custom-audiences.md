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
