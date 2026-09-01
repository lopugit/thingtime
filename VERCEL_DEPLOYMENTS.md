# Vercel Deployments

Last updated: 2026-09-01

## Project

- Vercel project: https://vercel.com/lopugits-projects/thingtime
- Project name: `thingtime`
- Project id: `prj_ZAX9FhGC2alHMXMwTHX96ql3EQ8v`
- GitHub repository: `lopugit/thingtime`
- Function region: `syd1` (Sydney), pinned via root `vercel.json` `"regions"` —
  colocated with the Atlas cluster (also Sydney) so per-request Mongo round
  trips stay single-digit ms instead of ~209ms from the old default `iad1`.
  Verify on any deployment: the `x-vercel-id` response header should read
  `syd1::syd1::…` and `GET /api/v1/health/mongodb` should report `pingMs` < 10.
- Anonymous feed/search GETs sent with `anon=1` return
  `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` and are
  served from the nearest edge PoP (`x-vercel-cache: HIT`); authed requests
  never use `anon=1` URLs, so they can never hit those cache entries.

## Repository-root build contract

- Root Directory: repository root (the Vercel field is blank; it must not be
  `remix`).
- Framework Preset: Other. The tracked `vercel.json` uses `framework: null`
  because Nitro emits the Build Output API directly.
- Build, Install, Output Directory, and Ignored Build Step dashboard overrides:
  clear them so root `vercel.json` is the single source of truth.
- Output Directory: no dashboard override. Root `vercel.json` explicitly sets
  it to `null`; `node scripts/vercel-build.mjs` validates
  `remix/.vercel/output`, stages it at root `.vercel/output`, and validates the
  staged artifact again.
- Node.js: 24.x, matching `remix/package.json`.
- Git deployment policy: automatic Git deployments are disabled for every
  branch except `main` and `develop`. Those two exact branches retain Vercel's
  native Production and stable-development builds. Eligible PR previews are
  built on GitHub and uploaded with Vercel's prebuilt protocol; arbitrary
  feature, `staging`, `all`, and control-plane pushes no longer spend Vercel
  Build CPU. `ignoreCommand` remains a second fail-safe.
- Source Files Outside of the Root Directory: no longer needed once Root
  Directory is the repository root; it may be disabled.

## Production

- Public domain: https://thingtime.com
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
- Promoted deployment (2026-08-10):
  https://thingtime-sadpi5ghm-lopugits-projects.vercel.app
  (`dpl_CEbZybxGzQT2EgatEktfGQfNsUTH`). This fresh build picked up the repaired
  sensitive `VERCEL_API_TOKEN`; the public
  `/api/v1/vercel/deployments?limit=50` response was verified with
  `source: "api"`, `hasError: false`, and more than 25 branch destinations after
  promotion.

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

## Develop environment

- Branch: `develop` — the integration branch. Feature PRs merge into
  `develop`, everything is tested on the develop deployment, and `develop` is
  merged into `main` when it's ready to ship.
- Branch alias: https://thingtime-git-develop-lopugits-projects.vercel.app
- Database: `develop` has its OWN MongoDB (a dedicated free-tier Atlas
  cluster), never the production cluster. Two branch-scoped env vars exist in
  Vercel (target Preview, git branch `develop`) and currently hold
  self-describing placeholders so develop can never accidentally reach the
  production database:
  - `MONGODB_CONNECTION_STRING` — replace with the develop Atlas URI (it may
    contain the literal `<db_password>` placeholder).
  - `MONGO_PASS` — replace with the develop DB password (only needed when the
    URI contains `<db_password>`).
  Update them at
  https://vercel.com/lopugits-projects/thingtime/settings/environment-variables
  (search "MONGO", the develop-scoped rows show the `develop` branch chip),
  then redeploy the `develop` branch. Until real values are set, develop
  deployments boot but `GET /api/v1/health/mongodb` reports a connection error
  by design.

## Preview

- Generated preview URLs use `https://thingtime-<generated>-lopugits-projects.vercel.app`.
- The `develop` branch alias is
  https://thingtime-git-develop-lopugits-projects.vercel.app.
- https://dev.thingtime.com is a branch-specific Preview domain that tracks
  `develop`; Vercel's built-in Development environment remains local/CLI-only.
  See "Develop Custom Environment" above for its verified branch binding and
  the empty-Custom-Environment-domain-list invariant.
  - Cloudflare DNS: `CNAME dev` to
    `b45b7349d6eb9c18.vercel-dns-017.com`, DNS only, TTL Auto.
  - If Vercel reports a pending ownership challenge, publish the exact
    `_vercel` TXT value returned by the Vercel project-domain inspector; do
    not record the rotating verification value in this repository.
  - Vercel assignment was configured on 2026-08-07. The public CNAME resolves,
    and Vercel ownership plus HTTPS are verified as of 2026-08-12. Recheck the
    records and live hostname after any domain or branch-binding change.
- Feature branches remain in the generic Preview environment. Newly built
  previews receive the development runtime, including its S3 variables, and
  their shared `environment:preview` OIDC subject is trusted only by the
  development attachment role. They never receive Production MongoDB, JWT, or
  S3 values.
- The `staging` branch alias is https://thingtime-git-staging-lopugits-projects.vercel.app.
- For eligible develop-target feature branches, use the controller-managed
  `https://pr-<number>.previews.dev.thingtime.com` URL from the GitHub PR
  status. Other feature branches do not receive automatic Vercel deployments.

### Development data and auth scope

The `develop` Custom Environment and generic Preview deliberately share the
same development runtime. The shared scope includes `APP_URL`, `CRON_SECRET`,
the JWT key/issuer values, `MONGODB_CONNECTION_STRING`, `MONGO_PASS`, and the
private-S3 bucket/region/role values. Production MongoDB, JWT, and S3 records
remain separately scoped and must never be copied into Preview.

The database user embedded in `MONGODB_CONNECTION_STRING` is authoritative;
`MONGO_USER` is informational metadata and is not read by the application. The
home API explicitly opens the canonical `thingtime` database even when the
Atlas URI has an empty database path.

Live verification on 2026-08-12 returned HTTP 200, `connected: true`, host
`thingtime-develop.ymezxh8.mongodb.net`, and `dbName: "thingtime"` from
`https://dev.thingtime.com/api/v1/health/mongodb`, with no
`x-thingtime-api-fallback` response header. The Production endpoint also
returned HTTP 200 and `connected: true`, but reported the distinct
`thingtime.4ekjigs.mongodb.net` host. Passwords, JWT material, bucket names,
role ARNs, and other private values remain outside this repository.

### Develop-target PR previews

Vercel Custom Environment branch tracking automatically sends the exact
`develop` branch to the `develop` Custom Environment. Automatic feature-branch
Git deployments are disabled. The controller explicitly targets the same
Custom Environment when it uploads an eligible GitHub-built prebuilt bundle,
so those previews receive the development runtime without a Vercel build.

The trusted `Develop S3 PR preview` workflow still adds a controlled stable
alias and lifecycle around eligible changes. For a same-repository,
trusted-author PR targeting `develop`, it builds the exact head SHA in a
secret-free GitHub job, validates and uploads the Build Output bundle to the
`develop` Custom Environment, publishes a transient GitHub
Deployment, and maintains one sticky PR comment containing the deployment
status and `https://pr-<number>.previews.dev.thingtime.com`. Forks, drafts,
wrong-base PRs, and untrusted authors never receive that controller-managed
alias.

Its trust boundary is three-stage. Product branches retain only a thin listener
pinned to the reusable implementation on `github-actions`. The
`pull_request_target` job has no GitHub Environment or Vercel secret, checks out
no code, and emits a bounded `repository_dispatch`. A protected authorizer
checks out only `github-actions`, reads the Environment-scoped non-secret
settings, and verifies the source workflow, repository, same-repository PR,
head SHA, action, and actor against GitHub. A separate environment-free job
checks out only that authorized SHA, builds `.vercel/output` without secrets,
and uploads a short-lived artifact. Finally, the protected publisher validates
archive paths, links, size, routes, and shell before a pinned Vercel CLI uploads
it with `--prebuilt`; only that final controller process receives the Vercel
token and unsigned S3 CORS probe URL.

The controller exists only after its reusable implementation and script merge
to `github-actions` and its thin listener reaches the default `main` branch via
`develop`: `pull_request_target` always loads its listener from the default
branch, not from the PR. Thingtime's active `main`
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
- Environment secrets: the fresh, dedicated, team-scoped 90-day Vercel
  control-plane token is installed as `VERCEL_DEVELOP_DEPLOY_TOKEN`, separate
  from the app's runtime status token. Vercel does not offer a project-scoped
  PAT for this API surface, so the protected Environment plus the controller's
  exact team/project checks constrain its use. The masked
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
  Verify the delegation against either authoritative Cloudflare nameserver with
  `+norecurse +authority`. The delegation is a referral in the authority
  section, so recursive `dig +short NS` output can be empty even when both NS
  records are correctly published.
  Do not move the apex nameservers or delegate a broader subtree; reserve this
  ACME subtree for the preview wildcard because the delegation can prevent
  another provider from issuing certificates there. See Vercel's official
  [wildcard-without-Vercel-nameservers guide](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers).
  With this external-DNS topology Vercel can continue to report the advisory
  `DNS Change Recommended` or `misconfigured: true` because the apex
  nameservers remain on Cloudflare. The controller verifies the live wildcard CNAME against
  Vercel's recommended target and the published alias over HTTPS instead of
  treating that advisory as a failure.
  Making Vercel authoritative would normally remove the advisory, but
  Thingtime deliberately keeps Cloudflare authoritative and delegates only the
  narrow ACME validation subtrees.
  Forks must use the exact records their own Vercel project currently displays;
  do not copy another project's account-specific targets.
- Develop S3 bucket CORS: retain `https://dev.thingtime.com`,
  `https://*.previews.dev.thingtime.com`, and
  `https://thingtime-*-lopugits-projects.vercel.app`, with method `PUT`, allowed
  header `x-amz-checksum-sha256`, no exposed headers, and
  `MaxAgeSeconds: 300`. The development role trusts both
  `environment:develop` and `environment:preview`; the production role remains
  excluded from generic Preview.

Activation status as of 2026-08-12: the no-bypass `main` ruleset, protected
Environment, all controller variables, dedicated 90-day Vercel token, masked
`THINGTIME_DEVELOP_S3_CORS_PROBE_URL` secret, shared develop/Preview runtime
scope, generic-Preview OIDC trust, develop bucket CORS, detached Vercel
wildcard, DNS-only wildcard CNAME, narrow ACME NS delegation, and wildcard TLS
are complete for `*.previews.dev.thingtime.com`. The protected implementation
from #239 has merged to `github-actions`, and the thin listener from #233 has
reached `develop`.

The stable-domain binding now matches the protected controller's invariant and
no longer blocks its configuration gate. Because `pull_request_target` loads its
workflow from the default branch, the thin listener also had to reach `main`
before a live run could exercise the protected implementation. **That promotion
has since landed** (#188 merged 2026-08-17):
`.github/workflows/develop-pr-preview.yml` on `main` is now the thin listener
delegating to
`lopugit/thingtime/.github/workflows/develop-pr-preview.yml@github-actions`.
`main`'s previous direct controller — whose obsolete requirement for a literal
`misconfigured: false` could reject healthy externally managed wildcard DNS
before deployment — is therefore no longer in the path. What remains is a fresh
eligible run exercising the protected #239 implementation's exact-SHA
deployment, alias publication, CORS probe, and attachment upload/removal checks.

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

## CI Control integration

- Stable callback origin: `https://dev.thingtime.com`
- GitHub webhook: `/api/v1/integrations/github/webhook`
- Vercel project webhook: `/api/v1/integrations/vercel/webhook`
- Signed Actions provider router: `/api/v1/integrations/ci/route`
- The deployed app uses Vercel Workflow plus ephemeral Vercel Sandbox runners
  for automations whose Admin policy selects `vercel-sandbox`; the exact
  workflow YAML remains pinned to the protected `github-actions` branch.
- Private environment values are documented in `README.md` and must be entered
  in Vercel/GitHub settings only. Never record their live values here.
- Admin readiness is a single server-derived capability: GitHub App id,
  installation id and private key, the provider-router secret, and Vercel
  runtime identity must all be present. Partial setup remains visibly disabled
  and cannot be saved through the policy API.
- The dashboard is expected to remain empty until the GitHub App is installed,
  both webhooks are active, and an administrator runs Reconcile once.
- A selected same-repository PR can opt into Develop, Production, or both from
  its admin detail panel. The server builds the exact current head SHA, and the
  signed pull-request webhook rebuilds enabled environments after synchronize,
  reopen, or ready-for-review events.
- Develop uses `VERCEL_CUSTOM_ENVIRONMENT_ID`; Production uses Vercel's
  production target. Both set `autoAssignCustomDomains: false`, so the returned
  immutable `*.vercel.app` URL never moves `dev.thingtime.com`,
  `thingtime.com`, or another custom domain. Closing or disabling removes only
  deployments bearing the matching Thingtime PR/environment markers.
- Required server-only values are `VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`,
  `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME`, `VERCEL_GITHUB_REPO_ID`, and—for
  Develop only—`VERCEL_CUSTOM_ENVIRONMENT_ID`. Values stay in Vercel settings;
  no live identifier or credential is recorded here.

## Verified PR Previews

- PR #554, branch `codex/rich-commander-previews`:
  https://pr-554.previews.dev.thingtime.com
  - Generated Vercel deployment from the GitHub Actions prebuilt upload:
    https://thingtime-gt3r0i36w-lopugits-projects.vercel.app
  - The stable custom domain is the canonical preview alias. The generated
    Vercel URL is an artifact-hosting deployment, not a Git-tracked branch URL.
  - Verified HTTP 200 at `/` on 2026-09-01.

- PR #24, branch `codex/migrate-remix-to-nitro`, commit
  `b8e14222184706bfef101e3dedace793ffa2d198`:
  https://thingtime-qsxzsqb4h-lopugits-projects.vercel.app
  - Deployment id: `dpl_Z6ER3iuXGXQrzeTN6K45YTUSK69j`
  - Verified routes: `/`, `/index.html`, `/vercel`, `/api/root-data`,
    `/api/v1/vercel/deployments`, and `/assets/index-yPU6cX3C.js`.

## Deployment-status webhook (TODO item 5)

The footer/status endpoints no longer need to poll the Vercel API once the
deployment webhook is configured:

- Receiver: `POST /api/v1/vercel/webhook` (HMAC sha1 of the raw body in
  `x-vercel-signature`; 404 while `VERCEL_WEBHOOK_SECRET` is unset, 401 on bad
  signatures).
- One-time setup (owner-run, deliberately not automated by any build step):
  either run the one-shot script
  `VERCEL_API_TOKEN=... node remix/scripts/vercel/create-webhook.mjs https://thingtime-lopugits-projects.vercel.app/api/v1/vercel/webhook`
  (registers `deployment.created/succeeded/promoted/error/canceled` for the
  project and prints the signing secret exactly once — credit: session 1's
  closed PR #118), or create the same webhook manually in the Vercel dashboard
  (team `lopugits-projects`, project `thingtime`). Then set
  `VERCEL_WEBHOOK_SECRET` (the secret shown on creation) in the project's
  environment variables and redeploy.
- Behaviour: the latest event per git branch is persisted in the `settings`
  collection (`vercelWebhookStatus`, capped at 30 branches).
  `GET /api/v1/vercel/status` serves `ready` straight from that document (zero
  Vercel API calls); building/queued states still use the live Vercel API for
  phase/progress detail.
- Failure attribution: a branch has one record but can have several concurrent
  deployments — the "Develop-target PR previews" section above builds one head
  SHA into both generic Preview and the `develop` Custom Environment, and both
  emit events under the same `githubCommitRef`. A recorded `error`/`canceled`
  is therefore only served when the record matches the deployment answering the
  request (`VERCEL_URL`, or `VERCEL_GIT_COMMIT_SHA` when no URL is available);
  otherwise the live poll decides. Without that check a failed sibling build
  would show a healthy deployment as failed in the footer and in
  `/api/v1/health/vercel` until the next event for that branch arrived.
