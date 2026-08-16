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
- Private media and attachments use Vercel OIDC to assume the AWS role named
  `thingtime-vercel-s3-production`. The project variables
  `THINGTIME_PRIVATE_S3_ROLE_ARN`, `THINGTIME_PRIVATE_S3_BUCKET`, and
  `THINGTIME_PRIVATE_S3_REGION` are scoped to Production only. Preview and
  develop deployments cannot assume this role or upload to the production
  bucket.
  The production bucket configuration, variables, and existing objects were not
  changed when develop storage was provisioned. The production role gained the
  required `s3:PutObjectTagging` action used by tagged multipart initiation.
- Add `CRON_SECRET` as a **Sensitive**, **Production-only** variable (never
  record its value here). `remix/vercel.json` invokes
  `GET /api/v1/attachments/cleanup` at minute 17 every hour; Vercel sends the
  exact `Authorization: Bearer <CRON_SECRET>` header automatically. The route
  has no cookie, PAT, app-token, or service-account fallback, processes at most
  1,000 cleanup intents with a 25-second wall-clock budget, and leaves failed
  rows billed and scheduled for a later retry. Canceled multipart uploads that
  issued a part URL stay billed through the bucket's seven-day lifecycle window
  plus a safety day, then require two empty verification passes at least one
  hour apart.

## Develop Custom Environment

- Vercel Custom Environment: `develop` (Pre-Production), with an exact branch
  matcher for `develop`. This is distinct from both Vercel's generic Preview
  environment and its built-in local/CLI Development environment.
- Stable origin: https://dev.thingtime.com. The domain is verified and bound to
  the exact Git branch `develop` (`customEnvironmentId: null`), so Vercel shows
  it on the Preview row even though the branch deployment itself targets the
  `develop` Custom Environment. Keep the Custom Environment's own domain list
  empty so a PR deployment explicitly targeting it cannot move the stable
  hostname.
- Stable environment alias:
  https://thingtime-env-develop-lopugits-projects.vercel.app.
- Private attachments use a dedicated develop bucket and IAM role. The role
  trusts the two exact Vercel OIDC subjects
  `owner:lopugits-projects:project:thingtime:environment:develop` and
  `owner:lopugits-projects:project:thingtime:environment:preview`; neither can
  assume the production role. The develop bucket's upload CORS allowlist is
  limited to `https://dev.thingtime.com`, the controller-managed
  `https://*.previews.dev.thingtime.com` aliases, and Thingtime's generated
  `https://thingtime-*-lopugits-projects.vercel.app` Preview hostnames.
- `THINGTIME_PRIVATE_S3_ROLE_ARN`, `THINGTIME_PRIVATE_S3_BUCKET`,
  `THINGTIME_PRIVATE_S3_REGION`, and a distinct `CRON_SECRET` are Sensitive.
  The same development values are assigned to the `develop` Custom Environment
  and generic Preview; Production keeps separate values.
- Vercel Cron invokes Production deployments only. Develop cleanup is therefore
  targeted at minute 17 every hour by a dedicated AWS EventBridge API
  Destination using the develop `CRON_SECRET`; its IAM invocation role is
  limited to that one destination. The app route still rejects missing, wrong,
  user, PAT, and service-account credentials.
  The rule and destination are configured, but the first successful invocation
  remains pending until this PR's attachment route is deployed to `develop`.
- Cloudflare DNS remains `CNAME dev` to
  `b45b7349d6eb9c18.vercel-dns-017.com`, DNS only, TTL Auto. Vercel domain
  ownership and TLS are verified.

## Preview

- Generated preview URLs use `https://thingtime-<generated>-lopugits-projects.vercel.app`.
- Feature branches remain in the generic Preview environment. Newly built
  previews receive the development runtime, including its S3 variables, and
  their shared `environment:preview` OIDC subject is trusted only by the
  development attachment role. They never receive Production MongoDB, JWT, or
  S3 values.
- The `staging` branch alias is https://thingtime-git-staging-lopugits-projects.vercel.app.
- For feature branches, use the Vercel PR status URL or deployment URL from
  the GitHub PR checks.

### Develop-target PR previews

Vercel Custom Environment branch tracking matches the deployment's source
branch. It automatically sends the `develop` branch to the `develop` Custom
Environment, but a feature branch whose PR targets `develop` is otherwise a
generic Preview. Thingtime now assigns the same current runtime-variable set to
generic Preview as to `develop`, so newly built feature previews share the
development MongoDB, JWT, S3, AI, email, and integration configuration.

The trusted `Develop S3 PR preview` workflow still adds a controlled stable
alias and lifecycle around eligible changes. For a same-repository,
trusted-author PR targeting `develop`, it asks Vercel to build the exact head
SHA in the `develop` Custom Environment, publishes a transient GitHub
Deployment, and maintains one sticky PR comment containing the deployment
status and `https://pr-<number>.previews.dev.thingtime.com`. Forks, drafts,
wrong-base PRs, and untrusted authors never receive that controller-managed
alias, although any ordinary Preview Vercel chooses to build now uses the
shared development runtime.
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
definition from the default branch, not from the PR. Thingtime's active `main`
`Basic Protection` ruleset has no bypass: it requires a pull request, resolved
review threads, strict Web CI and CodeQL status checks, and blocks deletion and
force-pushes. CODEOWNERS requests owner review but does not enforce it;
independent CODEOWNER approval is optional future hardening once a second
trusted collaborator exists. Do not add a required reviewer to the controller
Environment in the solo-maintainer configuration: every event cleanup and
six-hour reconciliation job would otherwise wait for manual approval.

One-time private setup (values never belong in git):

- GitHub Environment: Thingtime's `vercel-develop-pr-control` Environment
  exists, selects only the `main` deployment branch, has no required reviewer,
  and keeps its secrets/variables out of repository scope. The secret-free
  `pull_request_target` stage hands off to a default-branch
  `repository_dispatch`; scheduled runs use the default branch, and the
  workflow refuses manual dispatch from another ref.
- Environment secrets: the fresh, dedicated, project-scoped 90-day Vercel
  control-plane token is installed as `VERCEL_DEVELOP_DEPLOY_TOKEN`, separate
  from the app's runtime status token. The masked
  `THINGTIME_DEVELOP_S3_CORS_PROBE_URL` secret is also installed as a
  credential-free HTTPS object URL on the exact develop bucket with no query
  string or signature. The controller uses it only for an unauthenticated CORS
  `OPTIONS` check and refuses to publish the PR alias when the check fails.
  Keeping it masked avoids exposing the private bucket name through an Actions
  variable.
- Environment variables: `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME`,
  `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_GITHUB_REPO_ID`, and
  `VERCEL_CUSTOM_ENVIRONMENT_ID` with the exact immutable value
  `<Vercel-develop-custom-environment-id>` (never the friendly slug alone), plus
  `DEVELOP_PREVIEW_TRUSTED_ACTORS` containing a comma/space-separated allowlist
  such as `<trusted-GitHub-login>[,<trusted-GitHub-login>]`,
  `PREVIEW_ALIAS_SUFFIX` (`previews.dev.thingtime.com` here), and
  `STABLE_DEVELOP_DOMAIN` (`dev.thingtime.com` here). Forks must substitute
  domains they control.
- Vercel runtime scope: every variable currently assigned to the `develop`
  Custom Environment is also assigned to generic Preview, while the six
  existing Preview-only filesystem/CI/webhook values remain. Development
  MongoDB/JWT/S3 values stay distinct from Production; AI, SES/email, and the
  Vercel API value are intentionally shared with Production and Preview.
- Trust gate: both the PR author and the triggering actor must be on that
  explicit allowlist and retain current GitHub write/admin permission. Repository
  membership or a same-repository branch alone is insufficient.
- Vercel: keep the Custom Environment's branch matcher on `develop`; bind
  `dev.thingtime.com` to `gitBranch: develop` with no `customEnvironmentId` on
  the domain, not to the whole Custom Environment, and keep the Custom
  Environment's own domain list empty. PR creation passes the exact environment
  ID and assigns only the verified PR alias explicitly, so a PR can never move
  the stable domain.
- Vercel: `*.previews.dev.thingtime.com` is registered, verified, and
  detached from both Git branches and Custom Environments. The controller
  assigns each alias explicitly only after all identity/SHA gates.
- DNS: keep Cloudflare authoritative for the `thingtime.com` apex. Use a
  DNS-only/grey-cloud CNAME from `*.previews.dev` to `cname.vercel-dns.com`, plus
  NS delegations from `_acme-challenge.previews.dev` to both
  `ns1.vercel-dns.com` and `ns2.vercel-dns.com` so Vercel can issue and renew
  wildcard TLS certificates.
  Do not move the apex nameservers or delegate a broader subtree; reserve this
  ACME subtree for the preview wildcard because the delegation can prevent
  another provider from issuing certificates there. See Vercel's official
  [wildcard-without-Vercel-nameservers guide](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers).
  Forks must use the exact records their own Vercel project currently displays;
  do not copy another project's account-specific targets.
- Develop S3 bucket CORS: retain `https://dev.thingtime.com`,
  `https://*.previews.dev.thingtime.com`, and
  `https://thingtime-*-lopugits-projects.vercel.app`, with method `PUT`, allowed
  header `x-amz-checksum-sha256`, no exposed headers, and
  `MaxAgeSeconds: 300`. The development role trusts both
  `environment:develop` and `environment:preview`; the production role remains
  excluded from generic Preview.

Activation status as of 2026-08-10: the no-bypass `main` ruleset, protected
Environment, all controller variables, dedicated 90-day Vercel token, masked
`THINGTIME_DEVELOP_S3_CORS_PROBE_URL` secret, shared develop/Preview runtime
scope, generic-Preview OIDC trust, develop bucket CORS, detached Vercel
wildcard, DNS-only wildcard CNAME, narrow ACME NS delegation, and wildcard TLS
are complete for
`*.previews.dev.thingtime.com`. Merge of the controller to `main` and the live
end-to-end checklist remain pending. The installed secrets alone do not
activate the feature, and a green controller self-test alone does not prove
browser uploads are ready.

The shorter `*.previews.thingtime.com` namespace is reserved for a separate
future production-preview controller. It must use an independently protected
control environment and exact production OIDC trust. Never give the production
S3 role or production MongoDB/JWT/S3 values to Vercel's generic Preview
environment. Generic Preview deliberately has the development role and current
develop runtime instead.

Generic Previews and develop-target PR aliases are not isolated from one another
or from `dev.thingtime.com`: they use the same development MongoDB, S3 bucket,
storage quotas, email/test services, and other runtime state. Allow only trusted
code to build in this Vercel project, use disposable test data, and assume
concurrent branches can observe or mutate the same development resources.

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
