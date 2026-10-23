# 09 — Security hardening (unauth endpoints, auth rate limiting, persisted-state eval)

**Status:** 🟡 §§B–D are closed on `develop` — PR #99 merged 2026-08-18 and every
"Done when" box below is checked — as are §A's A1/A2. **The only work left in
this file is §A's A3:** the service-account token is throttled but its lifetime
is still unbounded (see §A3 "Still open"). Do not re-claim §§B–D or A1/A2
· raised 2026-07-08 by a multi-agent review.

This groups the security findings from the 2026-07-08 review. They share a theme
the owner already cares about (DECISIONS.md #5 "security-conscious by reflex":
caught a leaking connection string, wants secrets stripped and tokens revocable).
Everything below was confirmed by reading the cited code — do not trust the
summary over the source, but the line refs were accurate at review time.

Follow `FUNDAMENTALS.md`: all data access stays behind the API + utils layer, and
reuse the **existing** Mongo-backed rate-limit primitive rather than inventing a
second one (single source of truth).

---

## A. Admin / data endpoint exposure (originally unauthenticated — A1/A2 closed, A3 partial)

> ✅ **A1 + A2 shipped (verified on main 2026-07-21):** both routes now call
> `requireAdmin` (401/403) and `enforceRateLimit(..., { failClosed: true })`;
> `raw-results` additionally runs only bounded read-only queries through
> `runMongoQuery` (no raw `find().toArray()` dump).
>
> 🟡 **A3 partially shipped (PR #100, merged 2026-08-12):**
> `_service-account.tsx` now applies the fail-closed per-IP
> `auth.serviceAccount` limiter, a 16 KiB body cap, and an explicit field
> whitelist, so unauthenticated mass-minting is throttled. Still open: the
> minted token is non-expiring (`serviceAccounts.ts` — `signJwt` with
> `expiresIn: null`, `createSession` with `expiresAt: null`) and still carries
> the 5 GiB `storageAllowanceBytes` default. Bound the token lifetime before
> closing A3. (PR #103 was closed unmerged and covered signup/item 8, not A3.)

All three endpoints are still registered in the **production** Nitro dispatcher
(`remix/server/routes/api/[...].ts`). They are no longer ungated: the per-route
gating below is what makes them safe, so it must survive any move or refactor of
these routes. Each subsection records the original 2026-07-08 finding (past
tense) and the current state.

### A1. `POST /api/v1/mongodb/raw-results` — ✅ FIXED
- File: `remix/app/routes/api/v1/mongodb/raw-results/_raw-results.tsx`.
- **Originally:** the action called `getCollection()` →
  `db('thingtime').collection('things')` and ran `thingsCollection.find().toArray()`,
  returning **every** `things` doc to any anonymous caller. That is the same
  collection `createPost` writes `friends` / `family` / `private` posts to
  (`remix/app/api/utils/things/things.ts`), so it bypassed the `canView` /
  `visibilityQueryFor` gating — every private post was readable by anyone.
- **Now:** both `loader` and `action` gate on `requireAdmin` (401/403), then a
  fail-closed `enforceRateLimit(request, 'mongodb.query', …, { failClosed: true })`,
  and the action executes only bounded read-only queries through
  `runMongoQuery` under `MONGO_QUERY_LIMITS`. There is no raw
  `find().toArray()` dump left. Responses are `private, no-store`.

### A2. `POST /api/v1/mongodb/populate` — ✅ FIXED
- File: `remix/app/routes/api/v1/mongodb/populate/_populate.tsx` →
  `remix/app/scripts/mongodb/setup.ts`.
- **Originally:** any anonymous caller triggered DB seeding — demo users created
  with **repo-known seed passwords**, plus dozens of Mongo round-trips and bcrypt
  hashes per request (amplification / DoS). Idempotency bounded row growth but
  not per-request work; docs said "dev only" but nothing enforced it.
- **Now:** `requireAdmin` plus a fail-closed
  `enforceRateLimit(request, 'mongodb.populate', …, { failClosed: true })`, and
  the seed run is time-boxed by a clamped `budgetMs` with a whitelisted `stages`
  filter.

### A3. `POST /api/v1/auth/service-account` — 🟡 THROTTLED, NOT YET BOUNDED
- File: `remix/app/routes/api/v1/auth/service-account/_service-account.tsx` →
  `remix/app/api/utils/auth/serviceAccounts.ts`.
- **Originally:** `provisionServiceAccount` minted a **non-expiring** bearer token
  and granted `storageAllowanceBytes` = **5 GiB** with no caller identity check
  and **no throttle**, so anyone could mass-create accounts to exhaust
  rows/storage and keep permanent tokens.
- **Now (PR #100, merged 2026-08-12):** the route stays public self-service by
  design, but applies a fail-closed per-IP
  `enforceRateLimit(request, 'auth.serviceAccount', null, { failClosed: true })`,
  a 16 KiB body cap (`MAX_BODY_BYTES`), and an explicit field whitelist that
  never spreads the raw body. Unauthenticated mass-minting is throttled.
- **Still open:** the minted token is non-expiring — `signJwt` with
  `expiresIn: null` omits the `exp` claim, and `createSession` with
  `expiresAt: null` never expires — and still carries the 5 GiB
  `DEFAULT_SERVICE_STORAGE_ALLOWANCE_BYTES`. `getCurrentUser` disables an
  **unverified** service token after a 7-day grace, which does not bound a token
  once the supplied email is verified. **Bound the token lifetime before closing
  A3.** (PR #103 was closed unmerged and covered signup/item 8, not A3.)

**Remaining fix for A3:** give service-account tokens a finite lifetime (with a
documented refresh/rotation path) and reconsider the 5 GiB default allowance for
self-service provisioning. A1/A2 need no further work — keep their
`requireAdmin` + fail-closed limiter gating if those routes are ever moved or
rewritten.

## B. Auth-endpoint rate limiting + input caps

- `POST /api/v1/login` (`_login.tsx` → `remix/app/api/utils/auth/loginUser.ts`):
  no attempt counter, lockout, or IP throttle; the dispatcher adds no middleware.
  Only friction is bcrypt cost 10 (skipped for unknown usernames). Credentials are
  brute-forceable at full speed.
- `POST /api/v1/auth/register` (`_register.tsx`): the shared IP-based
  `auth.register` limiter landed in PR #167. Before PR #99, the route still had
  no body cap before `request.json()`; its public action already whitelisted
  fields and never forwarded caller-controlled `meta`.
- `POST /api/v1/auth/resend-verification`: mints unlimited verification tokens per
  request (email cost currently masked only by the dev console stub in
  `remix/app/api/utils/auth/email.ts`).

**Fix:** reuse the shared `enforceRateLimit` path for per-IP auth quotas rather
than adding another registration limiter. Cap register/login body size with
`readJsonBody`; public registration must continue to whitelist accepted fields
instead of forwarding caller-controlled `meta`.

## C. Persisted-state `eval` → arbitrary code execution + no CSP

- Current implementation before PR #99 reconciliation:
  `remix/app/Providers/thingtimeSerialization.ts`, called by
  `ThingtimeProvider.tsx`.
- Its `flatted` hydration path compiled every persisted
  `{ttype:'function', code, ttScope}` payload with `Function`. The paired
  replacer serialised every runtime function back to source. The provider
  persists the entire
  `thingtime` object to IndexedDB via
  `localforage.setItem('thingtime', stringify(state))` on **every** state change
  (L435–438) and revives it on every load (`getItem` L374 → `parse` L381 →
  reviver). It wraps the whole app in `root.tsx`.
- Before PR #99, no application Content-Security-Policy enforced this boundary.
  Anything able to write same-origin storage (an XSS, a
  browser extension, another tab) can plant a `ttype:'function'` payload that
  becomes **persistent arbitrary code execution on every subsequent load**. It
  also breaks the moment a strict CSP ships.

**Fix:** stop `eval`-based function revival — either drop function persistence
entirely, or replace it with a sandboxed / integrity-signed representation — and
add a CSP without `unsafe-eval`. (A CSP also interacts with the Emotion-hydration
work in TODO #1, so coordinate.)

## D. (related, lower severity) the persist reviver corrupts ordinary strings

Not strictly "security" but same file and same reviver — see **TODO #9**: the
`Date.parse`-based revival at `ThingtimeProvider.tsx` L30–34 turns strings like
`"Post 1"`, `"2024"`, `"March 2024"` into `Date` objects on reload, then the
replacer rewrites them as ISO strings, permanently corrupting user data. Fix it in
the same pass: restrict revival to a strict ISO-8601 pattern, or tag Dates in the
replacer (mirror the `ttype:'function'` scheme with `{ttype:'date', iso}`) and
revive only tagged values.

---

## Done when

- [ ] 🟡 A1–A3 require auth (or are dev-gated + removed from the prod dispatcher);
      any that remain apply visibility filtering. _(A1 raw-results + A2 populate
      became admin-only + rate-limited fail-closed in earlier PRs; A3
      service-account provisioning stays public by design — "anyone can
      provision a service account, so accountKind confers no trust" — but is now
      rate-limited fail-closed per IP (`auth.serviceAccount`), body-capped at
      16 KiB, and field-whitelisted. 2026-07-21.)_ **Still open:** A3's minted
      token is non-expiring (`signJwt expiresIn: null`, `createSession
      expiresAt: null`) and carries the 5 GiB default allowance. Bound the
      lifetime before checking this box — see §A3.
- [x] Login / register / resend-verification return 429 past a per-IP (and
      per-username, for login) threshold, reusing the existing quota util.
      Login + resend already enforced the shared `enforceRateLimit`; the
      IP-based `auth.register` rule (10/15min) landed separately in PR #167.
- [x] Register/login enforce a body-size cap; `meta` is whitelisted/bounded.
      Register now reads via `readJsonBody(request, 16 KiB)` (413 over cap); the
      route already whitelists fields and never passes `meta`. — PR #99
- [x] Function values are no longer revived via `eval`; the application CSP
      omits `unsafe-eval` and the app still hydrates. Repo-controlled generated
      design prototypes keep a path-scoped compatibility exception. — PR #99
- [x] The `Date.parse` reviver no longer coerces plain strings (verified by a
      round-trip test: seed `"Post 1"`, save, reload, assert it is still a string). — PR #99
- [x] Regression coverage added — `remix/app/Providers/thingtimeSerialization.test.ts`
      (`npm run test:persist`). The codec is client-side, so coverage lives beside
      it rather than in the fetch-based `apiTests.ts`. — PR #99

**§B's IP-based register rate limit shipped in PR #167. PR #99 keeps that
single implementation and supplies the remaining register body cap, plus §C
(persisted-state `eval` + CSP) and §D (Date.parse corruption).** The persist
codec is the current `remix/app/Providers/thingtimeSerialization.ts` path
(pure/React-free). The older parallel `thingtimePersistCodec.ts` from the
original PR diff was intentionally dropped after `develop` superseded that
architecture; its invariants and tests were folded into the active serializer.
§A's A1 (raw-results) and A2 (populate) closed separately on `develop`
(2026-07-21); A3 (service-account) is throttled but its token lifetime is still
unbounded — see the §A notes above.
