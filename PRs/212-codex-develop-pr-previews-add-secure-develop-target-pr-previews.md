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
- The protected GitHub Environment and its non-secret controller variables
  exist and allow only `main`.
- A previously used Vercel admin token was rotated and revoked during the final
  security audit. No controller token is currently installed.

## Activation gates

Do not describe credentialed PR previews as live until all of these pass:

1. Enforce CODEOWNER approval for the controller workflow/script on `main`, or
   require a trusted reviewer on the controller Environment. CODEOWNERS alone is
   not enforcement.
2. Create a fresh, dedicated, project-scoped Vercel token and install it as the
   masked `VERCEL_DEVELOP_DEPLOY_TOKEN` Environment secret.
3. Publish the DNS-only wildcard CNAME documented in
   `VERCEL_DEPLOYMENTS.md` and confirm Vercel reports `misconfigured: false`.
4. Add the wildcard PR origin to the private develop bucket's minimal PUT CORS
   rule.
5. Install the unsigned exact-bucket probe URL as the masked
   `THINGTIME_DEVELOP_S3_CORS_PROBE_URL` Environment secret.
6. Merge this PR to `main`; `pull_request_target` cannot activate from the
   feature branch that introduces it.
7. Run the Develop-target checklist in `TESTING.md`, including upload/removal,
   negative-origin, supersession, close, and reconciliation cases.

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
