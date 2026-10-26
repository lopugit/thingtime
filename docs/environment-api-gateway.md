# Environment API gateways and index lifecycle

The gateway is an explicit server configuration. Each environment chooses one
stable HTTPS alias. The deployment currently served by that alias executes
database-backed HTTP operations; other configured deployments forward those
operations to it. No raw database RPC is exposed. Existing request handlers
still enforce authentication, revocation, Character, ACL, quota and selected
custom-data-endpoint boundaries.

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

Production, development and previews each need their own explicitly selected
alias, environment identifier and relay secret. Do not infer the data plane
from `NODE_ENV`: deployed previews use production mode too. Preserve existing
`THINGTIME_DATA_ENV`, federation and database/authentication assignments; moving
a deployment to another gateway is a data-authority decision, not a new database
or an implicit database migration. A custom Vercel target or a preview of a
development branch may need a different assignment from a main-target preview.
Never reuse a production relay secret to give a development backend production
authority. The gateway owner retains its normal MongoDB, signing, encryption,
email, cron and integration configuration. Followers do not need MongoDB or
authentication-signing credentials for forwarded HTTP work.

No settings means the existing self-hosted mode remains available. Partial or
malformed settings fail closed. Desktop endpoint selection stays separate;
gateway configuration is rejected in the desktop shell. HTTPS is mandatory;
HTTP loopback is permitted only in the explicit Node test fixture.

`/.well-known/thingtime-capabilities.json` publishes `api.environment-gateway`
1.0.1 (minimum negotiated version 1.0.0) and an optional `gateway` descriptor containing only environment, stable
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

## Connections major2 rollout

PR992 deliberately requires major version 2 for `api.connections`,
`api.connections-providers`, `api.connections-feed`, `api.connections-oauth-begin`,
`api.connections-oauth-callback` and `api.connections-request`. Missing or major1
backend contracts fail closed before forwarding credentials or consuming the
request body; matching major2 still requires the advertised path and method.
Never downgrade these requirements or opt out of the gateway to make a preview
appear accepted. The current preview master advertises Connections 1.0.0; that
refusal is an expected compatibility gate and is not end-to-end completion.

Deploy and verify a canonical environment backend implementing Connections 2
before promoting it to the stable environment gateway and enabling dependent
follower actions. Preserve the previous immutable gateway for assessed rollback.
The frontend callback remains the exact frontend origin, never the gateway
origin. Each gateway-owned `connections-*-oauth` vault bundle must contain that
exact frontend origin under `environments[getDeploymentDataEnvironment().id]`.
The gateway environment label (for example `preview`) is not a substitute for
the actual data-environment ID (which may be `development` or a custom ID).
Register each exact callback with the provider. Old env-only clients and
unbound saved grants must reconnect through the major2 flow; never copy secrets
between origins/environments or widen a network boundary as recovery.

## Required rollout boundaries

Deploy this implementation to each selected gateway first, verify the public
manifest, then enable its environment configuration and redeploy followers.
Configure exact additional source origins as needed. Verify real registration,
cookie/Bearer sessions, custom data selection, callbacks, streams and cron
authorization on each intended alias. Promote and roll back once before treating
the deployment control as accepted.

Immutable deployments built before this implementation do not obey new gateway
variables. Existing warm pools and already running work also cannot be revoked
instantaneously by an alias change. Retire, restrict, replace or redeploy those
old deployments through supported platform controls; remove their direct DB
access only with an assessed credential/network rollout. Project routing changes
alone do not stop their startup/background code. Implementation tests do not
prove fleet-wide MongoDB enforcement. Keep the prior working deployment and
configuration available until the chosen environment passes acceptance.

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
# Connections2 built runtime, synthetic provider/vault adapters, real API storage:
THINGTIME_GATEWAY_ACCEPTANCE_CONNECTIONS=1 node remix/scripts/environment-gateway-acceptance.mjs
```

The built transport runner requires macOS sandbox-exec and local mongod. It
creates disposable API identities and a temporary replica set on 19771–19778,
proves direct-IP outbound denial, uses separate synthetic signing credentials
on the follower, verifies cookie-authenticated writes and promotion/rollback,
and counts any forbidden follower MongoDB dial. It fails on occupied ports and
removes its own processes and temporary data. It does not use production data
or credentials and does not expose a public dev server.

The disposable runner accepts `THINGTIME_GATEWAY_ACCEPTANCE_PORT_BASE` to choose
an independent eight-port range when another task owns the default range. It
validates every port before creating temporary state and refuses collisions;
it never takes over a listener. The optional Connections2 mode locates built
adapter exports before launch and injects synthetic provider/vault adapters only
inside test processes. It retains the real gateway, session authentication,
one-use state, encrypted account persistence and refresh-lease implementation.
No product test route or authentication bypass is added.

## Suggested project assignment and promotion

For this project, retain `thingtime.com` on `main` for production and
`dev.thingtime.com` on the custom `develop` target. For standard previews,
provision and verify a dedicated alias such as `preview-gateway.thingtime.com`
on a controlled gateway branch. That proposed alias is not an already verified
deployment. Do not select whichever arbitrary PR deployed last as the shared
preview backend. Existing staging/wildcard aliases are not acceptance evidence.

Build the gateway from the intended integration branch, run contract/real API
acceptance, then promote that immutable deployment to its stable environment
alias. Keep its previous immutable identity for rollback. Standard preview and
custom develop currently inherit the same Mongo credential records; independent
gateway identities do not make their physical databases isolated. Preserve that
data mapping unless an explicit data migration is authorized.

Remove Mongo credentials from broad follower/PR environment scopes and retain
them only in the exact supported canonical gateway branch/target scopes. This
also prevents future pre-gateway PR branches from opening pools: those bundles
ignore new gateway variables, but cannot connect without database credentials.
They may require a supported platform HTTP rewrite or redeployment to remain
functional; never claim old API compatibility merely because forwarding exists.
Already built immutable deployments retain their captured environment and still
require retirement/restriction. Production deployment of older code must not be
promoted without the gateway contract; env variables cannot teach an old bundle
new behavior. Strong enforcement across arbitrary code requires platform-level
credential/network separation, potentially a dedicated backend project.

Before moving an alias, negotiate `api.lopu-background-tasks` 1.3.2 and inspect
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


## PR992 integration verification — 26 October 2026

Network-denied gateway/capability/Mongo/admin-integration checks passed 272/272.
The Connections/workflow/migration/readiness batch passed 238 pre-existing checks;
all four new signed-relay OAuth cases passed after completing their synthetic
live-session fixture. The fixed cases verify exact frontend callback and actual
data-environment selection, one-use state, wrong/revoked sessions and concurrent
refresh/account independence. Targeted lint passed 26 `.ts`/`.tsx` files with two
pre-existing `apiDocs.ts` warnings. Existing ESLint does not parse `.mts`; those
checks ran through Node. Raw TypeScript reported 92 diagnostics, none on added
or modified lines; this is not a clean repository typecheck.

A sanitized `node-server` build and both generic and synthetic Connections2
built transport acceptance passed. The latter used the free range 19971–19978,
a temporary replica set and real synthetic registration/cookies. It verified
frontend callback preservation, callback replay refusal, exactly one provider
exchange and one rotating refresh across two concurrent requests (200/401),
credential-free responses, Vite root docs and promotion/rollback. Followers made
zero MongoDB dials; initial DDL recorded 138 creates/51 drops with peak2, while
an unchanged cold owner issued zero commands. Processes and disposable state
were cleaned up. These local tests do not establish actual provider consent,
current preview Connections2 support or installed native acceptance.
