# Account storage recovery

Ordinary writes continue to update exact account storage in the source
transaction. A healthy ledger has no pending-work size limit. When a trusted,
current account ledger needs reconciliation, an unlimited account may reserve
up to **100 MiB (104,857,600 bytes)** of gross positive pending deltas. This is
the requested recovery budget, not a per-file or per-Thing limit. Finite
allowances with uncertain usage remain closed until exact recovery; malformed,
missing or foreign ledgers are never admission evidence. App and app-user
admission still apply in the same transaction.

The source write, protected pending aggregate, relational `storage-pending`
receipt and durable `storage-recovery` job commit together. Deletes do not
reopen the positive budget. Retained deletion history remains accounted for.
A full queue returns a retryable storage-busy failure; it cannot grow past the
budget. Request retries retain the operation semantics of their existing
writer and Mongo transaction; the queue does not replay user actions.

Recovery runs after authenticated mutations and through the existing protected
five-minute scheduler, `/api/v1/lopu/recordings/run`. The request trigger only
reduces latency; durable jobs survive request termination. The worker claims a
per-account lease, remeasures current source documents in bounded cursor passes,
and fences every transaction against a successor. It replaces the ledger with
an exact census and clears covered pending receipts in the same transaction.
It does not add a delta after counting an already-updated source. New queue
arrivals cannot be erased by an older worker's completion.

Transient failures back off and stop after five consecutive failed attempts.
Unsupported legacy schemas and malformed source envelopes remain explicit
blocked states. Use the existing **Initialize exact whole-account storage
ledgers** migration (`backfill-user-storage-accounting`) for those cases. It
owns prerequisite ordering and fixed-point reconciliation; do not run its
prerequisites separately against live ready ledgers. A newer canonical
reconciliation baseline permits a previously blocked recovery job to rearm.

## Release and monitoring contract

`api.storage-accounting` **1.0.0** advertises the shared transactional queue
and recovery semantics across accounted writers; clients that depend on those
semantics negotiate it independently. Ordinary clients retain their existing
operation contracts. `api.health-nitro` **1.3.0** verifies source stamps as well as trusted ledgers.
`storageAccounting.state` is `ready`, `recovering` or `migration-required`.
Recovering is degraded (`ok: false`), never exact-ready evidence. Public health
returns no account identifiers, contents or per-account byte counts. The
scheduler's **1.6.0** contract adds aggregate `storageRecovery` outcomes while
preserving its cron-secret/admin authorization and home data plane.

The protected `github-actions` controller requires current production readiness
inside the existing merge-required build check. Production candidates require
health 1.3.0 and a complete deployment-scoped runtime error-log query before
alias changes, then ready health at the actual alias. Recovering candidates
have a bounded 90-second drain window. Failed alias verification uses the
existing alias rollback mechanism.

The thin `storage-release-monitor.yml` listener runs after deployment, every
15 minutes and manually. Its protected implementation queries the current
production alias, validates its deployment/project/source identity, checks
readiness and scans a bounded 30-minute error/fatal log window. Truncation,
access failure or ambiguous deployment scope fails the check. It publishes a
deduplicated **Production storage runtime** commit status; no raw provider logs
or credentials are retained in the summary.

`api.things` 1.46.1 reserves the pending/recovery share-ID namespaces so
ordinary create/upsert calls cannot squat operational identities.

Known storage failures emit fixed codes: `STORAGE_MIGRATION_REQUIRED`,
`STORAGE_RECOVERY_BUSY`, `STORAGE_ACCOUNTING_UNAVAILABLE`, `STORAGE_INVARIANT`.
Handled JSON failures are inspected through a bounded clone; only allowlisted
authored messages become a code. General response bodies never enter logs.

## Fork setup and verification

Use the normal home MongoDB replica-set configuration and existing scheduler
secret. No new Vercel application environment variable or provider secret is
introduced. The controller reuses its protected `vercel-prebuilt-control`
environment: deployment token, project/team ID and team slug. Configure those
through the repository's existing deployment setup, never in product code.
Merge the controller implementation before activating the thin main listener.

Run `test:storage`, `test:storage-recovery`, `test:error-logs`,
`test:api-capabilities`, `test:migrations` and `test:storage-recovery:integration`.
The required API-suite CI job runs the integration on its own disposable Linux
Docker replica before starting the regular dev stack. Local execution uses
`mongod` on PATH, or `THINGTIME_TEST_MONGOD` for an explicit binary. No existing
database or inherited application configuration is reused.

Then smoke the built handler's manifest and health response, deploy the exact
source revision, exercise an authenticated write/reload, and run the protected
monitor. Unit fixtures and a successful build are separate from production
acceptance.
