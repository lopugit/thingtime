# Thingtime Cloudflare API Worker

Phase 2 of [`PLAN/cloudflare-workers-migration.md`](../../PLAN/cloudflare-workers-migration.md).
It serves the Thingtime API endpoints that are marked for Cloudflare, using the
**same handler files and the same request pipeline as Vercel**. Nothing is
reimplemented here.

## How an endpoint gets onto Cloudflare

1. **Mark it in the registry.** In `remix/app/docs/apiDocs.ts`, add a
   `cloudflare` entry to the endpoint's doc:

   ```ts
   cloudflare: { featureVersion: '1.0.0', methods: ['GET'] },
   ```

   `endpoint()` then adds a "Cloudflare deployment" note to the docs.
   `featureVersion` versions the Cloudflare build of `api.<id>` in this
   Worker's capability manifest. `methods` lists what Cloudflare serves; any
   other method stays on Vercel.
2. **Generate the route list.** Run `npm run generate`. It writes
   `src/routes.generated.ts`, taking each handler's path from Nitro's route map
   (`remix/server/routes/api/[...].ts`). `npm run check` and `npm test` fail if
   the generated file is out of date.
3. **Check it runs on Workers.** Run `npm run dev` with a local `.dev.vars`, or
   deploy and use the router test path. A handler that pulls in a native module
   (`bcrypt`, `sharp`, `@napi-rs/canvas`, `@resvg/resvg-js`) cannot run here;
   leave it on Vercel.

What runs on both runtimes, shared rather than copied:

- **Handlers:** `remix/app/routes/api/**`.
- **Request pipeline:** data plane, signed-in user checks, scheduled requests,
  error logs and connection telemetry, in
  `remix/app/api/utils/http/routeExecution.ts`. Nitro's
  `server/routes/api/[...].ts` calls the same function.
- **MongoDB access:** `remix/app/api/utils/mongodb/collections.ts`, with its
  per-runtime connection state in `runtimeState.ts`.

## MongoDB connections: a fixed pool of shards

Workers cannot reuse a socket across requests, and a connection per request
would grow with traffic until it hit Atlas's connection limit. Instead, every
request runs inside one of `POOL_SHARDS` Durable Objects (`MongoPoolShard`),
placed in Oceania near the Sydney cluster. Each shard:

- keeps its own MongoDB client between requests, using `withMongoRuntimeState`;
- spreads requests randomly across the shards;
- closes its client after 60 s without requests, so an idle shard stops billing.

Total connections are about `POOL_SHARDS × (pool size + monitoring sockets)`
whatever the traffic. With 2 shards and the home pool's 10-connection cap that
is under 30, against Atlas's 500. To serve more traffic, raise `POOL_SHARDS`.

## Routing and fallback

The router (`cloudflare/router`) reaches this Worker through a service binding.
This Worker has no public route.

- **What goes to Cloudflare:** for a route group set to `worker`, the router
  sends an endpoint here only if this Worker's manifest
  (`/__cf/api/manifest`) lists that path and method. Everything else goes to
  Vercel.
- **Fallback:** unlisted paths and methods answer 421 with
  `x-thingtime-fallback: vercel`. The router replays a refused or failed GET on
  Vercel.
- **Vercel-only deployments:** unchanged. Without the router, nothing here is
  used.

## Deploy

```bash
corepack pnpm@10.12.1 install
npm test && npm run check
CLOUDFLARE_API_TOKEN=... npx wrangler deploy   # unset CF_API_KEY / CF_API_EMAIL first
```

Secrets are `MONGODB_CONNECTION_STRING` and `MONGO_PASS`, set with
`wrangler secret put`. They are the same values as the Vercel production
variables. Never pass them as arguments.
