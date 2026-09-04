# PR 12 review actions

Status notes for `Auth: register + email verification + JWT/session + login (foundation)`.

## 1. JWT secret fallback

- Status: done.
- Review note: `remix/app/api/utils/auth/jwt.ts` used to fall back to a known secret when `JWT_SECRET` was missing.
- Why this matters: JWTs are signed with a secret. If production accidentally runs without `JWT_SECRET`, every deployment would use the same public fallback string, so anyone who knows the code could forge valid-looking tokens. The Mongo session lookup still helps, but the app should not silently accept a known signing key in real environments.
- Action taken: `getLegacySecret` now takes the dev fallback only when its caller passes `allowDevFallback`, and every call site passes `process.env.NODE_ENV !== 'production'`. With no fallback allowed it returns `null`, and it additionally throws in production, so the shared dev secret is unreachable outside local work. HS256 itself is now only a migration path for cookies minted before public-key verification.

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
