# Cloudflare Workers migration

Status: proposed (2026-11-27). Builds on the [hosting options
note](../NOTES/hosting-options-2026-11-26.md) and the [Vercel memory
plan](./vercel-memory-and-ci-webhooks.md).

## Why

Vercel Fluid bills 2 GB of memory for every second a request is open,
including time spent waiting on MongoDB. That floor cannot be lowered: there
is no size below 2 GB, the Edge runtime uses the same pricing, and a measured
Edge test was billed at 2.06 GB. Cloudflare Workers bill CPU time only.
Waiting on network requests "does not count toward CPU time". Workers Paid is
$5 a month and includes 10M requests and 30M CPU-ms. Static asset requests are
free, with no egress charges.

## Evidence (27 Nov 2026)

- **MongoDB on Workers works.** A minimal Worker (`nodejs_compat`, `mongodb`
  6.21.0, the app's version) ran in `workerd` through `wrangler dev`. It
  connected to production Atlas over `mongodb+srv`, including SRV DNS, TLS and
  SCRAM authentication. Three of three requests succeeded with read-only
  commands. Timings from a Melbourne laptop: connect 226–320 ms; ping, count and
  `findOne` 16–19 ms each. Neither MongoDB nor Cloudflare documents official
  support, so production needs a soak test.
- **Connections cannot be shared across requests.** Cloudflare: "TCP sockets
  cannot be created in global scope and shared across requests." Expect one
  connection per request (an in-region connect is likely ~50–100 ms) or one
  pooled connection held by a Durable Object. A Durable Object's socket keeps it
  billed for up to 15 minutes per connection. Hyperdrive supports only Postgres
  and MySQL.
- **Our Nitro app does not build for Workers yet.** `NITRO_PRESET=cloudflare_module
  nitro build` fails on native modules. The server bundle pulls in `bcrypt`,
  `sharp`, `@napi-rs/canvas`, `@resvg/resvg-js` and `cbor-extract`, and the
  ImageMagick WASM module fails to parse with `Unexpected instruction: 0xfc02`.
- **Limits that matter:** 128 MB memory per isolate. CPU is 30 s by default and
  up to 5 min. Six simultaneous outgoing connections waiting for headers. Request
  bodies up to 100 MB on Cloudflare Free/Pro zones. Outbound TCP does not come
  from Cloudflare's published IP ranges, so Atlas needs the same open access
  list it already allows for Vercel.
- **Account access:** thingtime.com is served by Cloudflare (nameservers
  `katja`/`anderson.ns.cloudflare.com`). The API key on the agent machine
  reaches a different Cloudflare account with no zones. A scoped token for the
  thingtime.com account is needed.

## Target architecture

```
browser ──► Cloudflare (thingtime.com)
              │
              ├─ static SPA, assets ─────────► Workers static assets (free)
              │
              └─ /api/*  router Worker ──► route table (KV, cached ~30 s)
                      │                  per route group: cloudflare | node | %
                      ├─► api Worker (Nitro cloudflare_module build)
                      │      MongoDB per request, crons as Cron Triggers
                      ├─► Durable Objects: chats/updates, sync-control,
                      │      device commands (WebSocket hibernation)
                      └─► Node origin (images, social cards, PDF, archives,
                             large jobs): Vercel today, a Sydney container later
```

- **Two live stacks, one codebase.** Every `main` commit builds both the
  Vercel output and a Cloudflare Worker from the same source. Native-only
  modules are aliased to stubs in the Cloudflare build, and those routes go to
  the Node origin.
- **One-click switching.** The router Worker reads a route table, such as
  `{ "auth": "cloudflare", "things": "cloudflare", "images": "node", "*": "node" }`.
  An Admin → Infrastructure switch, or a CLI, flips a group or everything.
  Rollback is flipping it back, with no deploy. The router sends a group to
  Cloudflare only while that origin's capability manifest satisfies the
  route's feature version, reusing the existing `/.well-known/thingtime-capabilities.json`
  negotiation.
- **Database access.** In the Worker build the MongoDB client uses a pool of
  1, opened and closed per request, with no `attachDatabasePool` and no
  gateway pool draining. A Durable Object connection holder is an optional
  later optimisation if connect latency shows up in P75.
- **Configuration.** Keep the existing vault model. Workers secrets hold only
  the bootstrap values needed to reach the vault, mirroring the minimal
  Vercel-variable rule.

## Phases

| Phase | Work | Done when | Rough effort |
|---|---|---|---|
| P0 | Spike: MongoDB driver in `workerd` | Done 27 Nov (above) | — |
| P1 | Router Worker on thingtime.com: serves the SPA from static assets and passes every `/api/*` to Vercel unchanged | Site served through the router with no API change; Vercel CDN requests drop | 1–2 days |
| P2 | Nitro `cloudflare_module` build: `bcrypt` → `bcryptjs` (same `$2b$` hashes), node-only stubs for image/social-card/PDF modules, per-request Mongo mode, CI deploy to a staging `*.workers.dev`, API test suite green against it | Staging passes `test:api` and capability checks | 3–5 days |
| P3 | Shift hot read routes (auth/me, root-data, things, notifications, timeline) with the route table and watch errors, P75 and CPU-ms | A week at parity, one-click rollback tested | 1–2 weeks with soak |
| P4 | Long-polls → Durable Objects with WebSocket hibernation; crons → Cron Triggers; CI webhooks → tiny Worker or off | No long-held requests on Node | ~1 week |
| P5 | Node-only routes → a Sydney container (Fly.io `syd`, or Cloudflare Containers once priced and tested); drop Vercel Pro or keep it only for previews | Vercel usage ≈ 0 | 2–3 days |

## Cost estimate (USD per month, list prices)

| Setup | Today's traffic | ~2,000 users | ~20,000 users |
|---|---|---|---|
| Vercel Pro, after the Nov fixes | ~$25–35 (estimate: $20 seat + usage) | ~$76 | ~$759 |
| Cloudflare Workers + Node origin on Vercel Pro | ~$25–30 | ~$30 | ~$110 |
| Cloudflare Workers + Fly.io container | ~$10–15 | ~$20 | ~$100–130 |

Database (Atlas) costs are separate and the same in every setup. Figures beyond
today use the hosting note's per-user model (3,757 calls per user per month,
40 ms CPU per call). The included 10M requests last to about 2,600 users. The
included 30M CPU-ms run out around 200 users at 40 ms per call, after which CPU
costs $0.02 per million ms: about $5 extra at 2,000 users and $60 at 20,000.
The saving now is mostly the $20 Vercel seat; at scale it is the difference
between per-second memory billing and CPU-only billing.

## Risks and stop conditions

- **No official MongoDB support on Workers:** a driver or runtime update could
  break it. Keep the Node origin able to take every route back, so a rollback
  is one switch. Stop if a week of P3 shows errors above Vercel's.
- **Per-request connect latency:** if P75 rises more than ~100 ms on shifted
  routes, add the Durable Object connection holder before shifting more.
- **128 MB memory:** big lists, archives and imports stay on Node.
- **Two stacks to keep in step:** capability negotiation guards mismatched
  versions, and both builds come from the same commit.

## Owner prerequisites

1. A Cloudflare API token for the account that holds thingtime.com, scoped to
   Workers Scripts Edit, Workers Routes Edit (zone), Workers KV Edit and Account
   Settings Read. Store it in the vault; it never goes in chat.
2. Workers Paid ($5 a month) on that account.
3. A choice of host for Node-only routes: Vercel for now, Fly.io later, or
   Cloudflare Containers after a priced test.
