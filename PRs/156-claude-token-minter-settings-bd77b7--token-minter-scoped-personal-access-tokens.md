# PR #156 — Token minter: scoped personal access tokens for AIs, agents & scripts 🪙

- **PR**: https://github.com/lopugit/thingtime/pull/156
- **Branch**: `claude/token-minter-settings-bd77b7`
- **Areas**: Settings UI, auth/session layer, things route family, API docs, rate limits

## What it is

A Settings → **Token minter** section (logged-in users) that mints revocable,
scoped Bearer tokens so an AI/agent/script can push, update, and scan the
user's things without holding the password. Requested as: expiration
input/slider from 1ms to never, or usage-based (1/10/1000/custom uses), with a
permissions selector per token.

## Design decisions

- **PAT = a session doc** (`purpose: 'pat'` + meta `{ name, scopes, maxUses,
  usesRemaining }`) + the standard signed JWT — the same revocable-credential
  model as browser sessions, service accounts, and app tokens (FUNDAMENTALS
  §5). No new collection; single source of truth; TTL index reaps expired
  docs for free.
- **Default-deny enforcement**: `resolveSessionUser` rejects `purpose 'pat'`
  (one line in the general auth path), so a PAT resolves ONLY through the new
  `resolveThingsActor(request, scope)` used by the things route family and
  the free introspection endpoint. Unwired surfaces (token management, auth,
  OAuth, themes, algorithms, admin) reject PATs structurally, not by
  remembering to check.
- **Scope catalog is a pure module** (`patScopes.ts`, no Mongo imports) so
  the client permissions selector and the server gate import the same
  catalog. Ancestor-covering dot paths mirror `apps/scopes.ts`.
- **Use counting is atomic**: `usesRemaining > 0` filter + `$inc: -1` — two
  racing final requests can never both spend the last use. Scope 403s happen
  BEFORE consumption; `/api/v1/tokens/self` introspection never consumes.
- **ms-precision expiry**: session `expiresAt` (checked by `getLiveSession`)
  is authoritative; the JWT exp is ceiled to the next second. A 1500ms token
  demonstrably dies at ~1.5s.
- **Bearer-only**: a PAT smuggled into the `tt_auth` cookie is rejected — no
  ambient-credential/CSRF surface.
- **Bounded accumulation**: 200 tokens/user cap; revoking a never-expiring
  token stamps a 30d reap date; `tokens.mint` (30/h), `tokens.read`,
  `tokens.revoke` (60/min) rate-limit keys.
- **PUT upsert requires create+update** (it can do either); POSTs whose
  `thingtime` marks reaction/comment require that specific scope (mirrors
  `rateLimitKeyFor`).

## Verification

- 42/42 end-to-end API checks via the real API against the live worktree
  stack (scratchpad `pat-test.sh`): register → mint → CRUD by scope → 403
  without burn → exhaust 3-use token → 1500ms expiry → PUT dual-scope →
  validation 400s → revoke immediate + idempotent → cookie rejection →
  default-deny on tokens/me/themes.
- Live browser desktop (1280) + mobile (375, no horizontal overflow):
  mint flow, narrow-from-full permissions, chip/slider/custom sync, show-once
  reveal + curl example, optimistic list from `tt-pat-tokens-<userId>` cache,
  revoke flip + toast.
- `-docs` routes serve for all three endpoints; `/api/docs` markdown includes
  the tokens group.
- TESTING.md gained a "Token minter — personal access tokens" checklist.

## Round 2 — per-token sandbox (onlyCreatedThings) + select/unselect-all

- Requested distinction: "broad CRUD" vs "can CRUD, but only things made
  with that token". Modeled ORTHOGONALLY to scopes: scopes = WHAT verbs,
  `onlyCreatedThings` = ON WHICH things.
- Every PAT-created thing is stamped `createdByTokenId` (all tokens, not
  just sandboxed — free provenance). Sandboxed mutations check the stamp at
  the existing target/doc load sites in things.ts (`patSandboxBlocks`
  helper on the Viewer, which now carries `pat: { tokenId,
  onlyCreatedThings }` via `viewerOf(user, pat)`).
- Guard map: createThing target-attach (covers comment/react/save/share
  ADDS incl. the generic POST path), toggleReaction + toggleSave early
  guards (their REMOVE paths bypass createThing), sharePost, updateThing
  (covers PUT-replace via upsertThing delegation), deleteThing (stamp in
  the atomic filter + informative 403 on the failure path). Share
  root-swap rule: re-sharing a token-created share of a foreign root
  blocks (the new share would attach to the foreign root).
- Reads deliberately NOT sandboxed (scan-my-things stays useful); the
  sandbox 403 comes after auth so it consumes a use (only missing-scope
  403s are free) — both documented.
- UI: Select all ✅ / Unselect all 🧹 buttons, "Only its own things 🧸"
  switch, 🧸 list badge. Verified 31/31 new sandbox e2e + original 42/42
  re-run + browser both viewports.

## Round 3 — tt:token/<id> grant lists (layered token permissions)

- Owner request: replace the single-value createdByTokenId with a tt:-style
  system so multiple tokens can overlap. Implemented as `tokenAcl: string[]`
  on thing docs with entries `tt:token/<token id>` (slash grammar like
  tt:user/… and tt:app/…, per house style — the colon form 400s).
- Semantics: creator auto-granted on create; owner or any credential that
  can update the thing replaces the list whole (create-seed, PATCH/PUT,
  null clears, max 32, strict regex). Sandboxed mutations require the
  token's entry on the target. acl (view audience) and tokenAcl (credential
  write grants) stay separate axes; tokenAcl is owner-only in projections
  (toPublicThings now actually uses its viewer param for this).
- Back-compat: tokenAclOf() reads legacy createdByTokenId as an implicit
  entry (round-2 docs, incl. any prod-preview writes); a tokenAcl
  replacement $unsets the legacy field so removed grants can't resurrect.
  deleteThing keeps one atomic op ($or over both forms).
- Delegation/self-lockout are deliberate: a granted sandboxed token can
  re-grant peers on its things and can drop its own entry (chmod-style);
  the session always recovers.
- Merge note: the conflict-resolver Action had merged main (#155/#157/
  #159/#161) into the branch twice; local round-3 was committed on the
  stale tip → non-fast-forward. Resolved by merging origin/<branch> back
  in (one TESTING.md conflict: kept the round-3 token-minter checklist AND
  main's new rate-limiting section), regenerating graphify-out with the
  merge per repo rule, re-running all suites on the merged tree, then
  pushing. Edge-cached anon feed/search (`anon=1`) compose cleanly with
  resolveThingsActor — anon path skips actor resolution entirely.
- Verified: 32/32 grants suite + 31/31 sandbox + 42/42 original on the
  MERGED tree + browser desktop/375 mobile (Grant 🆔 button, clipboard
  fallback shows the value in the toast when writeText is blocked).

## Debug notes

- Browser pane had the known scroll-render/hit-test quirk in this worktree —
  used the tall-viewport workaround + DOM-level clicks for interaction
  verification (documented previously in memory; app code unaffected).
- graphify local update produced the known full-rebuild churn; graph diff
  discarded, source-only commit.
