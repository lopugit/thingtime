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

## Debug notes

- Browser pane had the known scroll-render/hit-test quirk in this worktree —
  used the tall-viewport workaround + DOM-level clicks for interaction
  verification (documented previously in memory; app code unaffected).
- graphify local update produced the known full-rebuild churn; graph diff
  discarded, source-only commit.
