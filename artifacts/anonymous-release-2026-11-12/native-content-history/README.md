# Native content and Timeline persistence — 12 November 2026

This checkpoint adds internal semantic Things and Timeline persistence contracts,
Mongo compatibility adapters, and SQLite implementations using the same actual
account/content transaction. Canonical mutation validation, history envelopes,
snapshot parts, Published heads, storage accounting and author projection remain
shared. It does not activate generic native Things HTTP or claim full parity.

Independent review found and corrected unfiltered-query handling, binary UTF-8
pagination, stale physical versions after delete/recreate, and unbounded vault
child materialization for an existence check. The combined SQLite regression
proves content/history/accounting rollback even when the caller catches failure;
post-commit effects are suppressed and successful history survives reopening.

## Verification

Focused suites pass: 166 document-store tests, 278 Timeline tests and one Mongo
persistence compatibility test (445 total, no failures or skips). These include
the actual SQLite combined content/history transaction and native profile
projection fixture; they are not generic Things HTTP acceptance.

The [verification receipt](verification/verification.json) records each command,
result, source inventory and built output hashes. Source attribution is base
commit plus the frozen inventory, not a clean-commit build. The
[plan receipt](plan/verification.json) covers isolated Chromium at 1440/390/320px,
full-page scrolling, overflow, filters, search, navigation and cleanup.

Final combined verification passes all ten commands on 5249 unchanged
source files: both focused suites, Mongo persistence compatibility, TypeScript,
zero-error ratchet, full lint (0 errors/374 warnings), canonical web/Nitro build,
packaged-output verification and both real database HTTP fixtures.

- MongoDB: registration, private Thing CRUD, cross-account permissions,
  stale-revision refusal, API/database restart retention and cleanup.
- SQLite: actual Electron macOS safeStorage, registration, login/logout,
  root-data/session/roster retention across a fresh process, manifests, unsupported
  operation/origin refusals and cleanup. Generic Things remains unavailable;
  queued mail still reports `delivered:false`.
- Nitro SHA-256: `494e5750ecf225c1cbf8dbca193367b67ca7dc149839d83181ccc9999d980535`.
- This desktop payload does not replace earlier separately frozen iOS evidence.
- Graph refresh uses structural indexing after the earlier scoped semantic pass
  exceeded its bounded budget. No new complete semantic documentation coverage
  is claimed; the shared proxy service and credential were not changed.

## Remaining acceptance

- Canonical Things service/request integration and actual SQLite CRUD/ACL/folder/
  stale-revision HTTP acceptance. Candidate repository reads are not authorized
  public responses.
- Saved-page component dependency capture (currently refused before append),
  native note/version-name writes and indexed query planning. Native scans remain
  O(n); no performance parity is claimed.
- Full desktop UI, iOS protected-account runtime/device acceptance, native email
  delivery, production release trust and connected-host MCP artifact delivery.
- No production deployment, stable app replacement or existing account-content
  mutation is part of this checkpoint.
