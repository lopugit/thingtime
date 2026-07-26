# 11 — Account switcher: multi-account sign-in 🟢

**Status:** Built, live-tested locally (register → add account → switch →
remove → logout fall-through verified in a browser).

## Goal
Let one browser be signed in to several Thingtime accounts at once, with a
switcher UI to change the active account, sign individual accounts out, **add
an account** by logging in with its credentials, or **register a brand-new
account** — all without signing anything else out.

## ✅ Decisions (locked)
- **The roster is a Mongo doc** (`rosters` collection, one per browser) whose
  entries reference sessions by `{userId, jti}` — the httpOnly `tt_accounts`
  cookie holds only the opaque roster id. **Unlimited accounts** (owner call,
  2026-07-10, over the earlier 5-JWT cookie roster which was bounded by the
  browser's ~4KB cookie cap), constant-size cookie, and no raw JWTs stored
  anywhere — only the server (holding the signing key) can mint a token for a
  session, so switching mints a fresh JWT from the chosen live session.
  `tt_auth` stays the single ACTIVE credential and its session always also
  appears in the roster, so everything that authenticates requests
  (`getCurrentUser`, Bearer clients, every existing route) is untouched.
  Roster docs carry a rolling 30-day `expiresAt` reaped by a TTL index.
- **One session→user validation path.** `resolveSessionUser`
  (`getCurrentUser.ts`) checks live `jti` session + user-binding + user doc;
  `resolveTokenUser` (JWT verify → same path) and the roster resolver both use
  it, so a session is valid everywhere or nowhere. Dead roster entries are
  pruned (doc + cookie updated) whenever the roster is read; legacy JWT-array
  `tt_accounts` cookies from the pre-Mongo roster fold into a roster doc on
  first read.
- **Ownership gate (security-critical).** The roster id in the cookie is only
  a pointer, so a request may use an inbound roster **only when its active
  `tt_auth` session is already one of that roster's entries**; an id the
  browser doesn't belong to is ignored and a fresh roster is minted for the
  active session. Without this, an attacker who planted their own roster id in
  a victim's browser (cookie fixation) would have the victim's session folded
  into the attacker's roster on the next switcher read, then mint a takeover
  token — a hole the pre-Mongo cookie roster didn't have (it stored the tokens
  themselves, so a victim's session only ever landed in the victim's own
  httpOnly cookie). Legit growth only happens from a browser that already owns
  the roster (add-account while signed in) or the browser's first sign-in.
  Residual: planting `tt_auth` *itself* is the pre-existing single-account
  login-fixation exposure (mitigated by `tt_auth` being httpOnly + Secure +
  SameSite=Lax) and is out of scope for this feature.
- **Optimistic-concurrency writes.** Roster docs carry a `version` rotated on
  every write; mutations (`mergeAccountSession`, `removeAccounts`) read-modify-
  write under a version guard and retry on conflict, so two racing logins in
  one browser can't lose-update each other — which would otherwise orphan a
  live session that `log out all` could never revoke.
- **Login/register ARE "add account".** `POST /api/v1/login` and
  `POST /api/v1/auth/register` merge their fresh JWT into the roster (same-user
  entries are replaced and their old sessions revoked; overflow drops + revokes
  the oldest) — no separate add endpoint, one code path (FUNDAMENTALS §2).
- **Logout = sign out the active account.** It's revoked + dropped from the
  roster; the next roster account becomes active (returned as `user`). The
  last logout — or `{ all: true }` — clears both cookies (pre-switcher
  behavior). Client handlers only navigate to `/login` when `user` is null.
- **Raw JWTs never reach the client** (FUNDAMENTALS §6): the accounts route
  returns `{ user: PublicUser, active }` only; switching references accounts
  by `userId`, authorized purely by possession of the httpOnly roster cookie.

## Built this round
- API utils: `accountsCookie.ts` (roster-id cookie + legacy parse),
  `accounts.ts` (`resolveRoster` with the ownership gate / `mergeAccountSession`
  / `removeAccounts` / `persistRoster` + `mutateRoster` optimistic-concurrency
  retry / `mintAccountToken`), `resolveSessionUser` + `resolveTokenUser`
  extracted in `getCurrentUser.ts`, `getRostersCollection` + unique/TTL indexes
  in `mongodb/collections.ts`.
- Routes: `GET /api/v1/auth/accounts`, `POST /api/v1/auth/accounts/switch`,
  `POST /api/v1/auth/accounts/remove`; roster-aware `login`, `register`,
  `logout` (+ `all: true`). Registered in `server/routes/api/[...].ts` and
  documented in `docs/apiDocs.ts` (doc entries also feed the Nitro route
  table).
- Client: `useApi().v1.auth.accounts.{list,switch,remove}`,
  `components/Account/useAccountSwitcher.tsx` (roster state + toasts) and
  `components/Account/AccountSwitcher.tsx` (rows + switch + per-account
  sign-out + inline embedded Login/Register forms). Hosted in the user
  settings modal and `/settings`; `Login`/`Register` gained an `embedded`
  mode (`onSuccess`/`onSwitchMode`) and stay zero-prop on their pages.
- Logout handlers (settings modal, `/settings`, `/profile`) now fall through
  to the next account; the feed refetches when the viewer id changes.
- Tests: safe `auth` group entries for roster listing (no raw JWTs), switch
  validation/404, remove validation.

## Still TODO
- "Continue as" roster list on the `/login` page itself (the endpoint already
  works signed-out; UI just isn't rendered there yet).
- Rate limiting on switch/remove shares the same gap as login/register
  (see 09-security-hardening.md).
