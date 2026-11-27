# thingtime.com router Worker

Phase 1 of [`PLAN/cloudflare-workers-migration.md`](../../PLAN/cloudflare-workers-migration.md).
A Cloudflare Worker that sends each route group of thingtime.com to a backend
chosen in a route table:

- `vercel` passes the request through to the existing Vercel origin unchanged.
- `worker` sends it to the Cloudflare API Worker. That Worker is bound as
  `API_WORKER` once it exists (phase 2). Until then, `worker` routes fall back
  to Vercel and are labelled `vercel (worker unavailable)`.

Any router error also falls back to passing the request through, so the router
can add a path but never take the site down by itself. Every routed response
carries `x-thingtime-route: <group>; <backend>`.

## What is live

- **Account and zone:** the Cloudflare account that holds `thingtime.com`
  (account id in `wrangler.toml`). Workers Paid is active.
- **Route:** `thingtime.com/__cf/*` only. Normal traffic does not touch the
  Worker yet.
  - `/__cf/health` shows router status and the active table. It carries no
    secrets.
  - `/__cf/route?path=/api/v1/things` shows which group and backend a path
    resolves to.
  - `/__cf/via/<path>` routes `<path>` exactly as live traffic would, on the
    real domain with your cookies. For example `/__cf/via/api/v1/teapot` should
    answer 418 with `x-thingtime-route: api; vercel`.
- **Route table:** KV namespace `thingtime-router-routes`, key `route-table`.
  Until it is written, the built-in default sends everything to Vercel.

## One-click switching

```bash
export CLOUDFLARE_API_TOKEN=...   # from the vault; never pass it as an argument
node scripts/routes.mjs show
node scripts/routes.mjs set things worker   # one group
node scripts/routes.mjs set '*' vercel      # everything back to Vercel
node scripts/routes.mjs reset               # restore the default table
```

A switch is live everywhere within about 90 s: KV propagation plus the router's
30 s cache. Rollback is the same command with the previous backend; no deploy
is needed. Groups and their prefixes are in `src/routeTable.js`; the longest
matching prefix wins.

## Putting live traffic through the router (the production switch)

Not done yet. When the API Worker exists and its staging run passes:

1. Change the route in `wrangler.toml` to `thingtime.com/*`.
2. Deploy with `npx wrangler deploy`.
3. Watch `x-thingtime-route` headers and Vercel and Cloudflare error rates.

To undo it, put the route back to `/__cf/*` and redeploy, or delete the route in
the Cloudflare dashboard. Traffic then goes straight to Vercel again.

## Develop and deploy

```bash
corepack pnpm@10.12.1 install
npm test                                      # node --test, no network
CLOUDFLARE_API_TOKEN=... npx wrangler deploy  # unset CF_API_KEY / CF_API_EMAIL first: wrangler prefers them
```

The token is the vault entry `THINGTIME_ADMIN_CLOUDFLARE_PROD_ALL_PERMISSIONS_READ_WRITE`
in the owner's Secure Vault (Thingtime environment). Keep it out of chat, logs
and files in the repo.
