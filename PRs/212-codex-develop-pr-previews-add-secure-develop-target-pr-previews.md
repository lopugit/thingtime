# PR #212 — secure `develop`-target PR previews

## Why this exists

Vercel selects an environment from the deployment target/source branch, not a
pull request's base branch. A feature branch targeting `develop` therefore gets
an ordinary Preview unless a trusted controller explicitly deploys that exact
commit to the `develop` Custom Environment.

This PR adds that controller for trusted aliases, exact-SHA status, and durable
cleanup. Generic Preview now intentionally receives the same current runtime
variables as `develop`, so ordinary and controller-managed builds share the
development MongoDB, S3, quotas, and other services as `dev.thingtime.com`;
they are trusted integration surfaces, not isolated sandboxes.

## Security design

- A secret-free `pull_request_target` job checks out no code and forwards only
  bounded event identity through `repository_dispatch`.
- The privileged job always checks out the controller from `main`, behind the
  `vercel-develop-pr-control` GitHub Environment.
- It verifies the source workflow run, repository, same-repository PR, action,
  exact SHA, author, triggering actor, current write/admin permission, Vercel
  project, immutable Custom Environment ID, stable domain, and detached wildcard
  before creating or promoting anything.
- Both author and triggering actor must be explicitly allowlisted. Forks,
  drafts, wrong-base PRs, and stale SHAs fail closed.
- Vercel builds the exact approved SHA remotely. No GitHub job executes PR-head
  code with the controller token.
- One marker comment and one transient GitHub Deployment report state. Alias
  promotion happens only after build readiness, a final live SHA fence, and a
  positive develop-bucket CORS preflight.
- Cleanup acts only on exact project/environment/repository/PR marker metadata;
  close, retarget, draft, supersession, and six-hour reconciliation revoke old
  aliases and delete credentialed deployments without touching
  `dev.thingtime.com`.

## Live setup completed during implementation

- The existing development runtime variables are assigned to both Vercel's
  `develop` Custom Environment and generic Preview. The six existing
  Preview-only filesystem/CI/webhook variables remain in place.
- `dev.thingtime.com` is bound to the literal `develop` Git branch, not to every
  deployment targeting the Custom Environment.
- The develop PR wildcard is registered and verified in Vercel while remaining
  detached from both a Git branch and a Custom Environment. Its DNS-only
  wildcard CNAME and narrow ACME nameserver delegation resolve publicly;
  wildcard TLS verifies. Vercel's external-DNS advisory still reports
  `misconfigured: true` because Cloudflare remains authoritative, so a
  follow-up replaces that advisory gate with live CNAME and HTTPS checks.
- The protected GitHub Environment and its non-secret controller variables
  exist and allow only `main`.
- The active `main` `Basic Protection` ruleset has no bypass, requires pull
  requests with resolved review threads and strict Web CI/CodeQL status checks,
  and blocks deletion and force-pushes.
- The controller Environment intentionally has no required reviewer so event
  cleanup and six-hour reconciliation remain automatic. Independent CODEOWNER
  approval is optional future hardening once a second trusted collaborator can
  review controller changes.
- A previously used Vercel admin token was rotated and revoked during the final
  security audit. A fresh team-scoped 90-day controller token is installed
  only as the masked `VERCEL_DEVELOP_DEPLOY_TOKEN` Environment secret. The
  protected Environment and exact controller project/team checks narrow its
  use because Vercel does not offer a project-scoped PAT for this API surface.
- The masked `THINGTIME_DEVELOP_S3_CORS_PROBE_URL` Environment secret is
  installed with the unsigned exact-bucket probe URL; its value remains absent
  from tracked files and logs.
- Generic Preview receives all 26 current `develop` rows. Development
  APP/CRON/JWT/MongoDB/S3 values remain distinct from Production; AI, SES/email,
  and the Vercel API value are intentionally shared across develop, Preview,
  and Production.
- The protected controller variable now uses
  `PREVIEW_ALIAS_SUFFIX=previews.dev.thingtime.com`. The detached Vercel
  wildcard, DNS-only `*.previews.dev` CNAME, narrow
  `_acme-challenge.previews.dev` NS delegation, wildcard TLS, and exact develop
  bucket CORS origins are live. The development role trusts both the `develop`
  and generic `preview` OIDC subjects. The shorter
  `*.previews.thingtime.com` namespace remains reserved for a separate trusted
  production-preview controller.

## Activation gates

Do not describe credentialed PR previews as live until all of these pass:

1. Merge this PR to `main`; completed at merge commit `36aecdc3`.
2. Merge the follow-up that replaces Vercel's external-DNS advisory gate with
   live CNAME and post-publication HTTPS verification.
3. Run the Develop-target checklist in `TESTING.md`, including upload/removal,
   negative-origin, supersession, close, and reconciliation cases.

The `main` ruleset, Environment variables, dedicated Vercel token, probe secret,
Vercel runtime scoping, develop-only alias suffix, wildcard DNS/ACME/TLS, and
develop bucket CORS are complete, and the controller is on `main`. Its first
live dispatch authenticated and reached the overly strict DNS advisory gate.
Until the follow-up and remaining live checklist succeed, no controller PR
alias should be described as ready. Production previews remain inactive and
must use a separate trusted controller; generic Preview receives the
development AWS role but never the production role.

## Verification completed

- Controller self-test: 40/40
- Node syntax check
- Actionlint 1.7.7
- Workflow YAML parse
- Prettier on the controller and changed runbook files
- Private-identifier scan
- `git diff --check`
- Independent frozen security review: no P0/P1 findings
- Graphify semantic refresh and regenerated portable graph outputs
