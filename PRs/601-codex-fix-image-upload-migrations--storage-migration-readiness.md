# PR #601 — expose upload-blocking storage migration readiness

- **Branch:** `codex/fix-image-upload-migrations` → `develop`
- **PR:** https://github.com/lopugit/thingtime/pull/601

## Incident

Production image upload initiation returned HTTP 503 with the authored
`accounting_unavailable` message before any S3 request was attempted. All 49
current production accounts had storage ledgers behind
`USER_STORAGE_ACCOUNTING_VERSION`, but `/api/v1/health/nitro` still reported
the runtime as ready. The upload path was correctly failing closed; the missing
piece was deployment-visible migration readiness.

The API sweep exercised 574 non-mutating production cases. 573 passed; the
only reported failure was a stale test expectation for `/api/v1/email/config`,
which intentionally returns 403 on production.

## Change

- `/api/v1/health/nitro` now checks every current user ledger through a cached,
  bounded home-database read. It reports `degraded`, the expected accounting
  version, and `backfill-user-storage-accounting` whenever a ledger is absent,
  malformed, non-ready, or stale.
- `api.health-nitro` is versioned at 1.1.0 with manifest negotiation coverage.
- The email-config docs and live API test accept its exact production 403 while
  retaining the sanitized 200 contract for local development and previews;
  `api.email-config` is versioned at 1.0.1.
- The manual migration checklist now requires post-deploy health, zero-pending,
  and tiny-image upload verification.

## Completed migrations (2026-09-03)

### Production

- `backfill-user-storage-accounting`: 615 matched; 543 billable Things stamped;
  49 account ledgers transactionally reconciled; 23 built-in schema prerequisite
  records migrated; no invalid claims quarantined.
- `rebuild-things-indexes`: 57 plan-owned indexes rebuilt one at a time; 10
  unique constraints remained protected by twins; index storage fell from
  1.7 GB to 44.2 MB.
- `drop-stale-collection-generations`: 20 verified-empty generations dropped.
- Final census: zero pending migrations, zero stale generations, zero adoption
  issues.

### Develop

- `backfill-user-storage-accounting`: 117 matched; 80 billable Things stamped;
  24 account ledgers transactionally reconciled; 14 built-in schema prerequisite
  records migrated; no invalid claims quarantined.
- `backfill-relationship-unique-keys`: two passkey/app-link documents stamped.
- Final census: zero pending migrations, zero stale generations, zero adoption
  issues.

All mutations went through the real admin migration route, including its
bounded request body, admin gate, distributed lease, explicit destructive-run
confirmation, failure diagnostics, and idempotent migration implementations.
Vercel secrets were read only in process and were neither printed nor written
to the repository.

## Verification

- storage: 10 passed
- API capability manifest: 6 passed
- Thingtime capability negotiation: 2 passed
- migrations: 52 passed
- attachments: 141 passed
- typecheck ratchet: 3 passed
- production build and Vercel output verification: passed
- Graphify CAS: 15 passed
