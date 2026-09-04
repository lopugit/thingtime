# PR #180 — Account birthday: private user field + exact profile.birthday scope

- **Branch:** `claude/user-birthday-scope`
- **URL:** https://github.com/lopugit/thingtime/pull/180
- **Context:** StarsAlign wants `user.birthday` from Thingtime as the default
  birthday source (falling back to its own app-data copy). Thingtime had no
  account birthday at all, and the scope system's ancestor-coverage rule meant
  a naive `profile.birthday` leaf would have silently flowed to every app
  already holding plain `profile` — including all legacy tokens.

## What it adds

1. **Birthday field** (YYYY-MM-DD) on user accounts, edited in
   Settings → Profile. Stored as secure-blob `meta.birthday` on the user thing
   (CAS via `mutateUserThingSecure`, legacy `users` fallback) — never in the
   public `crystal`, never on `PublicProfile`, people search, or the public
   profile GET. No collection version bump (optional field; old docs read as
   `null`).
2. **`sanitizeBirthday`** (`remix/app/api/utils/auth/birthday.ts`) — pure,
   dependency-free validator: real calendar dates only (no 2001-02-31
   rollover), bounds 1900-01-01 → today, `null`/empty clears, tri-state
   contract mirroring `sanitizeProfileImageUrl`.
3. **`profile.birthday` scope** — `kind: 'field'`, **`exact: true`**: an
   ancestor `profile` grant (or legacy token) never covers it; the user must
   approve the literal path. Consent screen renders its own 🎂 row with zero
   UI logic changes (the exact-aware machinery from `app-data.shared` handles
   it via the fetched catalog).
4. **Serving** — `/api/v1/oauth/userinfo` and the authorize handoff user
   object return `birthday` only under the literal grant.
5. **Feature detection** — `/api/v1/oauth/scopes` now carries CORS headers so
   embedding platforms can check the catalog cross-origin BEFORE opening the
   popup (requesting an unknown scope 400s the authorize flow). On older
   deployments the cross-origin fetch fails, which platforms read as "not
   supported yet" — deploy-order safe in both directions.
6. **Docs** — `apiDocs.ts` (oauth-userinfo, oauth-scopes, users-profile),
   `/docs/embed` scope table, SDK JSDoc (`login` options + `userinfo` shape).

## Verification

- `node --test`: new `birthday.test.ts` (6 tests) + `scopes.test.ts` (5 tests,
  incl. profile-doesn't-cover-birthday + legacy-token exclusion) pass; existing
  node suites pass (43 tests: appOriginsCore, collectionNames, quotaCore,
  schemas).
- Targeted ESLint on every changed file: 0 errors (one pre-existing type-import
  warning in SettingsPage untouched).
- `tsc --noEmit`: same 149 pre-existing errors as clean `origin/main` — zero
  introduced.
- In-browser API tests extended: `profile-get-never-leaks-birthday`,
  `profile-update-birthday-validates`.
- TESTING.md: new "Account birthday & profile.birthday scope" checklist —
  run it live (esp. the consent-screen rows) before/after deploying.
- Consumer side: StarsAlign PR (lopugit/starsalign) reads `user.birthday`
  via userinfo with app-data fallback and feature-detects the scope from the
  CORS-open catalog.
