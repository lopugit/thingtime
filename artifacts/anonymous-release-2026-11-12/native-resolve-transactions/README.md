# Native SQLite resolution and composed writes — 12 November 2026

This checkpoint extends the existing PR #1000 branch. SQLite is first-class and
MongoDB remains an optional desktop provider; shared services retain feature
validation, authorization, accounting and History. No main merge, production
deployment, stable-app replacement or existing product-account changes occur.

## Source changes

- Protected native runtime admission for the existing Webpage GET/POST handlers,
  negotiated as `api.webpages-resolve` 1.20.0 by both capability manifests.
- Exact transaction/session/effect-sink composition for canonical create/update;
  ignored internal failures still roll back rows, quota, History and effects.
- Read-only collection snapshots bound to the actual current transaction and
  callback lifetime. A caught attempted mutation poisons the transaction.
- Typed byte-budget persistence, native app/grant reads, canonical namespace quota
  policy, reconciliation and a separate sandbox storage lane. Malformed refund
  counters cannot regain ready status. Namespace service admission stays closed.

## Evidence status

The initial combined run is retained under [verification](verification/verification.json).
It identified a profile-projection regression: an identity-only native scope was
incorrectly required to bind a content repository. The correction must retain
that supported path and same-transaction profile projection without Mongo fallback.
The correction preserves both paths. A separate cross-provider byte-budget
regression reproduced a transaction-binding hole and verified its fix. Namespace
review also corrected malformed refund-counter admission; no generic namespace
route was enabled.

[Final combined results](combined-verification.json): all 13 check commands pass,
1,289 reported test passes and three explicit opt-in skips. These are command
counts, not distinct-case counts. [Affected reruns](verification-correction/verification.json)
pass on 5,638 inventoried files unchanged throughout verification. TypeScript and
the zero-error ratchet pass; full lint has 0 errors and 377 warnings.

[Packaged runtime](packaged/verification.json): build/integrity and actual isolated
MongoDB/SQLite HTTP restart fixtures pass. SQLite uses real Electron safeStorage
and proves GET admission, empty authorized POST draft resolution, owner/plane/auth
refusals, token isolation/revocation and fresh-process account retention. This is
not saved-content HTTP or full rendered Builder acceptance. Compiled Nitro SHA-256:
`d768692d5e26379a027fb3102cc724265870c5071b745f5a3a2ec9457983179c`.
The build used the recorded pre-commit working tree, not a clean-commit build.

Logs with ANSI/whitespace normalization retain exact original bytes as `.raw.gz`.
Source/build hashes identify the tested bytes; no secrets or account credentials
are included. No new full semantic Graphify indexing is claimed: prior proxy
failure recovery is exhausted and the shared proxy/key remain unchanged.

## Acceptance boundaries and next work

Real handler tests create users, editable content and workspaces through canonical
services. Protected system catalogue and external relationship rows are explicitly
labeled unit fixtures; no OAuth, system provisioning or Action execution is proved.
Compiled HTTP checks distinguish empty authorized draft resolution and refusal
paths from saved-content and visual Builder acceptance.

Generic Things/catalog HTTP, app/PAT content namespaces, namespace billing/token
pruning/retention scheduling, creation coordinators, Actions, managed cascades,
attachments, text search and full offline Builder remain open. The sandbox purge
helper alone is not a running retention service. iOS protected runtime/device
acceptance and connected canonical MCP downloadable artifact delivery remain open.
The task and goal stay active.
