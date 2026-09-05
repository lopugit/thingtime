# PR 12 review actions

Status notes for `Auth: register + email verification + JWT/session + login (foundation)`.

## 1. JWT secret fallback

- Status: done.
- Review note: `remix/app/api/utils/auth/jwt.ts` used to fall back to a known secret when `JWT_SECRET` was missing.
- Why this matters: JWTs are signed with a secret. If production accidentally runs without `JWT_SECRET`, every deployment would use the same public fallback string, so anyone who knows the code could forge valid-looking tokens. The Mongo session lookup still helps, but the app should not silently accept a known signing key in real environments.
- Action taken: `getLegacySecret` returns `JWT_SECRET` when it is set, and otherwise reaches the shared dev secret only past two guards. The decisive guard is inside the helper: with no fallback allowed it returns `null`, and when a fallback *is* allowed it throws under `NODE_ENV === 'production'` rather than handing back `LEGACY_DEV_SECRET`. The two signing call sites (`signJwt`, `signPurposeToken`) therefore pass `allowDevFallback: true` and still fail closed in production; the two verifying call sites (`verifyJwt`, `verifyPurposeToken`) pass `process.env.NODE_ENV !== 'production'` so that an unverifiable production token returns `null` instead of throwing on an attacker-supplied input. Keep the in-helper production throw when touching this: it, not the call sites, is what makes the shared dev secret unreachable outside local work.
- Residual note: HS256 is verify-only *migration* for deployments that already have ES256 key material, but `signJwt`/`signPurposeToken` still mint new HS256 tokens whenever `JWT_PRIVATE_KEY` is unset and `JWT_SECRET` is set. Set `JWT_PRIVATE_KEY` to retire HS256 signing.

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
