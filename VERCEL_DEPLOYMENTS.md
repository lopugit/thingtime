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
  `THINGTIME_PRIVATE_S3_REGION` are scoped to Production only. Preview branches
  intentionally cannot assume this role or upload to the production bucket; a
  future preview attachment environment needs its own role, bucket, and CORS
  origin.
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

## Preview

- Generated preview URLs use `https://thingtime-<generated>-lopugits-projects.vercel.app`.
- The `develop` branch alias is
  https://thingtime-git-develop-lopugits-projects.vercel.app.
- https://dev.thingtime.com is configured as a branch-specific Preview domain
  that tracks `develop`. This deliberately preserves the existing
  `develop`-scoped Preview environment variables; Vercel's built-in
  Development environment remains local/CLI-only.
  - Cloudflare DNS: `CNAME dev` to
    `b45b7349d6eb9c18.vercel-dns-017.com`, DNS only, TTL Auto.
  - If Vercel reports a pending ownership challenge, publish the exact
    `_vercel` TXT value returned by the Vercel project-domain inspector; do
    not record the rotating verification value in this repository.
  - Vercel assignment was configured on 2026-08-07. DNS, ownership
    verification, and TLS remain pending until the Cloudflare records are
    published.
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
