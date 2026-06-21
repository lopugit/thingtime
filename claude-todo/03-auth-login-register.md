# 03 — Auth: Login / Register / Sessions / JWT 🟡

**Status:** Partial — pieces exist but are inconsistent and not wired end-to-end.

## Goal
A working auth flow through the Thingtime API: register a user (hashed
password), log in (validate + create a session), persist the session (cookie),
and expose the current user to the app. JWT optional/secondary.

## What exists
- Route: `remix/app/routes/api/v1/mongodb/login/_login.tsx`... actually
  `remix/app/routes/api/v1/login/_login.tsx` — action that checks existence,
  validates password, creates a session, then returns "Login successful".
- UI: `remix/app/components/Login/Login.tsx`, route `remix/app/routes/login.tsx`,
  and `useApi().v1.login()` (`remix/app/hooks/useApi.tsx`) posting to
  `/api/v1/login`.
- Utils (`remix/app/api/utils/`):
  - `userCheckExists({username})` → `auth.users.findOne({username})`
  - `userValidatePassword({username,password})` → `auth.users` + `bcrypt.compare`
  - `userCreateSession(user)` → inserts a session doc into `thingtime.things`
  - `getUser(username)` → `thingtime.things.findOne({username})`
  - `userGenerateJWT(...)` → **stub, does nothing**
- Cookie: `remix/app/cookies.server.ts` (`Session = createCookie('session')`)
  and `remix/app/sessions.ts`.

## Problems to fix
1. **Collection mismatch** (see README): `userCheckExists`/`userValidatePassword`
   use `auth.users`; `getUser`/`userCreateSession` use `thingtime.things`. The
   login route mixes both → `getUser` won't find a user that
   `userValidatePassword` validated.
2. **Login route arg bug:** calls `userCheckExists(username)` (a string) but the
   util destructures `{ username }`. Also the existence/validation calls are
   `async` but **not awaited** (`userExists` is a Promise → always truthy).
3. **No session cookie set.** `userCreateSession` writes a DB row but the action
   never serializes a `Set-Cookie` (the `Session` cookie is unused). Login
   "succeeds" without actually logging anyone in.
4. **Session token is weak** (`Math.random().toString(36).substring(7)`),
   `expires: 0`, no rotation.
5. **No register endpoint** — there's no way to create a user (only seeding).
6. **JWT is a stub** — decide if we want JWT at all, or cookie-session only.

## Plan
- [ ] Pick the canonical user/session model (blocks #02 too).
- [ ] Add `POST /api/v1/auth/register` — hash password (bcrypt), insert user,
      reject duplicates.
- [ ] Fix login: await + correct args; on success create session and set the
      `Session` cookie (signed; store sessionId/userId).
- [ ] Add `getCurrentUser({request})` helper that reads the cookie → session →
      user, for use in loaders/actions.
- [ ] Add `POST /api/v1/auth/logout` (clear cookie + delete/expire session).
- [ ] Decide JWT: either implement `userGenerateJWT` properly (signed, exp) for
      API clients, or drop it for now.

## Decisions (locked — see FUNDAMENTALS.md §5)
- **One `thingtime` db**: `users` + `sessions` collections.
- **Auth = httpOnly cookie + revocable JWT + Mongo session:**
  1. On register/login, create a `sessions` doc (gives a `jti` to revoke).
  2. `userGenerateJWT` mints a **signed JWT** (`sub`=userId, `jti`, `exp`).
  3. Browser stores the JWT in the signed **httpOnly `Session` cookie**;
     API clients send it as `Authorization: Bearer <jwt>`.
  4. Each authed request: verify signature + `exp`, then confirm `jti` is live
     in `sessions`. Logout/revoke flips the Mongo session → JWT dies immediately.
- Needs a JWT lib + a `JWT_SECRET` env var (HS256 to start).

## Still open (defaults fine for now)
- Password rules / min length, rate limiting → later.
- JWT lib choice: `jsonwebtoken` vs `jose` (lean `jose`, ESM-friendly).

## Acceptance criteria
- Register → login → an authed request sees `getCurrentUser()` return the user.
- Wrong password / unknown user → 401.
- Logout clears the session and subsequent authed requests are rejected.
