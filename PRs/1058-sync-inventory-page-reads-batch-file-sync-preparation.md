# PR 1058 · Bounded file-sync preparation

Large home inventories perform several validated journal passes before upload.
Per-entry cursors and repeated sibling ancestor work can dominate this stage.
This change batches values with their actual stored keys (at most 129 including
lookahead), keeps returned pages at 128 entries / 1 MiB, and groups parent checks
and ancestor writes within each transaction. It covers inventory validation and
reading, plan decisions, operation reading and cloud-binding preparation.

Exact identities, cloud ancestry, terminal counts, account/cancellation fences,
active-run admission, ordering and revision-guarded writes are preserved. No
capture format, schema version or HTTP capability contract changes are required.

The editable progress viewer reports the actual preparation phase and phase
counts independently of index totals and uploaded receipts. Rendering is limited
to once per second during a phase, with immediate phase/final-count updates.

## Verification · 20 October 2026

- 433 TypeScript tests pass across file sync and the editable progress display;
  the additional module-mock test passes (434 total).
- Regressions cover bounded requests, shared parents, corrupt primary keys,
  long Unicode byte pagination, scope/cancel/reopen safety and preparation counts.
- Isolated Chromium acceptance passes at 1440 and 390 pixels, including complete
  scrolling, nested controls, Builder field edits, save/reload and long counts.
- Independent final source review found no further issues after the test suite
  caught and the parent fixed missing helper receiver references.
- Typecheck ratchet passes with the existing warning: 92 diagnostics versus
  baseline 89. The changed-file diagnostics were corrected; this is not a clean
  repository-wide typecheck.
- Structural graph refresh is required for the final source. Semantic indexing
  of documentation remains unverified after the existing backend hollow-response
  failure; generated structural outputs are retained.

## Installed acceptance

The prior signed app retains 3,653,988 imported entries and 53,728 explicit skipped
observations. Build, installation, advancing phase counts and actual payload
receipt/sample verification are tracked separately in the live HTML task plan.
No uploaded home payload or completed backup is claimed by this source PR.
Android remains deferred; unsupported filesystem observations remain explicit.

Branch: `codex/sync-inventory-page-reads`

PR: https://github.com/lopugit/thingtime/pull/1058
