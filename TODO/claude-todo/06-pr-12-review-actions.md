# PR 12 review actions

Status notes for `Auth: register + email verification + JWT/session + login (foundation)`.

## 1. JWT secret fallback

- Status: needs decision / follow-up.
- Review note: `remix/app/api/utils/auth/jwt.ts` uses a known fallback secret when `JWT_SECRET` is missing.
- Why this matters: JWTs are signed with a secret. If production accidentally runs without `JWT_SECRET`, every deployment would use the same public fallback string, so anyone who knows the code could forge valid-looking tokens. The Mongo session lookup still helps, but the app should not silently accept a known signing key in real environments.
- Suggested action: keep the dev fallback for local work only, and throw when `NODE_ENV === "production"` and `JWT_SECRET` is missing.

## 2. Production source maps

- Status: accepted for now.
- Decision: production builds may ship source maps because we want debuggable production builds.
- Action: no code change for this item right now.

## 3. Atomic email verification token consumption

- Status: done.
- Review note: token consumption used to read the token, check it, then update it. Two requests could race and both pass the checks.
- Action taken: `consumeEmailVerification` now uses one atomic `findOneAndUpdate` that only matches unconsumed, unexpired tokens. If a second request races, it sees the token as already used.

## 4. Unused imports

- Status: done.
- Decision: unused imports / variables are allowed for now.
- Action taken: Remix ESLint config disables unused import and unused variable rules.
