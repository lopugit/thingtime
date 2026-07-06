# PR #17 - Document PR #16 Follow-Up Review Notes

## Summary

This PR records follow-up review notes from PR #16 in the repo's official
`remix/PRs/` format. It does not change app behavior.

These notes are intentionally non-blocking for merging PR #16. The P1/P2 labels
are preserved only as review ordering from the first pass; current owner priority
is low and the items can be handled after PR #16 lands.

## Follow-Up Notes From PR #16

### P1 - Preview verification links are too easy to mint

- `remix/app/routes/api/v1/auth/resend-verification/_resend-verification.tsx`
  accepts any submitted email address.
- In preview, `shouldShowDevVerificationLink()` allows the route to return the
  raw verification URL.
- Follow-up: require the current session user to match the requested email before
  returning a dev verification link, or stop returning raw tokens from public
  preview routes.

### P1 - Vercel deployment inventory is public in preview

- `remix/app/routes/api/v1/vercel/deployments/_deployments.tsx` checks only
  whether deployment status is enabled for dev/preview.
- When `VERCEL_API_TOKEN` is configured, the route can return branch names,
  commit SHAs, deployment IDs, deployment URLs, states, and project metadata.
- Follow-up: gate this endpoint behind admin/auth, or restrict public output to
  tokenless current-deployment data.

### P2 - Public auth endpoints have no abuse throttling

- `/api/v1/login`, `/api/v1/auth/register`, and
  `/api/v1/auth/resend-verification` are public and unthrottled.
- Follow-up: add rate limiting keyed by IP and account/email where appropriate,
  reusing the Mongo-backed quota pattern from Lopu musings if it fits.

### P2 - Email verification is still a console stub

- `remix/app/api/utils/auth/email.ts` logs verification links to the server
  console and returns `delivered: false`.
- In production, the API hides the dev verification link, so a user cannot
  complete verification unless a real email provider is wired.
- Follow-up: either wire a real transport before relying on email verification
  in production, or fail closed when production email delivery is unavailable.

### P2 - Crypto helper endpoint is unauthenticated

- `/api/v1/crypto` allows public key-pair generation and verification helper
  calls.
- Follow-up: restrict it to local/admin/dev use or add request throttling,
  especially for expensive key generation paths such as RSA.

### P2 - PR #16 added TypeScript errors

- Full `tsc --noEmit` remains noisy from pre-existing repo issues.
- The PR also adds changed-file type errors in auth/JWT/Vercel paths.
- Follow-up: clean up the new type errors even if full-project typecheck remains
  non-gating for now.

## Review Evidence

- `git diff --check` passed.
- `corepack pnpm --dir remix install --frozen-lockfile` passed with the expected
  Node 18 vs Node 24 engine warning.
- Focused ESLint on changed Remix files passed with warnings only.
- `corepack pnpm --dir remix run build` passed under Node 18 with expected
  environment/pre-existing warnings.
- Client bundle scan did not find the new AI/JWT/Vercel secret names.
- GitHub checks for PR #16 were green at review time.
