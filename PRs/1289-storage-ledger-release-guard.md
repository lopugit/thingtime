# Storage incident recovery and release guards

## Scope and base

- Product branch: `codex/storage-ledger-release-guard`, based on freshly fetched
  `origin/main` at `710f97fa26f4bf66d9f1587b5075b61a2929247d`.
- Isolated worktree: `storage-ledger-release-guard/thingtime`.
- Controller companion: [PR #1288](https://github.com/lopugit/thingtime/pull/1288),
  targeting the protected `github-actions` implementation branch.
- The task explicitly authorizes merging this fix into Thingtime `main`.

## Production incident, 2026-10-29

The reported toast was emitted by account storage reconciliation when billable
source records lacked current accounting stamps. Production showed a current
account ledger stuck reconciling, with two unstamped billable records and stale
built-in schema seeds. This establishes the state that caused the refusal; it
does not identify the original writer of the stale rows. Admin error logs had
reaction HTTP 503s around the screenshot time, but only a generic message.

The authenticated canonical whole-account migration was dry-run and then run
successfully. It fenced 106 account, 5 app and 3 app-user ledgers, repaired
73 prerequisite schema records, stamped 2 billable records and transactionally
reconciled all 106 accounts. Its pending count reached zero. Independent public
health then returned exact ready. A private saved-post write on a representative
reported post survived reload; its original unsaved state was restored.

## Implementation

See [the recovery contract](../docs/storage-recovery.md). Normal healthy writes
remain immediately accounted. Trusted unlimited accounts may use the requested
100 MiB gross positive pending budget during recovery. Finite uncertain quotas
remain fenced; a stale number cannot establish remaining capacity. Pending
receipts, account counters, source writes and durable jobs share transactions.
Deleting content does not reopen the gross positive budget.

Recovery runs separately from mutations, fixing an ordering hazard where an
already-updated source could be counted and its delta applied again. Durable
leases, cursor checkpoints, retry backoff and enqueue generations protect
restart/concurrency. Unsupported schemas still require canonical migration.
Source-aware health, fixed storage error codes and the companion controller
cover pre-merge, production alias publication and scheduled deployed logs.
Generic create/upsert rejects both operational share-ID prefixes, preventing
recovery-job identity squatting. The companion controller PR is merged.

## Verification and remaining release work

- Storage (40), recovery/scheduler (20), migrations (65), error-log and
  capabilities (120) tests passed. Raw TypeScript passed; lint had no errors
  and eight existing warnings. The final Nitro build and built-handler JSON
  manifest smoke passed with the new semantic versions.
- Disposable replica integration uses real registration and Things handlers
  plus canonical accounted utilities, with no production configuration or data.
  Concurrent final reservations at 100 MiB allow exactly one writer; rejected
  inserts and source-before-accounting updates roll back. Independent final
  census equals the prior total plus 104857600 bytes; repeat drain does not
  replay. Fixture processes and database are cleaned.
- Controller focused tests and protected CI cover candidate gates, log scope,
  truncation/access refusal, alias races and deduplicated status publication.
  Approved live provider access was verified against the current production
  deployment, with only safe counts returned.
- Production migration repair is complete independently of code deployment.
  Merge, exact-source deployment, new manifest acceptance and scheduled monitor
  activation must still be verified before the expanded feature is complete.
- Connected reporting tools were absent; supported authenticated UI recovered
  access to the saved workspace. A distinct task Character and private task
  record were created. Private record identifiers stay out of this public note.
- Graphify structural coverage includes the changed documents. Semantic indexing
  was unavailable because the installed backend ignored the local proxy URL;
  no semantic coverage is claimed.
