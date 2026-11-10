# Passkeys (WebAuthn) + cross-deployment auto-login

Branch: `claude/auto-login-passkey-support-593cd3` → `develop`
(PR number: fill in on open — rename this file to match the repo convention if desired.)

Two features, one auth-family PR:

1. **Passkey support** — registration, usernameless login, and a full
   management surface (nicknames, descriptions, provider names, dates, linked
   apps, revocation, deletion).
2. **Auto-login popup** — a signed-out visit on any `*.thingtime.com`
   deployment suggests accounts this browser has LIVE sessions for on other
   deployments ("Continue as…"), with password or passkey re-authentication
   always required.

## Architecture

### Passkeys are protected things

- `passkey` things (`schemas/registry.ts`): ownerId = the account. Credential
  material (`credentialId`, COSE public key) lives in the root `secure`
  BinData blob (never crystal, invisible to the `$**` text index); the
  signature counter is the root number `secureCounter` (atomic per-login
  `$set`, numbers aren't text-indexed); owner-facing metadata (nickname,
  description, providerName from the AAGUID, deviceType/backedUp, transports,
  lastUsedAt/lastUsedOrigin, revokedAt) is crystal. Credential-id uniqueness
  and the login-time lookup ride `uniqueKeys` `'passkeyCredential:<id>'`
  (BinData, like user email keys).
- `passkey-app-link` things — one per (passkey, app/origin), upserted per
  login via the new `crystal.linkKey` partial unique index (bounded by
  distinct apps, FUNDAMENTALS §3 relational rule). The deployment origin
  always links; an SSO `clientId` (validated against registered apps) links
  additionally.
- Both kinds are in `PROTECTED_THINGTIME` (a forged passkey doc would BE a
  working credential) and are written ONLY by `api/utils/auth/passkeys.ts`
  through `getHomeThingsCollection` — a `tt_mongo` data-plane override can
  never capture or plant credentials.

### Ceremonies

- Challenges are stateless: a purpose-fenced JWT (`jwt.ts` `signPurposeToken`
  / `verifyPurposeToken`) in a 10-minute httpOnly cookie
  (`tt_webauthn_reg` / `tt_webauthn_auth`), cleared on successful verify so
  assertions can't be replayed. The `purpose` claim fences these off from
  session JWTs in both directions.
- Registration requires the current password (`confirmCurrentPassword`) and
  requests **discoverable credentials** (`residentKey: 'required'`) — this is
  what makes usernameless login and conditional-UI autofill work everywhere.
  `excludeCredentials` carries every current credential so an authenticator
  can't double-register.
- Login is discoverable-only (empty `allowCredentials` — no username, no
  enumeration surface), requires user verification, checks revocation BEFORE
  any cryptography, and finishes exactly like password login: auth cookie +
  `mergeAccountSession` roster merge + hint pointer. Sessions carry
  `meta: { method: 'passkey', passkeyId }`, purpose stays `browser`.
  Passkeys bypass email-OTP 2FA by design (possession + UV is the second
  factor — industry standard).
- rpID: `thingtime.com` for every `*.thingtime.com` host (one passkey works on
  production, dev, and previews), exact hostname otherwise, derived from the
  browser-facing origin via `resolvePublicOrigin` (x-forwarded aware — see
  "dev-proxy bug" below).

### Auto-login hints

- Every successful sign-in (password login, register, passkey login, assume,
  temporary — they all ride `mergeAccountSession`) appends a
  `{ rosterId, origin, seenAt }` pointer to the `tt_hints` cookie, scoped
  `Domain=.thingtime.com` on thingtime hosts (host-only elsewhere;
  `api/cookies.ts` gained the `domain` option). Pointers only — never
  identities, jtis, or tokens.
- `GET /api/v1/auth/account-hints` resolves pointers LIVE through
  `getLiveRosterEntries` + `resolveSessionUser` (the exact chokepoints the
  account switcher uses): a suggestion exists exactly while its session on the
  other deployment is live; dead pointers are pruned and the cookie rewritten.
  Responses are a slim projection (id/username/displayName/avatarUrl — no
  email), same-origin only (no CORS), rate-limited per IP.
- The roster ownership gate (accounts.ts anti-fixation) is untouched: hints
  never mint tokens or fold foreign sessions into the local roster; a planted
  pointer could only ADVERTISE the attacker's own accounts, which still demand
  the attacker's credentials to use.
- UI: `AutoLoginPopup` (root-mounted, corner card, snoozes 24h, never on auth
  pages, filters `alreadyHere`), a suggestion strip inside the Login form, and
  `/login?u=<username>` prefill. All localCache-seeded (optimistic rendering).

## Endpoints (all three-place registered + documented)

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/v1/auth/passkeys` | session | list + linked apps |
| `POST /api/v1/auth/passkeys/register-options` | session + password | creation options + challenge cookie |
| `POST /api/v1/auth/passkeys/register` | session | verify attestation, store |
| `POST /api/v1/auth/passkeys/login-options` | none | request options + challenge cookie |
| `POST /api/v1/auth/passkeys/login` | none | verify assertion, sign in |
| `POST /api/v1/auth/passkeys/update` | session | nickname/description |
| `POST /api/v1/auth/passkeys/revoke` | session + password | immediate permanent block |
| `POST /api/v1/auth/passkeys/delete` | session + password | remove a REVOKED passkey |
| `GET /api/v1/auth/account-hints` | none (cookie) | live cross-deployment suggestions |

Rate limits: `auth.passkeyOptions` 60/min, `auth.passkeyLogin` 30/min,
`auth.passkeyManage` 30/min (user-keyed), `auth.accountHints` 60/min.

## Verification

- **`remix/scripts/verify-passkeys.mjs` — 44/44.** A software WebAuthn
  authenticator in pure Node (P-256 keypair, minimal CBOR encoder, `none`
  attestation, DER ES256 assertions) drives the real API end to end:
  register → attestation verify → duplicate 409 → challenge replay refusals →
  usernameless login (fresh jar) → lastUsed + origin linked-app → revocation
  blocks login → revoke-before-delete → hint resolution from a pointer-only
  jar (`alreadyHere:false`, no email) → logout-elsewhere kills the hint while
  other sessions survive → docs endpoints.
- Unit suites: `test:schemas` 55/55 (projection pin updated for the two new
  kinds), `test:collections`, auth unit tests.
- Browser (worktree stack, desktop + mobile): popup with real resolved data,
  Continue → prefilled login, hints strip, passkey button, real password
  login, Settings manager list/rename/revoke (password-confirmed) with
  REVOKED badge → Delete swap. Screenshots in the PR description.

## Bugs found during verification (both fixed in this PR)

1. **Request loop in the hints/passkeys hooks.** `useApi()` returns a fresh
   identity per render; effects depending on it re-ran per render and hammered
   `account-hints` until the rate limiter (working as intended) 429'd. Fixed
   with the `apiRef` idiom from `useAccountSwitcher` in `usePasskeys.tsx` and
   `PasskeysManager`.
2. **Dev-proxy origin derivation.** Vite's `/api` proxy (`changeOrigin: true`)
   rewrites Host to the nitro port, so `new URL(request.url)` derived
   `rpID: '127.0.0.1'` — a real browser ceremony through the dev proxy could
   never verify (clientDataJSON binds the browser origin), and hint pointers
   were labeled with the internal origin. Fixed by `resolvePublicOrigin`
   (honors `x-forwarded-host`/`-proto`, same trust stance as
   `isSameOriginPost`); the proxy already forwards the original host (PR #84).

## Notes / follow-ups

- The `passkey` kind supports platform + cross-platform authenticators;
  attestation is `none` (privacy-preserving), provider names come from the
  AAGUID community list (`passkeyAaguids.ts`).
- Accounts without a password (temporary users) can't add passkeys
  (`confirmCurrentPassword` → `unavailable`); temporary users are also
  filtered out of hints (per-origin, passwordless — a cross-deployment
  suggestion could never complete).
- iOS wrapper: WKWebView passkey ceremonies need the associated-domains
  (`webcredentials:thingtime.com`) entitlement to use the shared rpID —
  untouched here, worth a follow-up when the native shell wants passkeys.
- **Merge coordination with the crystal-uniqueness stack (#320 → #325/#326,
  not in this branch's base):** that stack migrates relationship uniqueness
  off `crystal.*Key` partial indexes onto root `uniqueKeys`
  (`<field>:<key>` BinData) and then un-reserves the crystal root keys. This
  PR's `crystal.linkKey` partial unique index follows the current (pre-stack)
  pattern; when the stack lands, migrate `passkey-app-link` dedup onto root
  `uniqueKeys` (`linkKey:<passkeyId>:<appKey>`) like the other relationship
  keys and drop the `things_passkey_link_key_unique` index. The passkey
  credential id already rides root `uniqueKeys`, so it needs nothing.
