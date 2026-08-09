# PR #212 — secure `develop`-target PR previews

## Why this exists

Vercel selects an environment from the deployment target/source branch, not a
pull request's base branch. A feature branch targeting `develop` therefore gets
an ordinary credential-free Preview unless a trusted controller explicitly
deploys that exact commit to the `develop` Custom Environment.

This PR adds that controller without copying development secrets into generic
Preview. Eligible builds intentionally share the same development MongoDB, S3,
quotas, and other services as `dev.thingtime.com`; they are trusted integration
surfaces, not isolated sandboxes.

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

- The existing development runtime variables are scoped to Vercel's `develop`
  Custom Environment rather than generic Preview.
- `dev.thingtime.com` is bound to the literal `develop` Git branch, not to every
  deployment targeting the Custom Environment.
- The PR wildcard is registered and verified in Vercel while remaining detached
  from both a Git branch and a Custom Environment.
- Its DNS-only wildcard CNAME now resolves, but Vercel still reports the domain
  as misconfigured and wildcard TLS fails because the narrow ACME nameserver
  delegation is not yet published.
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
  security audit. A fresh project-scoped 90-day controller token is installed
  only as the masked `VERCEL_DEVELOP_DEPLOY_TOKEN` Environment secret.
- Generic Preview has no private runtime rows. All nine legacy `develop` branch
  rows, plus the develop S3 bucket/region/role and CRON, JWT, MongoDB, and
  application variables, are now scoped only to the `develop` Custom
  Environment. Production remains separately scoped.

## Activation gates

Do not describe credentialed PR previews as live until all of these pass:

1. Keep the DNS-only `*.previews` CNAME and publish the two narrow
   `_acme-challenge.previews` NS delegations documented in
   `VERCEL_DEPLOYMENTS.md`; do not move the apex nameservers. Confirm Vercel
   reports `misconfigured: false` and the wildcard certificate is valid.
2. Add the wildcard PR origin to the private develop bucket's minimal PUT CORS
   rule.
3. Install the unsigned exact-bucket probe URL as the masked
   `THINGTIME_DEVELOP_S3_CORS_PROBE_URL` Environment secret.
4. Merge this PR to `main`; `pull_request_target` cannot activate from the
   feature branch that introduces it.
5. Run the Develop-target checklist in `TESTING.md`, including upload/removal,
   negative-origin, supersession, close, and reconciliation cases.

The `main` ruleset, Environment variables, dedicated Vercel token, and Vercel
runtime scoping are already complete. The wildcard CNAME also resolves, but the
ACME NS delegation, bucket CORS, probe secret, controller merge, and live
checklist remain. Finish the DNS delegation and bucket CORS before installing
the probe secret, then merge the trusted controller and run the live checklist.
Until that final sequence succeeds, the controller is not active and no PR
alias should be described as ready.

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
