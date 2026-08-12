# PR #200 — Document shared Preview runtime and Production isolation

- **Branch**: `codex/vercel-develop-atlas-env`
- **Base**: `develop`
- **PR**: https://github.com/lopugit/thingtime/pull/200

## Refreshed scope

PR #200 was rebuilt from current `develop` as a focused runbook change. It
retains the useful development-versus-Production isolation documentation and
describes the current shared-development-preview model: `dev.thingtime.com`,
generic Vercel Preview deployments, and trusted develop-target PR aliases use
the same disposable development MongoDB, JWT, cron, private-S3, and integration
state. Production MongoDB, JWT, and S3 remain separately scoped.

The database username embedded in `MONGODB_CONNECTION_STRING` is authoritative;
`MONGO_USER` is operator metadata. The application explicitly selects the
canonical `thingtime` database even when the Atlas URI has no database path.

## Corrected live domain state — 2026-08-12

The stable development-domain mismatch recorded in the first refresh has now
been fixed outside the repository:

- Vercel reports `dev.thingtime.com` as verified, with
  `gitBranch: develop` and `customEnvironmentId: null`.
- The `develop` Custom Environment still matches the literal `develop` branch
  and has an empty domain list.
- The wildcard is verified and detached from Git branches and Custom
  Environments, while HTTPS serves its valid wildcard certificate.
- Both authoritative Cloudflare nameservers return the narrow
  `_acme-challenge.previews.dev.thingtime.com` delegation to
  `ns1.vercel-dns.com` and `ns2.vercel-dns.com` in the DNS referral's authority
  section. A recursive `dig +short NS` can therefore look empty without proving
  that the delegation is absent.

No account-specific DNS challenge value, credential, bucket name, role ARN,
JWT material, or environment-variable value is stored in the repository.

## Current CI direction

The protected implementation from PR #239 lives on `github-actions`, and the
thin listener from PR #233 lives on `develop`. The default `main` branch still
contains the previous direct workflow; PR #188 remains the reviewed promotion
path that brings the thin listener to the default branch. The corrected Vercel
binding clears the controller's domain configuration gate, while a fresh
eligible run on this PR supplies live evidence for its exact-SHA deployment,
alias, CORS, and attachment checks.

## Separate Production drift

Production was separately observed routing its function through `iad1` with
roughly 200 ms MongoDB latency even though the runbook expects `syd1` and a
single-digit-millisecond Atlas ping. PR #200 does not change Production runtime
placement or infrastructure; that remains a separate investigation.
