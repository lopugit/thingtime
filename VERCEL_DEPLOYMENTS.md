# Vercel Deployments

Last updated: 2026-07-02

## Project

- Vercel project: https://vercel.com/lopugits-projects/thingtime
- Project name: `thingtime`
- Project id: `prj_ZAX9FhGC2alHMXMwTHX96ql3EQ8v`
- GitHub repository: `lopugit/thingtime`

## Production

- Production alias: https://thingtime-lopugits-projects.vercel.app
- Main branch alias: https://thingtime-git-main-lopugits-projects.vercel.app
- Production branch: `main`

## Deployment status webhook (TODO 5)

- `POST /api/v1/vercel/webhook` records deployment lifecycle events
  (created/succeeded/promoted/error/canceled) per branch in the `settings`
  collection; `/api/v1/vercel/status` serves that persisted status and only
  polls the Vercel API while a build is actively running (or when no webhook
  event exists yet for the branch).
- The endpoint is disabled (404) until `VERCEL_WEBHOOK_SECRET` is set;
  deliveries are verified against `x-vercel-signature` (HMAC-SHA1 of the raw
  body).
- One-time activation (owner-run; creating the webhook is a standing account
  config change): `VERCEL_API_TOKEN=… node remix/scripts/vercel/create-webhook.mjs
  https://thingtime-lopugits-projects.vercel.app/api/v1/vercel/webhook`, then
  set the printed `VERCEL_WEBHOOK_SECRET` in the Vercel project env and
  redeploy. Never commit the secret.

## Preview

- Generated preview URLs use `https://thingtime-<generated>-lopugits-projects.vercel.app`.
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
