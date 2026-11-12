# MongoDB connection inventory

Administrators open **Admin → MongoDB connections** at
`/admin/mongodb-connections`, or the same section in Settings → Admin.
Each deployment card groups its observed warm runtimes and shared MongoDB clients
by immutable deployment ID. Missing IDs stay separate rather than guessing from
a branch or URL. Cards lead with application connections, in-use and idle counts,
then a modeled MongoDB-facing range and the features using those shared clients.
Expand the details for runtimes, individual server pools and their retention
settings. Search and freshness filters select matching deployment groups from
the loaded sources; pagination can leave a deployment only partly observed.
Refresh is explicit and retains the previous result if a read fails.

The layout uses the shared private settings-document host. Headings, controls,
card fields and repeated pool templates are separately editable in the Builder.
Saving a layout stores bindings and presentation, never a telemetry snapshot.
An unchanged previous default layout upgrades automatically; custom saved layouts
remain intact.

## What the numbers establish

- **Database-reported aggregate** is a bounded `serverStatus` read through the
  existing home client. It describes the selected MongoDB server, not the whole
  cluster. A tier or permission refusal remains unavailable, never zero.
- **Instrumented Thingtime pool snapshots** come from MongoDB driver connection
  pool events attached before the canonical client connects. The deployment
  headline includes ready clients observed directly or within two minutes;
  stale, closed and failed sources remain in history, outside that headline.
  **In use** means checked out at observation time; **idle** means ready open
  application sockets minus those checked out. Idle sockets remain connected
  for reuse and can still count at MongoDB.
- **Modeled MongoDB-facing range** starts at the observed ready application
  sockets. Its upper end adds pending handshakes and a topology-based monitoring
  allowance: up to two per server per client for configured auto/stream mode,
  one for poll, zero for load-balanced mode. Auto mode is not evidence that
  streaming is active. Unknown topology or legacy snapshots leave the model
  unavailable. These are observation-time bounds, not a measured live Atlas
  total or guaranteed bounds after the observation. See the driver's
  [pool and monitoring model](https://www.mongodb.com/docs/drivers/node/v6.x/connect/connection-options/connection-pools/).
- **Why connections multiply:** each warm runtime can have its own home client
  and optional custom data-plane clients; each client maintains server pools
  and monitoring. Traffic can grow a pool up to its configured maximum. Minimum
  pool size and idle timeout explain retention; a maximum is capacity, not the
  current number. Opening this view reuses the existing client.
- **Feature activity** records a request using a shared client or cached database
  handle once per client, grouped
  by the canonical API domain, with its last-use time. Counts accumulate for
  that client lifetime, not a rolling window, query count or per-feature socket
  allocation. Authentication and content within one request share the request's
  feature label. Features share sockets; legacy activity remains unavailable.
- **Current runtime** means this serving process was observed directly. Other
  observations are recent for two minutes, then stale. A frozen or terminated
  worker can leave a stale snapshot; last seen is not proof it is still connected.
- Counts describe the loaded observations at their respective times. Do not
  subtract them from a server aggregate to invent an exact unattributed count.
  The samples differ in scope, time and monitoring-socket coverage.

Deployment sums can span several MongoDB servers. Atlas connection charts and
limits can refer to an individual process; compare the same server and time,
not an all-server modeled sum against one node. External tools and uninstrumented
clients remain outside these observations. See [Atlas metrics](https://www.mongodb.com/docs/atlas/review-available-metrics/).

Atlas Flex and Free tiers do not expose an exhaustive `currentOp` connection
inventory. Connection-limit alert percentages are also different from a socket
count. See MongoDB's [Flex limitations](https://www.mongodb.com/docs/atlas/reference/flex-limitations/)
and [limited command support](https://www.mongodb.com/docs/atlas/unsupported-commands/).
The feature does not upgrade an Atlas tier, terminate connections or infer the
cause of a historical alert from a current deployment inventory.

## Runtime and privacy

`api/utils/mongodb/collections.ts` remains the only cached application-client
factory. `connectionTracker.ts` observes its lifecycle without creating a
diagnostic client. The normal API completion path publishes throttled snapshots
using an already-connected home client; it creates no polling timer, visits no
other deployment and preserves proxy followers' no-direct-dial contract.

Protected `mongodb-connection-snapshot` control Things use the existing shared
ephemeral TTL and kind/creation indexes. Reads exclude snapshots after 24 hours;
physical TTL removal follows convergence of the shared home index plan. Older
deployments sharing that database can still carry an older eligibility filter,
so a mixed rollout must verify the active index plan before claiming physical
retention has converged. Snapshots are excluded from account storage usage.
Generic Things access cannot create, read
or overwrite them. The dedicated endpoint projects an allowlist, excludes raw
URIs, credentials, request identities and commands, and withholds custom endpoint
addresses. Admin replies are private and `no-store`.

The client negotiates `api.admin-mongodb-connections` **1.1.0** against the
selected origin before `GET /api/v1/admin/mongodb/connections`. Actor, selected
origin and data-plane changes fence old requests and saved-layout state.
Both capability manifests derive the feature from the canonical route registry.
Version 1.1 adds optional monitoring evidence, pool policy fields and allowlisted
feature usage. The request context stores only a bounded feature identifier and
the clients already counted in that request; it retains no request identity,
path, body, commands or user. No command monitoring is enabled.

## Fork setup and verification

Use the existing home MongoDB/auth setup and an ordinary administrator account;
no new secret, Vercel variable, provider credential or telemetry service is
required. Vercel's existing deployment metadata supplies attribution when
available. An absent field remains unknown. Deploy the backend to the environment
gateway before claiming acceptance from a frontend-only preview.

Run the connection lifecycle/projection tests, collections/gateway/capability
regressions, and the disposable real-API browser runner
`remix/scripts/mongodb-connections-acceptance.mjs`. The runner uses independent
test identities, a local replica and browser profile. It is not Atlas acceptance.
Production acceptance must read the deployed endpoint and compare actual cards,
aggregate availability and timestamps with that same environment's evidence.
See the **MongoDB connection inventory** checklist in `TESTING.md`.
