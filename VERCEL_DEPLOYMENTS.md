# Vercel Deployments

Last updated: 2026-08-09

## Project

- Vercel project: https://vercel.com/lopugits-projects/thingtime
- Project name: `thingtime`
- Project id: `prj_ZAX9FhGC2alHMXMwTHX96ql3EQ8v`
- GitHub repository: `lopugit/thingtime`
- Function region: `syd1` (Sydney), pinned via `remix/vercel.json` `"regions"` —
  colocated with the Atlas cluster (also Sydney) so per-request Mongo round
  trips stay single-digit ms instead of ~209ms from the old default `iad1`.
  Verify on any deployment: the `x-vercel-id` response header should read
  `syd1::syd1::…` and `GET /api/v1/health/mongodb` should report `pingMs` < 10.
- Anonymous feed/search GETs sent with `anon=1` return
  `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` and are
  served from the nearest edge PoP (`x-vercel-cache: HIT`); authed requests
  never use `anon=1` URLs, so they can never hit those cache entries.

## Production

- Production alias: https://thingtime-lopugits-projects.vercel.app
- Main branch alias: https://thingtime-git-main-lopugits-projects.vercel.app
- Production branch: `main`

## Preview

- Generated preview URLs use `https://thingtime-<generated>-lopugits-projects.vercel.app`.
- The `staging` branch alias is https://thingtime-git-staging-lopugits-projects.vercel.app.
- For feature branches, use the Vercel PR status URL or deployment URL from
  the GitHub PR checks.

### Develop-target PR previews

Vercel Custom Environment branch tracking matches the deployment's source
branch. It automatically sends the `develop` branch to the `develop` Custom
Environment, but a feature branch whose PR targets `develop` is otherwise a
generic Preview and does not inherit develop variables.

The trusted `Develop S3 PR preview` workflow closes that gap without broadening
generic Preview access. For a same-repository, trusted-author PR targeting
`develop`, it asks Vercel to build the exact head SHA in the `develop` Custom
Environment, publishes a transient GitHub Deployment, and maintains one sticky
PR comment containing the deployment status and
`https://pr-<number>.previews.thingtime.com`. Forks, drafts, wrong-base PRs, and
untrusted authors remain on the ordinary develop-credential-free Preview path.
The workflow never checks out or executes PR-head code on the GitHub runner;
Vercel performs the remote build.

Its trust boundary is two-stage. The `pull_request_target` job has no GitHub
Environment or Vercel secret, checks out no code, and emits a bounded
`repository_dispatch`. The privileged default-branch job behind
`vercel-develop-pr-control` verifies the source workflow path/run, repository,
same-repository PR, source action, head SHA, and triggering actor against the
live GitHub API before any Vercel API call or mutation. It then re-fetches the
PR and repeats author/actor allowlist, live permission, eligibility, and SHA
checks before creating or promoting a Vercel deployment.

The controller exists only after its workflow and script are merged to the
default `main` branch: `pull_request_target` always loads its trusted workflow
definition from the default branch, not from the PR. Keep required CODEOWNER
review enabled for those two controller files. A CODEOWNERS file alone does not
enforce approval: before installing either secret, add a `main` ruleset that
requires CODEOWNER review (or require a trusted reviewer on the controller
Environment).

One-time private setup (values never belong in git):

- GitHub Environment: create `vercel-develop-pr-control`, select only the
  `main` deployment branch, and keep its secrets/variables out of repository
  scope. The secret-free `pull_request_target` stage hands off to a
  default-branch `repository_dispatch`; scheduled runs use the default branch,
  and the workflow refuses manual dispatch from another ref.
- Environment secrets: `VERCEL_DEVELOP_DEPLOY_TOKEN`, set to a fresh dedicated
  Vercel control-plane token rather than the app's runtime status token, and
  `THINGTIME_DEVELOP_S3_CORS_PROBE_URL`, set to a credential-free HTTPS object
  URL on the exact develop bucket with no query string or signature. The
  controller uses the latter only for an unauthenticated CORS `OPTIONS` check
  and refuses to publish the PR alias when the check fails. Keeping it masked
  avoids exposing the private bucket name through an Actions variable.
- Environment variables: `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME`,
  `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_GITHUB_REPO_ID`, and
  `VERCEL_CUSTOM_ENVIRONMENT_ID` with the exact immutable value
  `<Vercel-develop-custom-environment-id>` (never the friendly slug alone), plus
  `DEVELOP_PREVIEW_TRUSTED_ACTORS` containing a comma/space-separated allowlist
  such as `<trusted-GitHub-login>[,<trusted-GitHub-login>]`,
  `PREVIEW_ALIAS_SUFFIX` (`previews.thingtime.com` here), and
  `STABLE_DEVELOP_DOMAIN` (`dev.thingtime.com` here). Forks must substitute
  domains they control.
- Trust gate: both the PR author and the triggering actor must be on that
  explicit allowlist and retain current GitHub write/admin permission. Repository
  membership or a same-repository branch alone is insufficient.
- Vercel: keep the Custom Environment's branch matcher on `develop`; bind
  `dev.thingtime.com` to `gitBranch: develop` with no `customEnvironmentId` on
  the domain, not to the whole Custom Environment, and keep the Custom
  Environment's own domain list empty. PR creation passes the exact environment
  ID and assigns only the verified PR alias explicitly, so a PR can never move
  the stable domain.
- Vercel: `*.previews.thingtime.com` is already registered, verified, and
  detached from both Git branches and Custom Environments. The controller
  assigns each alias explicitly only after all identity/SHA gates.
- DNS: the remaining Thingtime record is a DNS-only/grey-cloud CNAME from
  `*.previews` to `cname.vercel-dns.com`. Forks must use the exact CNAME and any
  verification record their own Vercel project currently displays; do not copy
  another project's account-specific targets.
- Develop S3 bucket CORS: retain `https://dev.thingtime.com` and add
  `https://*.previews.thingtime.com`, with method `PUT`, allowed header
  `x-amz-checksum-sha256`, no exposed headers, and `MaxAgeSeconds: 300`.
  CORS is not authorization; only the custom-environment deployment can obtain
  a signed upload plan. Generic Preview OIDC remains untrusted by the role.

The wildcard DNS record, bucket CORS update, masked probe secret, fresh
dedicated Vercel token, and enforced controller review boundary are activation
prerequisites and remain pending until their respective administrators complete
and verify them. A green controller self-test alone does not prove browser
uploads are ready.

Do not copy the develop bucket/role variables into Vercel's generic Preview
environment or trust `environment:preview` in AWS. Keep MongoDB, JWT, email, S3,
AI, and every other private develop value scoped to the `develop` Custom
Environment. Every ordinary project Preview shares the generic Preview identity,
regardless of the PR's base branch, so it must remain free of the develop role
and private runtime configuration.

Develop-target PRs are not isolated from one another or from
`dev.thingtime.com`: they use the same development MongoDB, S3 bucket, storage
quotas, email/test services, and other Custom Environment state. Admit trusted
same-repository code only, use disposable test data, and assume concurrent PRs
can observe or mutate the same development resources.

Lifecycle and recovery:

- On open/reopen/ready/synchronize, the controller re-reads the live PR, deploys
  the exact current SHA, revalidates it before alias promotion, updates one
  marker comment through deploying/ready/failure, and removes only older
  workflow-tagged deployments for that PR.
- On close or loss of eligibility, it removes the PR alias, marks its transient
  GitHub Deployment inactive, and deletes only Vercel deployments bearing the
  controller's PR/marker metadata. The stable branch-bound
  `dev.thingtime.com` deployment is outside that deletion set.
- Reconciliation runs every six hours at minute 17 and repeats the same
  marker-scoped cleanup for missed close events, interrupted runs, stale aliases,
  and orphaned controller deployments. It is bounded and idempotent. Manual
  dispatch accepts one PR number and safely revalidates/redeploys that eligible
  PR after fixing Vercel, DNS, CORS, or token configuration; the schedule remains
  the cleanup backstop for ineligible stale resources.

## Verified PR Previews

- PR #24, branch `codex/migrate-remix-to-nitro`, commit
  `b8e14222184706bfef101e3dedace793ffa2d198`:
  https://thingtime-qsxzsqb4h-lopugits-projects.vercel.app
  - Deployment id: `dpl_Z6ER3iuXGXQrzeTN6K45YTUSK69j`
  - Verified routes: `/`, `/index.html`, `/vercel`, `/api/root-data`,
    `/api/v1/vercel/deployments`, and `/assets/index-yPU6cX3C.js`.
