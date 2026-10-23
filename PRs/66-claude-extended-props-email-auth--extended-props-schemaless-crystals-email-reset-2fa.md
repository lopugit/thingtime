# PR #66 — Extended props, schema-less crystals + stranded email/password-reset/2FA port

- **Branch:** `claude/extended-props-email-auth` → `claude/search-page-mongodb-query-154eb4` (stacked on PR #63)
- **URL:** https://github.com/lopugit/thingtime/pull/66
- **Context:** PR #52 (extended property, password reset, email 2FA — built on PR #35's SES email layer) merged into `codex/crud-implementation-plan`, but PRs #47 and #35 were closed, so none of it reached main. Main later gained the unified thing/crystal architecture (PR #59) without that work. This PR re-implements it all natively on the unified model.

## What it adds

1. **`extended`** — schema-free top-level property on every `things` doc: any JSON ≤512KB, stored/returned verbatim inside the platform envelope, never validated, structured-searchable, or interpreted. Replace-on-write (`null` clears, omission leaves untouched). Keys-only safety walk: no null-byte keys, depth ≤64, and the reserved `tt:textLanguage` key rejected (the wildcard text index's `language_override` — Mongo honours it inside embedded docs, so a verbatim key would break inserts or hijack the index language). Route body caps 256KB→768KB.
2. **Schema-less crystals** — `thingtime` optional on create; a bare `{ crystal }` defaults to `["data"]` (bounded free-form crystal, /search-able). Input convenience only — stored docs always carry a resolved non-empty `thingtime`.
3. **Owned email layer** (PR #35 port) — `api/utils/email/`: outbox `email_messages` row per send (schemaVersion-stamped), suppression/unsubscribe checks, SES (`@aws-sdk/client-sesv2`) or console delivery, `GET /api/v1/email/config`, dev-only `POST /api/v1/email/test-otp`, `/verify-email` landing page.
4. **Password reset** — probe-proof request route (+ dev `resetLink`), atomic single-use 1h tokens (`passwordResets`, TTL), confirm rotates bcrypt hash + revokes every live session, per-IP `auth.passwordReset` rate limit (new over #52), `/reset-password` page (also new — #52 emailed links to a nonexistent page), forgot-password link on login.
5. **Email 2FA** — opt-in toggle (`users.meta.twoFactorEmailEnabled`, verified email required), two-step `POST /api/v1/login { challenge, code }`, `authOtps` docs store `sha256(challenge:code)` only (10-min TTL, atomic 5-attempt cap, `timingSafeEqual`, single-use burn), integrates with the account-switcher roster on completion, per-IP `auth.login` rate limit (new), login-form OTP step + Settings → Security toggle (optimistic local-cache paint).
6. **Glue** — registry collection schemas + versions for `passwordResets`/`authOtps`/`email_messages`, ensureIndexes TTL indexes, apiDocs entries (auto docs smoke tests), `/tests` email group + SES sandbox throttle + extended/reset/2FA tests, README/FUNDAMENTALS/CHANGELOG.

## Verification

20-check live curl suite (all passing) + in-browser add-account OTP login, Settings 2FA toggle, `/reset-password` both modes. Session revocation, token/challenge single-use, and replay rejection all exercised against the real dev stack.
