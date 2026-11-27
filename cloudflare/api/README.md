# Thingtime Cloudflare API Worker

Phase 2 of [`PLAN/cloudflare-workers-migration.md`](../../PLAN/cloudflare-workers-migration.md).
It serves the Thingtime API endpoints that are marked for Cloudflare, using the
**same handler files and the same request pipeline as Vercel**. Nothing is
reimplemented here.

## How an endpoint gets onto Cloudflare

1. **Mark it in the registry.** In `remix/app/docs/apiDocs.ts`, add a
   `cloudflare` entry to the endpoint's doc:

   ```ts
   cloudflare: { methods: ['GET'] },                    // reads a session: needs the JWT keys
   cloudflare: { methods: ['GET'], sessionFree: true }, // never reads a session or token
   ```

   - `endpoint()` adds a "Cloudflare deployment" note to the docs.
   - The Cloudflare manifest reports the endpoint's own version, since it is the
     same code. Add `featureVersion` only if the Cloudflare build must differ.
   - `methods` lists what Cloudflare serves; any other method stays on Vercel.
   - Mark `sessionFree: true` only when the handler and everything it calls
     never read the auth cookie, a bearer token or account hints. For example,
     `auth/account-hints` reads sessions even though its doc says
     `auth: none`.
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

## When the Worker serves a route

`runtimeReadyFor()` in `src/serve.ts` decides this per route:

- **Production mode always.** `NODE_ENV = "production"` is set in
  `wrangler.toml`. In any other mode the shared auth code falls back to a public
  development signing secret, and sessions could be forged.
- **A database:** `MONGODB_CONNECTION_STRING` must be present.
- **Signing keys, unless `sessionFree`:** the same `JWT_PUBLIC_KEY`,
  `JWT_PRIVATE_KEY`, `JWT_KEY_ID`, `JWT_ISSUER` and legacy `JWT_SECRET` as Vercel
  production. Vercel stores these as *sensitive*, so they cannot be read back
  and copied automatically; the owner adds them with `wrangler secret put`.

A route that isn't ready answers 421 with
`x-thingtime-fallback-reason: runtime-not-configured`, and the router replays a
GET on Vercel. Today `automation/switches` is served. `auth/me`,
`auth/account-hints` and `marketing/publications` are marked, but go to Vercel
until the JWT secrets are added.

## Not on Cloudflare yet

`things`, `notifications`, `timeline`, `devices`, `chats/updates` and
`webpages/resolve` all build for Workers, but are not marked yet:

- **Signed-in check first.** Each needs a parity check with a real signed-in
  session through `/__cf/via/…` once the JWT secrets are set.
- **Attachment links.** Anything that signs S3 links needs AWS credentials for
  Cloudflare. Vercel gets them through its OIDC identity, which Workers don't
  have.

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
