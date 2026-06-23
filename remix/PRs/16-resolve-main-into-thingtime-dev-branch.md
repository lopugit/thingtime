# PR #16 - Resolve Main Into Thingtime Dev Branch

## Security Follow-Up - 2026-06-23

### Fixed

- JWT signing now fails closed in production when `JWT_SECRET` is missing
  instead of using the local development fallback secret.
- Current-user resolution now requires the live Mongo session `userId` to match
  the JWT `sub`, so a valid `jti` cannot be paired with a different user id.
- Dev email-verification links are returned only in local development and Vercel
  preview environments.

### Changed

- JWT signing now prefers ES256 when `JWT_PRIVATE_KEY` is configured, publishes
  the public verification key at `/api/v1/auth/jwks`, and keeps `JWT_SECRET` as
  a legacy HS256 migration fallback for existing cookies.
- Added `/crypto` and `/api/v1/crypto` tooling for generating key pairs,
  checking private/public key matches, verifying JWTs, and verifying signed
  messages across PEM, escaped PEM, base64 PEM, base64url PEM, and JWK JSON
  key formats.
- Remix local dev/build scripts now run an `ensure-bcrypt` check that repairs a
  missing `bcrypt_lib.node` native binding before Vite starts.
- `AGENTS.md` and `CLAUDE.md` now both instruct future agents to read both repo
  instruction files and avoid duplicating long shared runbook rules.
- `/api/v1/lopu/musing` now checks a Mongo-backed rolling quota before making
  weather or AI provider calls when Claude/OpenAI keys are configured.
- The quota allows 10 AI-backed musings per detected IP address per rolling
  hour. Over-limit requests, and rate-limit-storage failures, stream the preset
  fallback musing library.

### Follow-Up

- `TODO.md` tracks replacing request-origin verification links with a canonical
  `APP_URL` or explicit host allowlist before real email delivery.
- `TODO.md` tracks removing the legacy HS256 fallback after pre-ES256 cookies
  expire, and adding revocation-aware external token introspection if needed.

### Verification

- `git diff --check`
- `corepack pnpm --dir remix run ensure-bcrypt`
- `corepack pnpm --dir remix exec eslint app/api/utils/auth/devVerification.ts app/api/utils/auth/jwt.ts app/api/utils/auth/getCurrentUser.ts app/routes/api/v1/auth/jwks/_jwks.tsx app/api/utils/crypto/cryptoTools.server.ts app/routes/api/v1/crypto/_crypto.tsx app/routes/crypto.tsx app/routes/api/v1/auth/register/_register.tsx app/routes/api/v1/auth/resend-verification/_resend-verification.tsx app/api/utils/mongodb/collections.ts app/api/utils/lopu/rateLimit.ts app/api/utils/lopu/musing.ts app/routes/api/v1/lopu/musing/_musing.tsx`
- `corepack pnpm --dir remix build`
- PM2-managed local smoke on `tt-remix-9999` at `http://127.0.0.1:9999/crypto`
- `/api/v1/crypto` smoke generated ES256 keys, matched private/public keys,
  verified an ES256 JWT, and verified an ES256 signed message.
