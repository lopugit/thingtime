# PR 1063 — Keep file transfers moving during index waits

The renderer serialized every native request through one promise queue. A scan-changes long-poll could therefore hold conditions, inspect and read-range for up to 25 seconds before they reached Electron and native adapters, despite their separate waiter lanes. Give scan-changes its own per-bridge FIFO; preserve ordinary ordering and request-scoped cancellation across both lanes.

Canceling an identity check could also cancel the independent streaming scanner and mark its durable capture interrupted. Apply the existing legacy-backup cancellation guard to streaming captures. Genuine authorization rejection still cancels indexing; source grants, scopes, durable cursors and receipt identities are unchanged.

Add fixed phase/error-code diagnostics for scan, monitor and request-authorization interruption. Ordinary requests taking more than ten seconds report a validated action name, monotonic elapsed milliseconds and fixed outcome code. Expected index waits are excluded. Diagnostics exclude descriptions, account identifiers, file paths, URLs and credentials. Hashing and scheduling architecture are unchanged.

## Verification — 2026-10-20

- The renderer held-wait regressions failed before correction; its full focused suite passed 11 tests afterward. They cover conditions/inspect/binary reads during waits, ordinary FIFO, request-specific waiter cancellation and lifetime cancellation across both lanes.
- The native paused-helper test failed all four cases before correction: ordinary and long-poll identity requests, each using CancellationError and URLSession-style cancellation. Afterward it retains running state and generation, then confirms a real 403 still interrupts indexing.
- Native diagnostic privacy tests reject invalid action names and sensitive error descriptions/URLs. The complete MacFolderSync group and combined shared file-sync suite are run on the final source; results are recorded in the PR.
- Hooks and Graphify union merge driver are installed and verified. Incremental code graph refresh retains portable graph/report/HTML; changed Markdown semantic freshness is not claimed (code-only update, no broad semantic rebuild).

## Acceptance limit

The preceding installed producer discarded its original error and suppressed helper stderr, so this proves and fixes reproducible defects without establishing the original installed interruption cause. The existing live backup, journal, account and installed app were not changed. Canonical signed local build verification is recorded in the PR after publication; no notarization or installation is claimed. Real installed nonempty payload acceptance remains the parent task's separate gate.
