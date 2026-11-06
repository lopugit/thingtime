# Guarded sync ancestor deferral and healthy startup timing

2026-11-06. Source work only; the parent task owns the combined signed release.
No installed app, personal folder, account, grant or saved sync was changed.

## Behavior

Guarded dual-feed preparation can prove from its scoped journal that an entry
has no usable ancestor chain. Defer that hint before a connection-policy RPC,
without opening protected point reads. Every surviving hint retains the same
fresh saved-configuration/device/conditions check before native/cloud reads.
Legacy ordering and every effect's fresh authorization remain unchanged.
No authorization cache, higher admission budget, resource-limit change or
parallel sync engine was introduced. Strict reconciliation owns deferred work.

The explicit `--healthy` canonical fixture lane disables accepted-loss/restart
injections while preserving byte/hash/strict-checkpoint/unchanged assertions.
Healthy proofs list only checks actually exercised; recovery is a separate lane.

## Matched measurement

One before/after pair on the same 40-path tree: 8 sibling folders, 6 nested
folders, 26 files, 23,463,572 final bytes. Real canonical desktop host, transfer
worker, native fixture, Rust indexer and built HTTP API; isolated synthetic
roots/profile/database only. Scan/transfer 5,000,000 B/s (5 MB/s), CPU 15%.

| Observation | Before | After |
| --- | ---: | ---: |
| Healthy sync | 212.902 s | 187.090 s |
| First upload body byte | 69.017 s | 42.907 s |
| First confirmed file | 34.928 s | 34.245 s |
| Native context calls | 125 | 95 |
| All native calls | 315 | 279 |
| Fresh native identity checks | 665 | 586 |
| Unchanged pass | 22.547 s | 22.327 s |

The measured reduction is 12.1% overall and 37.8% to upload body arrival; this
single pair is not a statistical guarantee or installed-app throughput claim.
Both runs verified identical bytes and SHA-256 values. Baseline runtime sources
and built backend matched the prior integrated certificate except the test-only
healthy harness. Evidence: `/tmp/tt-sync-healthy-startup/comparison.json`,
`baseline-source.json`, `patched-source.json`, and the corresponding private logs.
These initial timing runs preceded the review correction of proof check labels;
their labels are not used as evidence of fault recovery.

The earlier 160-path mixed-fault run's 300-second upload timing cannot be
attributed solely to faults using this smaller tree. Its attribution remains
unknown. Healthy startup is independently slow, as the matched baseline shows.

## Verification and remaining delivery

- Regression failed before the fix (two policy contexts instead of one).
- 29 focused dual-feed tests, 760 file-sync tests and 20 fixture transport tests
  pass. Pause/removal/destination change after deferral still refuse protected
  reads; legacy behavior and zero-effect/checkpoint boundaries are covered.
- Raw TypeScript passes; focused lint has zero errors and seven existing warnings.
- Final integration with reconnect work, corrected proof-label acceptance,
  recovery acceptance and current graph are tracked in the PR follow-up.
- Signed installed-app acceptance remains with the parent release task.
