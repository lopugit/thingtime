# PR #182 — Unify exact storage accounting

## Context

PR #170 established app storage tiers and was merged while this follow-up was
being completed. The existing `codex/app-data-quota-allowances` branch therefore
continues in PR #182 against the same stacked admin base.

## What changed

- One versioned logical-byte definition now measures normalized Thing
  `crystal`, `extended`, and `tags` payloads as exact UTF-8 JSON bytes.
- Account, app, and app-user ledgers consume the same delta in one MongoDB
  transaction. App data contributes once to the account total; app and
  app-user counters remain overlapping enforcement scopes.
- The protected user subscription storage ledger is the authoritative account
  allowance, usage, enforcement, and display source. Legacy flat usage is not
  trusted; a valid legacy allowance can be migrated as an explicit override.
- Every supported writer uses the canonical accounting path, including generic
  Things, comments/reactions, app data, themes, algorithms, updates, and
  deletes.
- Fenced, idempotent migration reconciles existing rows to a fixed point and
  fails closed for malformed, unknown-owner, stale, or incomplete ledgers.
- Admin, Settings, and app-management UI render canonical `ready`,
  `reconciling`, or `unavailable` states and never substitute an unknown value
  with zero.
- Protected ledger identities, app deletion/session revocation, sandbox
  markers, service quotas, and legacy interaction conversion were hardened.

## Exactness boundary

The counter is exact for the logical UTF-8 JSON payload used by Thingtime's
quota contract. It intentionally does not claim to represent physical BSON,
indexes, replication, compression, or WiredTiger disk allocation.

## Base integration

The newer stacked base was merged before final publication. Its only shared
application files combined cleanly: Mongo index retry behavior and the exact
storage transaction/index changes are both retained, as are the base crypto
API docs and the storage API docs. Generated Graphify conflicts were resolved
by taking one complete base snapshot and regenerating graph, manifest, report,
semantic cache, clustering, and HTML from the merged source.

## Verification

- 100/100 focused exact-storage, identity, migration, lifecycle, UI projection,
  ACL, app-storage, service-quota, tier-catalog, and schema assertions pass on
  the merged tree.
- The full production build and Vercel output verification pass.
- An independent adversarial review found no remaining concrete P0/P1
  correctness or security issue.
- Desktop and mobile browser QA covered admin querying, tier editing and custom
  discounts, canonical storage states, Settings, app management, modal states,
  full-page scrolling, and overflow.
- Local, Tailscale/Funnel, and Vercel preview admin URLs return HTTP 200.

## Operational follow-ups

These are scale/operations boundaries rather than known accounting defects:

- Very high-cardinality app reconciliation may eventually need bounded batches
  instead of one transaction.
- Separate admin account/app reads can briefly show adjacent committed
  snapshots while enforcement itself remains transactional.
- A malformed legacy Thing already near MongoDB's document limit may require
  manual cleanup because migration pins its full source preimage.
- A whole-corpus migration timeout leaves ledgers safely fenced and requires an
  idempotent rerun before storage growth resumes.
