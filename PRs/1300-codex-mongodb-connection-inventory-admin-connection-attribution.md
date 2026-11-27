# PR 1300 — MongoDB connection inventory

[Pull request](https://github.com/lopugit/thingtime/pull/1300) ·
`codex/mongodb-connection-inventory` · base `main` at `62f19f930`.
The user explicitly requested this Thingtime feature be merged into main.

## Delivered behavior

Admin → MongoDB connections and Settings → Admin share an individually editable
Builder layout. Source cards show runtime identity, creator and purpose,
deployment URL, branch, commit, region, observation time and server-pool details.
Manual refresh, loaded-source search, freshness filtering and cursor pagination
preserve explicit observation boundaries and account/origin isolation.

Canonical MongoClient CMAP listeners attach before connection establishment.
Protected home control Things retain bounded runtime snapshots through the
shared expiry lifecycle. Publishing reuses an existing home client at ordinary
request completion; it does not poll, wake other deployments or create a
diagnostic connection. The current-administrator endpoint negotiates
`api.admin-mongodb-connections` 1.0.0 and returns private/no-store responses.
Custom endpoint addresses, credentials, commands and request identities are not
published.

## Verification — 2 November 2026

- 18 focused backend, 92 adjacent, 14 gateway, 5 collections and 7 UI tests pass.
- CI caught the new protected kind missing from the built-in schema projection
  pin. Added the pin and explicit JSON projection/protected-write regression;
  all 292 schema tests and the 18 connection tests pass. The runtime schema
  contract was already valid and did not require a behavioral change.
- Raw TypeScript and ratchet: zero errors. Full lint: zero errors, 391 warnings.
- Client and Nitro node-server builds pass.
- Real API fixture: fresh disposable replica, independent synthetic identities
  and two instrumented runtime processes; manifest, access denial, actor/origin
  fencing, private/no-store, CMAP attribution, aggregate readback and pagination.
- Isolated Chrome at 1440px and 390px: full scrolling, source details, search,
  freshness, empty state, refresh, keyboard access, nested Builder text/control/
  repeated-field editing, private saved-Thing readback and reload, shared Settings
  placement and removal of prior observations after an account switch.
- Mobile overlap found in rendered review is repaired through an opt-in shared
  settings workspace. Refresh hit targets remain clear; the navigation Lopu
  opener works with the keyboard; collapsing Settings restores the floating
  launcher. No JavaScript errors; fixture browser, databases and ports released.

Private local acceptance evidence is retained in
`/tmp/thingtime-mongodb-connections-20261102/acceptance/`; it is not production
evidence. The runner is reproducible through the [checklist](../TESTING.md).

## Observation limits and rollout

Atlas Flex does not expose exhaustive individual-client enumeration. MongoDB
server totals describe one selected server; application pool snapshots exclude
monitoring sockets, external clients and old uninstrumented deployments. A
recent snapshot can outlive a terminated worker. The UI does not equate these
different scopes or subtract them to invent an unattributed total.

Production gateway/backend rollout and authenticated production UI acceptance
must follow merge. A frontend preview backed by an older gateway cannot prove
this new backend capability. Shared TTL physical cleanup additionally depends on
the active index plan converging across database-sharing deployments.

The existing preview-retention and PR-liveliness controls are unchanged. This
feature adds visibility and does not terminate connections, change retention
policy, upgrade Atlas, or claim a cause for a historical alert.

See the [operator and API contract](../docs/mongodb-connections.md).
