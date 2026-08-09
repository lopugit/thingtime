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
- Private post attachments use Vercel OIDC to assume the AWS role named
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
- Stable origin: https://dev.thingtime.com. The domain is verified and assigned
  directly to the `develop` Custom Environment; it no longer uses a generic
  branch-Preview domain assignment.
- Stable environment alias:
  https://thingtime-env-develop-lopugits-projects.vercel.app.
- Private attachments use a dedicated develop bucket and IAM role. The role
  trusts only the exact Vercel OIDC subject
  `owner:lopugits-projects:project:thingtime:environment:develop`; ordinary PR
  tokens remain `environment:preview` and cannot assume it. The develop
  bucket's CORS allowlist contains only `https://dev.thingtime.com`.
- `THINGTIME_PRIVATE_S3_ROLE_ARN`, `THINGTIME_PRIVATE_S3_BUCKET`,
  `THINGTIME_PRIVATE_S3_REGION`, and a distinct `CRON_SECRET` are Sensitive and
  scoped only to this Custom Environment. Generic Preview and Production do not
  inherit the develop values.
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
- Feature branches remain in the generic Preview environment. They do not
  receive either Production or develop S3 variables and their shared
  `environment:preview` OIDC subject is not trusted by either attachment role.
- The `staging` branch alias is https://thingtime-git-staging-lopugits-projects.vercel.app.
- For feature branches, use the Vercel PR status URL or deployment URL from
  the GitHub PR checks.

## Verified PR Previews

- PR #24, branch `codex/migrate-remix-to-nitro`, commit
  `b8e14222184706bfef101e3dedace793ffa2d198`:
  https://thingtime-qsxzsqb4h-lopugits-projects.vercel.app
  - Deployment id: `dpl_Z6ER3iuXGXQrzeTN6K45YTUSK69j`
  - Verified routes: `/`, `/index.html`, `/vercel`, `/api/root-data`,
    `/api/v1/vercel/deployments`, and `/assets/index-yPU6cX3C.js`.
