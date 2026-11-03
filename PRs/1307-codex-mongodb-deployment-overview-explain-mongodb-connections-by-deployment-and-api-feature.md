# PR 1307 — MongoDB deployment overview

[Pull request](https://github.com/lopugit/thingtime/pull/1307) ·
`codex/mongodb-deployment-overview` · base `main` at `6d9319c2ec45fa5d1994b2c0c9e0ebc2ec78a257`.
The user explicitly authorized this Thingtime PR to target and merge into main.

## Delivered behavior

Admin → MongoDB connections groups snapshots by immutable deployment identity.
Each deployment separates recent open application sockets, checked-out work,
idle retained sockets, pending handshakes and historical observations. Details
show region, warm-runtime sources, home/custom purpose, pool limits and idle
retirement policy. Legacy or malformed evidence remains unknown instead of
inventing zero. Closed/failed/stale sources do not inflate fresh deployment totals.

Monitoring sockets remain unmeasured. An optional model uses the current SDAM
server count and configured monitoring mode: poll up to one per server,
auto/stream up to two, load-balanced zero. The upper bound can exceed actual
usage, especially with auto polling in serverless environments; it is not an
Atlas measurement. Official behavior references are in the
[operator contract](../docs/mongodb-connections.md).

The canonical dispatcher supplies only allowlisted registry domains to an
async request context. Shared client and cached database-handle access records
one feature use per source per request, with cumulative counts and last-use
timestamps. Warm memoized home handles remain instrumented. Features share
pools, so activity cannot assign an exclusive number of sockets to a feature.
No command/request/user/URI payloads or command monitoring are collected.

The private administrator contract advances to
`api.admin-mongodb-connections` 1.1.0 in both generated manifests and the client.
The existing pagination, origin/actor fencing, no-store response and protected
24-hour snapshot lifecycle remain in force. Reusable editable Builder blocks
provide the presentation without replacing saved custom layouts.

## Verification — 3 November 2026

- TypeScript and typecheck ratchet pass with zero errors; full lint passes.
- Client and Nitro node-server builds pass.
- 26 connection/auth/collections lifecycle tests, 128 capability tests and 11
  presentation tests pass. The warm-home regression verifies auth/admin/Things
  attribution after the database is cached, once per request and without
  creating another client.
- The real disposable replica/API fixture verifies two distinct deployment IDs,
  administrator access/source fencing, private/no-store, CMAP sockets and
  pagination. Positive feature readback: primary auth 1 / Things 1 / admin 4;
  secondary auth 1 / Things 1 / admin 1, with valid last-use timestamps.
- Isolated Chrome at 1440px and 390px verifies rendered labels/counts/timestamps,
  full scrolling, opened deployment/runtime details, search, freshness,
  refresh, nested Builder editing, save/reload and account isolation.

Private evidence is retained at
`/tmp/thingtime-mongodb-deployment-overview-20261103-attributed/` and
`/tmp/thingtime-mongodb-overview-20261103/`. It is local acceptance evidence,
not production evidence. Final exact-head CI and deployment URLs are recorded
in the PR checks and delivery receipt rather than frozen in this note.

## Remaining acceptance boundaries

Atlas aggregate diagnostics may be refused by the database tier or permissions.
Application observations and modeled overhead do not establish all cluster
connections or explain a historical alert conclusively. Gateway/backend rollout
and authenticated production browser acceptance follow the authorized merge;
a frontend-only preview using an older API cannot prove the new telemetry.

Graphify is refreshed through the canonical immutable-snapshot wrapper after
staging the final source and this note. Extraction warnings are retained in the
local evidence log; generated output is not treated as stronger acceptance than
the real API/browser evidence above.
