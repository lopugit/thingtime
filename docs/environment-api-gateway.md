# Environment API gateways and index lifecycle

The environment gateway is an HTTP API proxy, not a MongoDB wire-protocol
proxy. Each deployment selects a server-only MongoDB connection mode:
`proxy` forwards database-backed HTTP operations to the configured canonical
environment alias, while `dedicated` runs its own HTTP handlers against that
deployment's configured MongoDB connection and owns its MongoDB pools. No raw
database RPC is exposed.
Existing request handlers still enforce authentication, revocation, Character,
ACL, quota and selected custom-data-endpoint boundaries.

## Configuration and environment partitioning

Set these **server-only** values separately for each intended environment:

```sh
THINGTIME_GATEWAY_ENVIRONMENT="preview"
THINGTIME_GATEWAY_ORIGIN="https://preview.example.test"
THINGTIME_GATEWAY_SECRET="<separate-random-secret-at-least-32-characters>"
# Vercel supplies VERCEL_DEPLOYMENT_ID / VERCEL_URL. Other runtimes must supply:
THINGTIME_GATEWAY_DEPLOYMENT_ID="<unique-runtime-deployment-id>"
# Additional exact frontend origins, comma separated; never wildcard domains:
THINGTIME_GATEWAY_SOURCE_ORIGINS="https://branch.example.test"
```

Do not infer the data plane from `NODE_ENV`: deployed previews use production
mode too. Preserve existing `THINGTIME_DATA_ENV`, federation and
database/authentication assignments; moving a deployment to another gateway is
a data-authority decision, not a new database or an implicit database
migration. A custom Vercel target or a preview of a development branch may need
a different assignment from a main-target preview. Never reuse a production
relay secret to give a development backend production authority. The gateway
owner retains its normal MongoDB, signing, encryption, email, cron and
integration configuration. Proxy followers do not need MongoDB or
authentication-signing credentials for forwarded HTTP work.

### Select the connection mode

The server-only `THINGTIME_MONGODB_CONNECTION_MODE` runtime setting overrides
the bundled branch policy when it is set. Use `dedicated` to run this
deployment's own handlers and MongoDB pools, or `proxy` to route database-backed
HTTP operations through its canonical environment alias:

```sh
THINGTIME_MONGODB_CONNECTION_MODE=dedicated
# Or:
THINGTIME_MONGODB_CONNECTION_MODE=proxy
```

Without the runtime override, the build-bundled
`mongoConnectionPolicy` in `remix/app/api/utils/deployment/mongoConnectionPolicy.ts`
sets the mode. To make dedicated mode the branch default, change its exported
constant before building:

```ts
export const mongoConnectionPolicy: 'proxy' | 'dedicated' = 'dedicated';
```

The choice is captured in the Nitro bundle; changing it requires a redeploy.
Restore the constant to `proxy` before promoting that branch as the environment
gateway owner. Neither setting can be selected by a request or browser flag.

Both `proxy` and `dedicated` Vercel deployments require complete canonical
gateway settings: environment, HTTPS alias, and secret, plus a deployment
identity (Vercel supplies one). Missing or partial settings, unknown runtime
modes, invalid aliases, and environment mismatches fail closed. In configured
dedicated mode, the deployment validates its canonical alias/environment but
does not relay requests; its advertised `gateway: null` makes a proxy worker
pointed at it fail closed. Dedicated deployments can still use the same
configured environment database, so separate connection pools do not establish
database isolation.
Local and self-hosted runtimes with no gateway settings retain direct-connection
behavior unless proxy mode is explicitly requested. Desktop endpoint selection
stays separate, and gateway settings are rejected in the desktop shell. HTTPS is
mandatory; HTTP loopback is permitted only in the explicit Node test fixture.

`/.well-known/thingtime-capabilities.json` publishes `api.environment-gateway`
1.1.0 and an optional `gateway` descriptor containing only environment, stable
origin and deployment identity. This metadata is private/no-store to prevent a
CDN pinning the previous alias owner. Discovery itself neither authenticates an
agent nor grants access to private Things.

## Requests, promotion and rollback

Each worker resolves its configured alias with a credential-free, bounded,
redirect-refusing manifest request. Only the matching deployment identity may
open its MongoDB client. Ownership caches for at most five seconds; errors,
missing capabilities, different environments and changed origins fail closed.
There is no stale-on-error database fallback. Requests also negotiate the
specific semantic feature version and advertised path/method before forwarding.
A branch with a newer or incompatible API must wait for its environment gateway
to support that API; a preview therefore runs its own frontend against the
canonical environment backend, not its branch-specific backend implementation.

Relays preserve method, query, body stream, authentication/cookie, Character,
selected-data-plane and expected-actor headers. A short-lived, environment-bound
HMAC authenticates one hop, original URL and relevant credential/origin headers.
TLS protects the streamed body without buffering large uploads. The receiver
reconstructs the original URL and forwarded origin before authentication or
OAuth/CSRF checks, retaining srvx runtime/waitUntil transport hooks. Cookie
security attributes, host-only semantics and redirect Location are preserved;
no redirect is followed with credentials. Cookie-authenticated browser mutations
from a cross-site Origin are refused. A relay signature never substitutes for
a normal user/service credential. Mutations are never retried after ambiguous
transport failure; the caller must reconcile its ordinary operation receipt.

The ingress covers API/root data, public cards, sitemap and other registered
dynamic discovery routes. Configured gateways skip eager startup warmup entirely: a manifest request must
never spawn another cold-start discovery chain. Static assets and each branch's SPA shell stay local;
follower shells use generic social metadata, while public card and API reads
use the gateway. Custom Mongo endpoints are resolved and validated by the
existing gateway handler, retaining their separate data/control planes.

Promotion changes the stable alias. New requests move after the bounded
ownership cache expires. Previously admitted requests, streams, notifications
and Lopu waitUntil work may finish on the previous deployment. Its pools drain
only after those lifetimes end; new owner work waits for close and cache eviction
before reopening a pool if a rollback promotes it again. Multiple warm gateway
instances still have separate pools and monitoring sockets. This selects one
deployment, **not one process or socket**, and does not change the Atlas tier.

## PR996 branch compatibility

PR996 carries the merged `api.passwords` 1.4.0 contract. Every forwarded password
operation requires that version, its exact registered path and HTTP method;
compatible newer 1.x capabilities are accepted, while missing, older 1.x and
breaking-major capabilities fail before body or credential forwarding. The branch retains the newer 1.1.0 gateway policy and
its default proxy mode; dedicated mode is not an OAuth or acceptance workaround.

## Rollout and environment mapping

The intended mapping separates the logical gateway environment from Vercel's
credential target:

| Deployment | Source | Vercel credential target | Gateway environment and origin | Database |
| --- | --- | --- | --- | --- |
| Production owner | Current `main` | Production | `production` / `https://thingtime.com` | Production |
| Preview master owner | Current `main`, separately built for preview | Standard preview | `preview` / `https://master.previews.thingtime.com` | Development |
| Ordinary PR preview | Exact PR head | Existing custom develop target | `preview` / `https://master.previews.thingtime.com` | Development |
| Develop owner | Current `develop` | Custom develop | `develop` / `https://dev.thingtime.com` | Development |

Ordinary PR deployments retain their existing Vercel credential scope. The
protected publisher overrides only their gateway environment, origin and relay
secret, using the exact preview-scoped secret. It does not copy all standard
preview settings onto PR code: the two targets contain different sensitive
settings. The historical `pr-N.previews.dev.thingtime.com` alias naming does not
select the backend; the explicit gateway configuration does. Dedicated PRs
retain that same credential target and run their own handlers against its
configured development database.

The latest configuration audit confirmed that custom develop and previews use
the same development cluster, separate from production. Earlier rollout notes
predated provisioning of the master preview alias. Verify its current
origin-scoped manifest and API behavior before treating the 1.1.0 policy as
deployed; alias existence and local source integration do not establish
acceptance of that contract, and gateway activation across these origins
remains pending. Do not treat the intended mapping as proof of live gateway
operation.
Preserve existing data/authentication assignments unless an explicit data
migration is authorized.

Deploy the selected gateway implementation before enabling proxy followers.
Configure exact additional source origins as needed and verify the public
manifest and real API paths on each intended alias. Promotion moves new
requests after the bounded ownership cache expires. Already admitted requests,
streams, notifications and Lopu waitUntil work can finish on the previous
deployment; its pools drain after that work ends. Old preview deployments can
age out naturally. Do not claim that an alias move instantly closes every pool,
fences the whole fleet, or proves fleet-wide MongoDB enforcement. No mandatory
old-preview credential retirement is part of this rollout checklist.

## Index readiness

MongoDB matching `createIndex` commands are already idempotent and do not rebuild
unchanged physical indexes. The lifecycle avoids repeated command fanout: it
fingerprints the physical plan, uses a durable ready record and a fenced shared
lease in the versioned settings collection, and limits DDL to two concurrent
commands, serially within a collection. A ready marker is written only after
all required commands succeed. Failures and expired leases remain retryable.
Read-only authentication does not wait for DDL. Each mutating request validates
the durable readiness receipt once, shared by its admitted descendants.
Unique/security-constrained writes wait for readiness; authentication reads and
the narrowly authenticated admin repair flow remain available when a plan fails.
Explicit index rebuilds use the same coordination boundary. A foreign custom
database gets awaited, bounded, process-local data-index setup without new home
control-plane settings documents.

Manual DDL, partial database restores or external index changes require explicit
invalidation/revalidation; a readiness receipt is not continuous index auditing.
Never remove unique/security constraints to make startup appear healthy. Review
the lifecycle tests and admin migration recovery checks before changing the plan.

## Verification

```sh
npm --prefix remix run test:environment-gateway
npm --prefix remix run test:collections
npm --prefix remix run test:api-capabilities
NITRO_PRESET=node-server npm --prefix remix run build:server
node remix/scripts/environment-gateway-acceptance.mjs
```

The built transport runner requires macOS sandbox-exec and local mongod. It
creates disposable API identities and a temporary replica set on 19771–19776,
proves direct-IP outbound denial, uses separate synthetic signing credentials
on the follower, verifies cookie-authenticated writes and promotion/rollback,
and counts any forbidden follower MongoDB dial. It fails on occupied ports and
removes its own processes and temporary data. It does not use production data
or credentials and does not expose a public dev server.

## Promotion procedure

Use the intended mapping and pending-activation status above. Do not select an
arbitrary PR deployment as the shared preview backend or treat staging/wildcard
aliases as acceptance evidence. Build the gateway from the intended integration
branch, run contract and real API acceptance, then promote that immutable
deployment to its stable environment alias. Keep its previous immutable
identity for rollback. Dedicated deployments can still use a shared environment
database; independent gateway identities do not create database isolation.

The protected prebuilt publisher lives on the canonical `github-actions`
controller branch. A fork using this workflow must allow that exact protected
branch in the `vercel-prebuilt-control` GitHub environment's deployment branch
policies, alongside the existing intended callers. Preserve its reviewers,
protection mode and other restrictions; do not allow arbitrary branch patterns
to make a dispatch pass. A `build_only` dispatch creates separate artifacts for
production and the preview master without publishing either. Verify the
controller commit, source commit, target and artifact digest before bootstrap.
The publisher forces canonical owners to `proxy`; keep the connection mode
unset at project scope so each ordinary branch can use its bundled opt-in.

For new deployments, scope Mongo credentials according to the selected
connection mode and environment. Changing credentials on existing previews is
an optional, separately assessed rollout choice; it is not required to finish
this code change. Immutable deployments built before the gateway implementation
do not learn its behavior from new environment variables. A deployment may
continue using its already configured connection until its work and pools end;
record observed status rather than claiming all old code is fenced. Strong
enforcement across arbitrary code requires platform-level credential/network
separation, potentially a dedicated backend project.

For a first gateway activation, an audited legacy deployment can retain its
in-flight work. Verify its immutable source has no active gateway settings,
that Workflow steps invoke the original deployment's local handlers, and that
the selected database, public origin and task scope stay unchanged. Preserve
that deployment, its credentials, executor acknowledgments and shared
conversation locks. In this case moving the alias does not fence or cancel the
legacy callbacks. Public task counts cannot prove zero reservations, and old
deployments can still hold direct MongoDB connections. Record the old deployment
and source identities and this acceptance boundary before activation. Stop if
the old owner has gateway settings or any of those assumptions cannot be verified.

Before promoting a replacement for an already configured gateway owner,
negotiate `api.lopu-background-tasks` 1.3.2 and inspect
authenticated `GET /api/v1/lopu/tasks` for running server-managed roots and
reservations. This is account/data-scope bounded, not a global fleet census.
Drain those continuations or stop them through the normal owned-task control
and wait for worker acknowledgments. Do not proxy private Workflow callback
paths across builds. Newly admitted roots record their gateway deployment; after
promotion, deployment-pinned callbacks refuse DB access. An authenticated task
read at the current gateway reconciles expired prior-deployment roots through
the existing finalizer into needs-attention, retaining locks for unacknowledged
executors and preserving saved output. It never automatically replays uncertain
provider/tool actions. Pre-feature roots have no deployment tag and require
explicit preflight/reconciliation; do not silently strand accepted workflows.

## Supervised long index maintenance

Normal DDL commands allow 15 seconds, use a five-minute renewable lease and a
two-minute bounded contender wait. For a legitimately long build, an operator
can run the canonical API utility with a longer bounded policy from `remix/`:

```sh
node --env-file-if-exists=.env --import tsx app/api/utils/mongodb/indexMaintenance.mts --command-timeout-ms 180000 --lease-ms 600000
```

It retains gateway ownership, canonical home configuration, the shared lease
and required constraints while forcing readiness revalidation. MongoDB processes
`maxTimeMS` termination at interrupt points; timeout/transport failure is not
proof that an already submitted server operation stopped instantaneously.
Fencing and bounded commands reduce overlap risk but are not an absolute
distributed cancellation guarantee. Preserve failed/unknown readiness and
reconcile server state before retrying.

## PR996 merge verification — 26 October 2026

The local reconciliation with develop `cd6f8b8abc94270980bac216da2412ffef8578b1`
keeps proxy mode as this branch default and preserves password contract 1.2.1.
The test runner supports `THINGTIME_GATEWAY_ACCEPTANCE_PORT_BASE` as a bounded
integer selecting ten fixed loopback ports (default 19771–19780). It checks all
ports before spawning any test process, and its OS policy restricts every
backend to those local ports. Dedicated acceptance uses a separate disposable
replica rather than a deployed opt-out. This override belongs only to the test
runner and does not change product routing or network policy.
