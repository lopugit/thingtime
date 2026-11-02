# MongoDB connection inventory

Administrators open **Admin → MongoDB connections** at
`/admin/mongodb-connections`, or the same section in Settings → Admin.
Each source card identifies an instrumented MongoDB client, its warm runtime,
home/custom purpose, deployment URL, branch, commit, region and pool counters.
Expand **Source and pool details** for the individual server pools. Search and
freshness filters apply to loaded sources; **Load more sources** continues the
cursor. Refresh is explicit and retains the previous result if a read fails.

The layout uses the shared private settings-document host. Headings, controls,
card fields and repeated pool templates are separately editable in the Builder.
Saving a layout stores bindings and presentation, never a telemetry snapshot.

## What the numbers establish

- **Database-reported aggregate** is a bounded `serverStatus` read through the
  existing home client. It describes the selected MongoDB server, not the whole
  cluster. A tier or permission refusal remains unavailable, never zero.
- **Instrumented Thingtime pool snapshots** come from MongoDB driver connection
  pool events attached before the canonical client connects. Monitoring sockets,
  external tools, old deployments and uninstrumented clients are not enumerated.
- **Current runtime** means this serving process was observed directly. Other
  observations are recent for two minutes, then stale. A frozen or terminated
  worker can leave a stale snapshot; last seen is not proof it is still connected.
- Counts describe the loaded observations at their respective times. Do not
  subtract them from a server aggregate to invent an exact unattributed count.
  The samples differ in scope, time and monitoring-socket coverage.

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

The client negotiates `api.admin-mongodb-connections` **1.0.0** against the
selected origin before `GET /api/v1/admin/mongodb/connections`. Actor, selected
origin and data-plane changes fence old requests and saved-layout state.
Both capability manifests derive the feature from the canonical route registry.

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
