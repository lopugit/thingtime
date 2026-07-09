# 11 — Account switcher: multi-account sign-in 🟢

**Status:** Built, live-tested locally (register → add account → switch →
remove → logout fall-through verified in a browser).

## Goal
Let one browser be signed in to several Thingtime accounts at once, with a
switcher UI to change the active account, sign individual accounts out, **add
an account** by logging in with its credentials, or **register a brand-new
account** — all without signing anything else out.

## ✅ Decisions (locked)
- **The roster is the httpOnly `tt_accounts` cookie** — a JSON array holding
  one signed JWT per signed-in account, newest last, capped at 5
  (`MAX_ACCOUNTS`, cookie-size headroom). `tt_auth` stays the single ACTIVE
  credential and its token always also appears in the roster, so everything
  that authenticates requests (`getCurrentUser`, Bearer clients, every
  existing route) is untouched.
- **One token→user validation path.** `resolveTokenUser`
  (`getCurrentUser.ts`) verifies signature + live `jti` session + user doc;
  both `getCurrentUser` and the roster resolver use it, so a token is valid
  everywhere or nowhere. Dead roster entries are pruned (and the cookie
  rewritten) whenever the roster is read.
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
- API utils: `accountsCookie.ts` (roster cookie), `accounts.ts`
  (`resolveRoster` / `mergeAccountToken` / `removeAccounts` /
  `serializeRosterCookieIfChanged`), `resolveTokenUser` extracted in
  `getCurrentUser.ts`.
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
