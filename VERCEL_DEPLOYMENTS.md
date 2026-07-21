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
  `GET /api/v1/vercel/status` serves ready/error/canceled straight from that
  document (zero Vercel API calls); building/queued states still use the live
  Vercel API for phase/progress detail.
