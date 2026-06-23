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

- `/api/v1/lopu/musing` now checks a Mongo-backed rolling quota before making
  weather or AI provider calls when Claude/OpenAI keys are configured.
- The quota allows 10 AI-backed musings per detected IP address per rolling
  hour. Over-limit requests, and rate-limit-storage failures, stream the preset
  fallback musing library.

### Follow-Up

- `TODO.md` tracks replacing request-origin verification links with a canonical
  `APP_URL` or explicit host allowlist before real email delivery.

### Verification

- `git diff --check`
- `corepack pnpm --dir remix exec eslint app/api/utils/auth/devVerification.ts app/api/utils/auth/jwt.ts app/api/utils/auth/getCurrentUser.ts app/routes/api/v1/auth/register/_register.tsx app/routes/api/v1/auth/resend-verification/_resend-verification.tsx app/api/utils/mongodb/collections.ts app/api/utils/lopu/rateLimit.ts app/api/utils/lopu/musing.ts app/routes/api/v1/lopu/musing/_musing.tsx`
- `corepack pnpm --dir remix build`
