# Lopu verified access, usage accounting and credits — design note

Branch `claude/lopu-verified-credits` → `develop` (then promoted to `main`). Builds on the
delivered Lopu assistant (PR #592, note `PRs/592-claude-lopu-ai-chatbot-358029--lopu-ai-assistant.md`).
Everything below is normative for the implementation agents; where code and note disagree,
fix the code or amend the note in the same change.

Owner request (2026-09-06): lock Lopu AI usage behind an account **verified** flag that defaults
to false for new users; add usage accounting for accounts that do not bring their own model/API
key; add credit top-ups and credit usage tracking. Merge to develop and main when complete.

## 0. House rules (same as PR #592)

API only; unified things path; no new MongoDB indexes (reuse `ownerId`/`kind`/`uniqueKeys`
indexes — check `ensureIndexes()` before writing a query); protected kinds via dedicated writers;
three-place endpoint registration + `RATE_LIMIT_DEFAULTS` + `apiTests.ts` (group `lopu`) +
`scripts/verify-lopu.mjs`; capability manifest bumps in `apiDocs.ts` (both `contractVersion`
and `featureVersion`) with pins in `apiCapabilities.test.ts` / `thingtimeCapabilities.test.ts`;
notifications via `useLopu()`; optimistic rendering from `tt-lopu-*` caches; design language from
`components/Lopu/lopuTheme.ts`; every user-facing feature gets a settings surface.

## 1. Verified access

- **Flag**: `meta.lopuVerified: boolean` on the user thing (absent → false), exactly like
  `meta.publicUploads`. Helper in `api/utils/auth/users.ts`:
  `userLopuVerified(user) = isAdminDoc(user) || isEnvAdmin(user) || user.meta?.lopuVerified === true`
  (admins are always verified). `setUserLopuVerified(userId, verified, actorId)` writes the flag,
  `meta.lopuVerifiedAt`, `meta.lopuVerifiedBy`. `PublicUser` (self projection only) gains
  `lopuVerified: boolean`; the admin directory row gains `lopuVerified`.
- **Admin route** `POST /api/v1/admin/users/lopu-access` `{ userId, verified: boolean }` →
  `{ ok, user }` (mirror `admin/users/public-uploads`; bucket `admin.users.lopu-access` 60/min
  fail-closed).
- **Settings singleton** `Thingtime.LopuAccess` (`api/utils/settings/lopuAccess.ts`, same store
  pattern as `lopuChatDefaults.ts`): `{ requireVerification: true, allowByoUnverified: false,
  starterCredits: 0, lowBalanceWarningCredits: 1 }`. Route `GET|POST /api/v1/settings/lopu-access`
  (GET public → the same shape; POST admin, bucket `settings.lopu-access` 30/min fail-closed).
- **Gate** `assertLopuAccess(user, { billing })` in `api/utils/lopu/access.ts` returns
  `{ ok:true }` or `{ ok:false, status: 403, code: 'LOPU_UNVERIFIED', error }` /
  `{ ok:false, status: 402, code: 'LOPU_NO_CREDITS', error, balance }`. Rules:
  - temporary/guest sessions → 403 (already the case for voice/vault; make chats consistent);
  - `requireVerification && !userLopuVerified(user)` → 403 unless `billing === 'byo' && allowByoUnverified`;
  - `billing === 'thingtime'` and `balanceMicros <= 0` → 402 (starter credits are granted on
    first account creation, see §3), never for `byo`/`free`;
  - `billing === 'thingtime'` and the account already has `LOPU_MAX_CONCURRENT_TURNS` (3) billed
    turns in flight → 429 `LOPU_TURN_IN_FLIGHT` (**reservation**, fixer round 1). The gate reads
    the balance seconds before the debit lands, so without a bounded slot every concurrent reply
    spends the same last credit and the overshoot is the rate-limit window (40 turns), not one
    turn. `assertLopuAccess(user, { billing, reserve: true })` takes the slot — only after the
    balance passed, only for billed turns, and only where a provider call follows (the reply
    route) — and the grant carries `release`, which that route calls in a `finally` (early
    return, throw, or once the turn is on the ledger). A slot whose request died mid-turn is
    swept by the next reservation after `LOPU_INFLIGHT_TTL_MS` (10 min > the 240 s turn cap), so
    a leak costs a slot for a while, never the account.
  Applied BEFORE any provider call in: `POST /api/v1/lopu/chats` (create), `/lopu/chats/reply`,
  `/lopu/voice/reply`, `/lopu/voice/session`. Listing/reading chats stays allowed (history is
  the user's data). `/lopu/musing` is a public site feature and is NOT gated. Error copy is
  Lopu-voiced: "Lopu is invite-only for now — an admin needs to verify your account before it can
  build with you" / "Lopu's credits for your account are used up — add credits to keep going".
- **Billing resolution** (server, per turn): `providerId` (vault) → `'byo'`; test provider or
  canned fallback → `'free'`; Thingtime server keys → `'thingtime'`. `meta` event and persisted
  turn meta carry `billing`.

## 2. Usage accounting

- **Pricing** `api/utils/ai/pricing.ts` (pure): `AI_MODEL_PRICING: Record<modelId, { inputPerM, outputPerM, cacheReadPerM?, cacheWritePerM? }>`
  in USD per million tokens for every catalog model in `AI_WORKFLOW_BASE_MODELS` (use the
  provider list prices you know for each family; when a model's price is not known with
  confidence, use the family's closest sibling and mark `estimated: true`). `priceTurn(model, usage)
  → { costMicros, priced: boolean, estimated: boolean }` (integer micro-USD, round half up, cache
  tokens billed when present). A `test-model` entry (`inputPerM: 1000, outputPerM: 2000`) makes
  the scripted provider's synthetic usage observable in tests. `GET /api/v1/ai/models` gains
  `pricing: { inputPerM, outputPerM, estimated }` per model (public, not secret).
- **Usage from providers**: `chat.ts` already accumulates `LopuChatUsage` (Anthropic
  `input_tokens`/`output_tokens`, OpenAI `usage`); add `cacheReadTokens`/`cacheWriteTokens`
  when Anthropic reports them; the plain-completion rung and the vault client return `usage`
  when the provider does; the test provider reports synthetic usage (100 in / 50 out per hop).
  Voice reply and voice sessions record what the provider returns (sessions: minutes if known,
  else zero tokens, still a row).
- **Kinds** (all protected, `storageClass: 'control'`, dedicated writers in
  `api/utils/lopu/accounting.ts`, rows in `things` per FUNDAMENTALS §3, no new indexes):
  - `lopu-account` — one per user, `uniqueKeys: [thingUniqueKey('lopuAccount', userId)]`, ownerId = user.
    crystal `{ balanceMicros, lifetimeCostMicros, lifetimeInputTokens, lifetimeOutputTokens, turns,
    monthKey: 'YYYY-MM', monthCostMicros, monthTurns, starterGranted: boolean, lowBalanceNotifiedAt }`.
    Created lazily by `ensureLopuAccount(user)` which also grants starter credits once.
  - `lopu-usage` — one per turn, ownerId = user. crystal `{ chatId, requestId, surface: 'chat'|'voice'|'voice-session',
    provider, model, billing, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costMicros,
    priced, estimated, debitedMicros, toolCalls: number, hops: number, durationMs }`.
  - `lopu-credit` — ledger row, ownerId = user. crystal `{ entry: 'starter'|'grant'|'topup'|'debit'|'adjust'|'refund'|'request',
    amountMicros (signed; requests carry the requested amount, positive), balanceAfterMicros | null,
    reason, actorId, usageId?, requestStatus?: 'pending'|'approved'|'declined', note? }`.
- **Atomicity**: `debitLopuUsage(user, usage)` = insert the `lopu-usage` row, then one
  `findOneAndUpdate` on the account with `$inc` (balance, lifetime, month — resetting month
  fields when `monthKey` changed), then insert the `lopu-credit` debit row with `balanceAfterMicros`;
  never a transaction across collections is needed (single `things` collection); a failure
  after the provider call is logged and retried once, never surfaced as a chat error (the reply
  already streamed). `grantLopuCredits(userId, amountMicros, entry, reason, actorId)` is the
  same shape with a positive `$inc`. Balance may go negative by at most one turn per in-flight
  slot (prepaid model, §1 reservation); the next gate refuses.
- **Idempotence is server-minted** (fixer round 1). The `lopu-usage` shareId is minted per
  `debitLopuUsage` call — NEVER derived from the client's `requestId`. A client may legitimately
  re-use a `requestId` (deleting the conversation hard-deletes the `chat-message` whose
  deterministic id would otherwise 409 it), and every re-use is a real provider call that must be
  charged; keying the usage row on it turned one `requestId` into unlimited free turns. The
  `requestId` stays on the row as metadata. The one non-idempotent step, the `$inc`, is guarded
  by that minted id through `crystal.appliedIds` (the last 8 applied write ids, bounded by
  `$slice`), so the app-level retry after a driver error that had in fact committed is a no-op
  rather than a second debit. `grantLopuCredits` takes the same guard on an optional caller-pinned
  `ledgerId`; a top-up approval derives `lopu-credit-topup-<requestId>` from the request, which
  both makes a re-approval harmless and makes "approved but never granted" detectable — an
  approved request with no such ledger row is recovered by approving again instead of 409.
- **Units**: 1 credit = 1 USD of list price = 1,000,000 micros; display credits with two
  decimals (`formatCredits`), cents when < 1.

## 3. Credits

- **Starter credits**: `Thingtime.LopuAccess.starterCredits` (default 0) granted once per
  account on first `ensureLopuAccount` (`entry: 'starter'`).
- **User endpoints** (session only, JSON-only fence, temporary users 403):
  - `GET /api/v1/lopu/account` → `{ ok, account: { verified, requireVerification, allowByoUnverified,
    balanceMicros, balanceCredits, lowBalance: boolean, month: { key, costMicros, turns },
    lifetime: {...}, starterCredits, topupUrl: string | null, pendingRequest: {...} | null } }`
    (bucket `lopu.account` 120/min).
  - `GET /api/v1/lopu/account/history?cursor&limit≤100` → `{ ok, entries: [...ledger rows newest first], usage: [...usage rows for the same window], nextCursor }`
    (bucket `lopu.account` shared).
  - `POST /api/v1/lopu/account/topup-request` `{ credits: number (0.5..1000), note? }` → creates a
    `lopu-credit` row `entry:'request', requestStatus:'pending'` (one pending at a time → 409),
    notifies admins through the existing notification/email boundary if a "new user" style admin
    notification helper exists (reuse it; otherwise the admin panel list is the surface). Bucket
    `lopu.account.write` 10/hour fail-closed.
- **Admin endpoints** (admin only, fail-closed):
  - `GET /api/v1/admin/lopu/accounts?q&cursor` → rows `{ user: { id, username, displayName, lopuVerified, isAdmin },
    balanceMicros, month, lifetime, pendingRequest }` (bucket `admin.lopu.accounts` 60/min).
  - `POST /api/v1/admin/lopu/credits` `{ userId, credits: number (−10000..10000), entry: 'grant'|'topup'|'adjust'|'refund', reason, requestId? }`
    → grants/adjusts; with `requestId` marks that request approved (or `{ requestId, decline: true, reason }` declines).
- **Buy credits**: env `THINGTIME_LOPU_TOPUP_URL` (optional, documented in README with a
  placeholder) is surfaced as `topupUrl`; when unset the UI shows "Request credits" only. No
  payment processor is wired in this change.

## 4. Client

- `components/Lopu/useLopuAccount.ts`: store slice + hook `{ account, loading, refresh, requestTopup }`
  seeded from `tt-lopu-account-<uid>`; refreshed on mount, after every `done` event (which now
  carries `usage`, `costMicros`, `billing`, `balanceMicros`), and on window focus (slow).
- **Locked state** (`!account.verified && requireVerification`, and not admin): `LopuPage`,
  `LopuHost` window/sheet and `LopuVoiceControls` render `LopuLockedState` (🦄 on the ring,
  "Lopu is invite-only for now", one line explaining an admin must verify the account, and for
  admins a link to Admin → Lopu accounts); the composer and mic are disabled; the navbar 🦄 and
  drawer entry stay visible (they open the locked view, no dead ends). BYO providers remain
  selectable only when `allowByoUnverified`. Before the account has landed, `selectLopuAccess`
  needs BOTH halves of the rule: the self projection's `lopuVerified` AND the deployment's
  `requireVerification`, which the store keeps per device under `tt-lopu-access` (written beside
  every account fetch, read on hydrate). Without it a deployment that does not require
  verification greeted a first-visit account with "invite-only" until the fetch landed; with
  nothing cached the server's own default (verification required) still applies.
- **Balance chip** in the composer's left cluster (next to the model chip): "4.97 credits", turns
  amber under `lowBalanceWarningCredits`, red at ≤ 0 with the top-up action; hidden for BYO turns
  (shows "your provider" instead). The per-turn footer ("via Claude Opus 5 · High") appends
  "· 0.0132 credits" for billed turns.
- **Settings → Lopu 🦄** gains a "Credits & usage" block (`components/Lopu/LopuCreditsPanel.tsx`):
  balance, this month, lifetime tokens/cost, history table (ledger + usage, cursor "Load more"),
  "Request credits" form (amount + note), "Buy credits" button when `topupUrl` is set, verified
  status line. Mirrored compactly in `UserSettingsModal` (balance + link).
- **Admin → Lopu accounts** (`components/Admin/LopuAccountsAdmin.tsx`, mounted next to
  `LopuModelsEditor`): search, table (user, verified toggle → `admin/users/lopu-access`, balance,
  month cost, pending request with Approve/Decline), "Add credits" inline form, and the
  `Thingtime.LopuAccess` settings editor (require verification, allow BYO when unverified,
  starter credits, low-balance threshold).
- 402/403 responses from the reply endpoints surface as a Lopu bubble with the friendly copy and
  the relevant action (request credits / contact admin), never a raw error.

## 5. Registration, docs, tests

- Routes: `admin/users/lopu-access`, `settings/lopu-access`, `lopu/account`, `lopu/account/history`,
  `lopu/account/topup-request`, `admin/lopu/accounts`, `admin/lopu/credits` — route files,
  `server/routes/api/[...].ts`, `apiDocs.ts` entries (group `lopu` / `admin` / `settings`), rate
  buckets, `apiTests.ts` (anonymous 401s, JSON-only 415s, shapes), `useApi.tsx` methods.
- `apiDocs.ts` bumps: `ai-models` MINOR (pricing), `lopu-chats` + `lopu-chats-reply` + `lopu-voice-reply` +
  `lopu-voice-session` MINOR (403/402 gate + billing/usage fields). Pins updated.
- `registry.ts`: `lopuAccountSchema`, `lopuUsageSchema`, `lopuCreditSchema` in `thingtimeSchemas` +
  `PROTECTED_THINGTIME`; `storage/storageCore.ts` control-plane list; `builtinSchemaProjection.test.ts`
  rows; FUNDAMENTALS §3 rows.
- `scripts/verify-lopu.mjs`: new user → account unverified → reply 403 `LOPU_UNVERIFIED`; admin
  verifies → account shows verified; starter credits 0 → reply 402 `LOPU_NO_CREDITS`; admin grants
  2 credits → reply streams (test provider, synthetic usage priced with `test-model`) → account
  balance decreased by the priced amount, `lopu-usage` + `lopu-credit` rows listed in history,
  `done` carries `costMicros`; top-up request → pending → admin approve → balance + ledger;
  admin accounts list shows the user; settings lopu-access GET/POST round-trip; generic
  `/api/v1/things` cannot read/write the accounting kinds of another user. Money-bypass
  regressions (fixer round 1): a `requestId` re-used after the chat was deleted is charged again
  and writes its own usage row; four turns in a row all stream (every in-flight slot is released);
  a simultaneous burst only ever streams or refuses with 429 `LOPU_TURN_IN_FLIGHT` and spends
  exactly one priced turn per streamed reply; an admin amount that rounds to 0 micros is a 400.
- Unit tests: pricing (every catalog model priced, rounding, cache tokens), accounting math
  (starter once, debit/grant, month rollover, negative floor), gate matrix (guest/unverified/verified/
  admin × billing × balance), route handlers with in-memory collections, client reducer for the
  `done` fields, `useLopuAccount` normalisation. `test:lopu`, `test:ai-models`, `test:lopu-ui`,
  `test:settings`, `test:schemas`, `test:api-capabilities` all green; lint clean; `build:client` ok.
- Docs: README "Lopu AI assistant" (verified access, credits, `THINGTIME_LOPU_TOPUP_URL`),
  TESTING.md checklist rows, `remix/CHANGELOG.md` entry, this note renamed to `PRs/<n>-…` when the
  PR number exists.

## 6. File ownership

| agent | owns (new) | edits (shared, Edit tool only) |
|---|---|---|
| B1 server | `api/utils/lopu/access.ts` (+test), `api/utils/settings/lopuAccess.ts` (+test), `api/utils/ai/pricing.ts` (+test), `api/utils/lopu/accounting.ts` (+tests), routes `admin/users/lopu-access`, `settings/lopu-access`, `lopu/account` (+`history`, `topup-request`), `admin/lopu/accounts`, `admin/lopu/credits`, `scripts/verify-lopu.mjs` (extend) | `auth/users.ts`, `schemas/registry.ts`, `storage/storageCore.ts`, `lopu/chat.ts` (usage fields), `lopu/chatTestProvider.ts` (synthetic usage), `lopu/chatEvents.ts`, `lopu/voice.ts`, `lopu/vaultProviderClient.ts` (usage passthrough), `messenger/lopuChats.ts` (turn meta billing/cost), routes `lopu/chats/_chats.tsx`, `lopu/chats/reply/_reply.tsx`, `lopu/voice/reply`, `lopu/voice/session`, `ai/models/_models.tsx` (pricing), `[...].ts`, `apiDocs.ts`, `rateLimit/config.ts`, `apiTests.ts`, `apiCapabilities.test.ts`, `thingtimeCapabilities.test.ts`, `builtinSchemaProjection.test.ts`, `FUNDAMENTALS.md`, `README.md` |
| B2 client | `components/Lopu/useLopuAccount.ts` (+test), `LopuLockedState.tsx`, `LopuCreditsPanel.tsx`, `LopuBalanceChip.tsx`, `components/Admin/LopuAccountsAdmin.tsx` | `hooks/useApi.tsx`, `components/Lopu/{lopuChatStore.ts,lopuTurnCore.ts,useLopuChat.ts,LopuChatView.tsx,LopuComposer.tsx,LopuPage.tsx,LopuHost.tsx,LopuVoiceControls.tsx,LopuNavButton.tsx,lopuChatStream.ts}` (+tests), `Settings/SettingsPage.tsx`, `Nav/Drawer/UserSettingsModal.tsx`, `Admin/AdminPanel.tsx`, `TESTING.md`, `remix/CHANGELOG.md` |
