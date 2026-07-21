# 09 — Security hardening (unauth endpoints, auth rate limiting, persisted-state eval)

**Status:** 🔴 Not started · raised 2026-07-08 by a multi-agent review, each
finding adversarially verified against the source.

This groups the security findings from the 2026-07-08 review. They share a theme
the owner already cares about (DECISIONS.md #5 "security-conscious by reflex":
caught a leaking connection string, wants secrets stripped and tokens revocable).
Everything below was confirmed by reading the cited code — do not trust the
summary over the source, but the line refs were accurate at review time.

Follow `FUNDAMENTALS.md`: all data access stays behind the API + utils layer, and
reuse the **existing** Mongo-backed rate-limit primitive rather than inventing a
second one (single source of truth).

---

## A. Unauthenticated admin / data endpoints (highest priority)

Three endpoints are registered in the **production** Nitro dispatcher
(`remix/server/routes/api/[...].ts` L32–33) with no `getCurrentUser` check, no
rate limit, and no `NODE_ENV` gate.

### A1. `POST /api/v1/mongodb/raw-results` — full data exfiltration
- File: `remix/app/routes/api/v1/mongodb/raw-results/_raw-results.tsx` L21–44.
- The action calls `getCollection()` → `db('thingtime').collection('things')` and
  runs `thingsCollection.find().toArray()` (≈L35), returning **every** `things`
  doc to any anonymous caller.
- This is the same collection `createPost` writes `friends` / `family` / `private`
  posts to (`remix/app/api/utils/things/things.ts` L182–234), so it bypasses the
  `canView` / `visibilityQueryFor` gating (`things.ts` L338–348). Every private
  post in the system is readable by anyone who POSTs here.

### A2. `POST /api/v1/mongodb/populate` — unauth seeding / DoS amplification
- File: `remix/app/routes/api/v1/mongodb/populate/_populate.tsx` L24 →
  `remix/app/scripts/mongodb/setup.ts`.
- Any anonymous caller triggers DB seeding: demo users created with **repo-known
  seed passwords**, plus dozens of Mongo round-trips and bcrypt hashes per request
  (amplification / DoS). Idempotency bounds row growth but not the per-request
  work. Docs say "dev only" but nothing enforces it.

### A3. `POST /api/v1/auth/service-account` — unauth minting of permanent 5 GB tokens
- File: `remix/app/routes/api/v1/auth/service-account/_service-account.tsx` L8 →
  `remix/app/api/utils/auth/serviceAccounts.ts` L48–109.
- `provisionServiceAccount` mints a **non-expiring** bearer token
  (`signJwt` with `expiresIn:null` omits the `exp` claim — `jwt.ts` L113;
  `createSession` with `expiresAt:null` never expires per `sessions.ts` L51) and
  grants `storageAllowanceBytes` = **5 GB**, with no caller identity check and no
  throttle. Anyone can mass-create accounts to exhaust rows/storage and keep
  permanent tokens.
- Partial existing mitigation: `getCurrentUser` (`getCurrentUser.ts` L35–41)
  disables an **unverified** service token after a 7-day grace — but that leaves a
  7-day live window, does not stop unauth creation, and does not bound tokens once
  the supplied email is verified.

**Fix for A1–A3:** require an authenticated admin / service-account / existing
session (or an explicit setup token), or dev-gate behind a non-production env
check and drop them from the prod dispatcher. Any that stay must apply visibility
filtering (A1) and the shared rate limiter (A2/A3). Consider bounding
service-account token lifetime regardless.

## B. Auth-endpoint rate limiting + input caps

- `POST /api/v1/login` (`_login.tsx` → `remix/app/api/utils/auth/loginUser.ts`):
  no attempt counter, lockout, or IP throttle; the dispatcher adds no middleware.
  Only friction is bcrypt cost 10 (skipped for unknown usernames). Credentials are
  brute-forceable at full speed.
- `POST /api/v1/auth/register` (`_register.tsx` L10–14): no rate limit, no body
  cap before `request.json()`, and `meta` is persisted verbatim as
  `Record<string, any>` (`registerUser.ts` L72, `meta: input.meta ?? {}`).
- `POST /api/v1/auth/resend-verification`: mints unlimited verification tokens per
  request (email cost currently masked only by the dev console stub in
  `remix/app/api/utils/auth/email.ts`).

**Fix:** reuse the existing per-IP fixed-window quota
(`consumeJoinQuota` in `remix/app/api/utils/waitlist/waitlist.ts` L23–41, or
`consumeLopuMusingQuota` in `remix/app/api/utils/lopu/rateLimit.ts`, both backed
by the `lopuMusingRateLimits` TTL collection) to return 429 after N failed
attempts per IP (and per username for login) per window. Cap register/login body
size (use `readJsonBody(request, 64*1024)` like the things/algorithms routes
already do). Whitelist known `meta` keys or enforce a serialized-size ceiling.

## C. Persisted-state `eval` → arbitrary code execution + no CSP

- File: `remix/app/Providers/ThingtimeProvider.tsx`.
- The `flatted` reviver runs `eval(value.code)` (L39) for any parsed value with
  `ttype:'function'`, plus a second scoped `eval` embedding `value.code` (L53)
  when a `ttScope` is present. The paired replacer serialises every function into
  `{ttype:'function', code, ttScope}` (L71–87). The provider persists the entire
  `thingtime` object to IndexedDB via
  `localforage.setItem('thingtime', stringify(state))` on **every** state change
  (L435–438) and revives it on every load (`getItem` L374 → `parse` L381 →
  reviver). It wraps the whole app in `root.tsx`.
- No Content-Security-Policy exists anywhere in the repo, so `unsafe-eval` is
  effectively allowed. Anything able to write same-origin storage (an XSS, a
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

- [ ] A1–A3 require auth (or are dev-gated + removed from the prod dispatcher);
      any that remain apply visibility filtering.
- [x] Login / register / resend-verification return 429 past a per-IP (and
      per-username, for login) threshold, reusing the existing quota util.
      (login + resend-verification + password-reset already enforced;
      **register** added on `claude/lockdown-unauth-endpoints-s7`, 2026-07-21 —
      new `auth.register` rule, 10 per 15 min per IP, checked before the body
      read; service-account throttle is the sibling s? branch.)
- [x] Register/login enforce a body-size cap; `meta` is whitelisted/bounded.
      (register now reads via `readJsonBody(request, 16*1024)` → 413 on
      oversize; `meta` was already stripped of privileged keys at the
      `createUserAccount` chokepoint and register never forwards caller `meta`.)
- [ ] Function values are no longer revived via `eval`; a CSP without
      `unsafe-eval` is in place and the app still hydrates.
- [ ] The `Date.parse` reviver no longer coerces plain strings (verified by a
      round-trip test: seed `"Post 1"`, save, reload, assert it is still a string).
- [ ] Regression coverage added to `remix/app/tests/api/apiTests.ts`.
