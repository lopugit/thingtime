# PR #976 — Resolve named Timeline branches directly with scoped reads

PR: https://github.com/lopugit/thingtime/pull/976
Branch: `codex/timeline-branch-lookup`, based on main after PR #975.

## Behavior

A cold editor can resolve one named branch/Thing pointer without relying on a
bounded local cache or scanning the branch directory. `api.timeline` 1.9.0 adds
GET by `branchId` and `thingId` alongside the existing account/data-plane scope.
It returns `{ok,branch,head}` using the canonical branch/head records already
shared by local and remote storage. Two exact owner-scoped identity reads use
existing collection/index paths. No version content or published Thing is read
or changed. Missing membership returns 404; duplicate/mixed selectors return 400.

The shared API client negotiates 1.9.0 and checks the returned owner, branch and
Thing. The existing Timeline sync/cache accepts the pointer without acknowledging
pending commands. A delayed reply cannot rewind a newer cached revision; stopped
sessions cannot adopt an in-flight result. Exact checkout remains revision-fenced,
so lookup followed by a concurrent push safely produces a 409 on checkout.

Explicit home and selected custom database reads retain their existing async
scope. Identical branch and Thing IDs can point to different versions in those
databases without leaking or switching the surrounding request context.

This is a prerequisite for visual Builder branch loading. It adds no Builder
branch switcher or runtime behavior, durable schema, collection, index, IndexedDB
migration, configuration or environment variable. Field editing still uses the
existing History interface. All broader outstanding Timeline work remains open.

## Validation

- 98 Timeline tests: canonical lookup grammar, scope checks, two exact storage
  reads, private projection, missing membership, duplicate selectors, rate limits,
  cold-cache adoption, queued push preservation, stale replies and cancellation.
- 92 capability tests; both manifests advertise Timeline 1.9.0.
- Full unit suite: 4,249 passed, 8 existing skips. Production build passed.
- Raw TypeScript: 91 existing diagnostics, identical normalized messages and
  counts to the main baseline. No new diagnostics. Targeted lint: no errors and
  four pre-existing warnings in the route, branch contract and sync constructor.
- Real HTTP on a guarded disposable local replica set: direct lookup after a
  branch push, exact checkout, unchanged history/content, anonymous and another
  signed-in account refusal, invalid selectors, and simultaneous home/custom
  reads with identical branch/Thing identities and different versions.
- TESTING.md, feature maps and Timeline contract updated. No visual layout change
  requires browser acceptance in this increment. Test fixture credentials removed.
- Graphify AST/manifest pair refreshed before merge. Existing `.mts` integration
  scripts are directly executed; Markdown semantic freshness is not claimed.

Remote CI/security gates and exact deployed-commit verification are checked
before reporting the change as merged/live. Production verification is read-only.
