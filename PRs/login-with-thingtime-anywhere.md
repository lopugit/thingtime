# Login with Thingtime anywhere (federated hints + SSO handoff + FedCM)

Shipped INSIDE PR #323 (`claude/auto-login-passkey-support-593cd3`) — the
stacked PR #327 was collapsed into it at the owner's request; this note
documents the federation layers of that single PR.

Follow-up to #323's cross-deployment auto-login, extending it beyond the
`*.thingtime.com` cookie family. Owner's design constraint, honored end to
end: **quick-login is powered by the sessions in the user's browser, federated
per deployment — never a central session store.** thingtime.com acts only as a
broker whose data comes from the browser's own `tt_hints` cookie and its own
switcher roster; every deployment vouches exclusively for its own sessions.

## Layer 1 — Federated hint resolution (multi-database environments)

- `/api/v1/auth/account-hints` now returns `unresolved: [origin…]` — foreign
  pointers this deployment can't vouch for (branch-scoped databases).
- New `GET /api/v1/auth/account-hints/resolve`: CORS-credentialed for the
  Thingtime family (+ localhost dev) only; resolves ONLY pointers its own
  origin wrote (the shared `tt_hints` cookie arrives on same-site fetches);
  read-only — never prunes, never sets cookies.
- `useAccountHints` fans out (cap 4 origins), merges by user id, keeps the
  slim no-email projection. The browser assembles the full picture.

## Layer 2 — Cross-origin session handoff

For Thingtime deployments OUTSIDE the cookie family (immutable `*.vercel.app`
previews, future custom domains):

- `POST /api/v1/auth/sso-handoff` (session-authed): mints a **2-minute,
  aud-bound, single-use** code — a purpose-fenced JWT backed by a pre-minted
  browser session that self-expires if unclaimed (2 min → 30 d on claim).
- `POST /api/v1/auth/sso-session` (on the receiving deployment): verifies
  signature (shared JWT material), `aud === own public origin` (the owner's
  per-token origin-binding rule; origins stay default-open), claims atomically
  exactly once — **a replay revokes the session** (theft signal) — then runs
  the exact password-login tail (auth cookie, roster merge, hints pointer).
  A different-environment redemption (databases don't match) fails closed.
- UI: `/authorize?self=1&origin=…` popup — signed-out visitors get the
  embedded login WITH the hints strip; signed-in visitors get a
  "Continue to <host>?" confirm card → code → `postMessage
  {type:'thingtime:sso', code}` → opener redeems. On foreign origins the
  AutoLoginPopup swaps into a "Sign in with Thingtime 🌈" card driving FedCM
  first, this popup as fallback.

## Layer 3 — FedCM identity provider

- `/.well-known/web-identity` (nitro root route) → `/api/v1/fedcm/config` →
  accounts / client-metadata / assertion endpoints.
- The browser (never the page) fetches accounts with first-party cookies and
  draws its native "Continue as…" sheet; `Sec-Fetch-Dest: webidentity` is
  required so page JS can't read the endpoints. Accounts = this browser's own
  switcher roster (`resolveRoster`, anti-fixation gate intact) — only sessions
  the roster owns can be redeemed, so hint-only accounts deliberately don't
  appear (they surface via Layer 1 on first-party surfaces instead).
- Assertion: `client_id 'thingtime-self'` → handoff code (Layer 2);
  `ttapp_…` → the same app-scoped Bearer token the consent popup mints,
  baseline `profile` scope only (wider grants still require the consent
  popup). Roster membership re-checked server-side.
- Client: foreign-origin card feature-detects `IdentityCredential` and prefers
  the native sheet.

## Verification

- **`remix/scripts/verify-federated-login.mjs` — 31/31** against two stacks on
  **separate mongods** (the script header documents the recipe and its two
  load-bearing sharp edges: stack B must be a production build — nitro's
  dev-mode dotenv re-overrides `.env` keys on config reloads — and a second
  mongod, because the home database name is pinned to `thingtime` so URI
  db-paths are ignored; transactions also need a replica set).
  Proves: per-environment authority (A keeps + reports B's pointer, B vouches
  cross-origin, CORS family-allow/deny, read-only), handoff (session-required,
  malformed-origin 400, cross-environment 401 fail-closed, wrong-aud 403,
  redeem → cookies/roster/hints → working session, replay 401 + revokes),
  FedCM (well-known + absolute config, Sec-Fetch-Dest enforcement, signed-out
  401, roster listing, assertion → token → session full loop, non-roster 401),
  docs endpoints.
- `verify-passkeys.mjs` still 44/44 on stack A.
- Browser-verified: `/authorize?self=1` signed-out (header + embedded login
  with hints strip) and signed-in ("Continue to <host>?" confirm card).

## Notes

- FedCM ships in Chromium (Firefox recent, Safari pending) — the popup path
  is the everywhere-fallback, both wired into the same card.
- The two-stack recipe is the first live proof of Thingtime's multi-environment
  posture: same code, different databases, honest boundaries.
