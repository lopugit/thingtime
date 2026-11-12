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
thin listener from PR #233 lives on `develop`. Because `pull_request_target`
loads its workflow from the default branch, that listener also had to reach
`main` before a live run could exercise the protected implementation. PR #188
merged on 2026-08-17, so `.github/workflows/develop-pr-preview.yml` on `main`
is now the thin listener delegating to
`lopugit/thingtime/.github/workflows/develop-pr-preview.yml@github-actions`.
The corrected Vercel binding clears the stable-domain configuration gate. What
remains is a fresh eligible develop-target PR run as final live proof.

## Fresh controller evidence — 2026-08-12

[Run 31570507671](https://github.com/lopugit/thingtime/actions/runs/31570507671)
was dispatched from this PR's refreshed head SHA. The listener handoff passed,
the default-branch job started, and the controller self-test passed 40/40. The
job then stopped before creating a Vercel deployment because it checked out
`main` at `ca036ea7`, whose previous direct script rejects any wildcard-domain
API result other than a literal `misconfigured: false`.

That failure is not evidence of missing wildcard DNS. Current Vercel metadata
reports the wildcard verified and detached, and both authoritative Cloudflare
nameservers return the exact wildcard CNAME to `cname.vercel-dns.com`. The
protected `github-actions` implementation replaces the obsolete advisory flag
gate with that live CNAME verification. Promotion through #188 has since landed
(2026-08-17), so that obsolete gate is no longer in the path and a fresh
eligible run can now exercise the exact-SHA deployment, alias, CORS, and
attachment checks; none of those mutation stages ran in the failed
default-branch job.

## Separate Production drift

Production was separately observed routing its function through `iad1` with
roughly 200 ms MongoDB latency even though the runbook expects `syd1` and a
single-digit-millisecond Atlas ping. PR #200 does not change Production runtime
placement or infrastructure; that remains a separate investigation.
