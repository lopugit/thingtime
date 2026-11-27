# PR 1394: avoid redundant guarded folder-echo verification

Two-way initial sync point-read the same existing folder twice when its local
and remote hints arrived independently. Both preparations performed current
policy, identity and grant checks despite producing no early copy. The guarded
stream now retains one inventory chunk of exact folder pairs after those fresh
checks. Only the opposite feed's matching stamp can consume a record and defer.
The record cannot create a binding, authorize a child or publish a checkpoint.
Changed hints, unguarded hosts and all effects keep the original checks.

The observation window is local to one stream invocation and bounded at the
existing 128-entry processing size. Eviction falls back to fresh checks; it
never rejects or truncates a feed. It can lose effectiveness or thrash when
larger same-order feeds arrive separately. That remains a performance design
and benchmark requirement, not a correctness exception.

## Real-byte comparison

Both compared runs used the canonical desktop manager/renderer/transfer worker,
production native/cloud feeds, strict async capture and deletion propagation
off. The disposable fixture had 26 files, 128 sibling plus six nested folders,
160 paths, and 23,463,572 final bytes. It lost accepted stage, publication and
cloud replies in that order and restarted the native adapter three times.

| Measurement | Before | After |
| --- | ---: | ---: |
| Full fixture time | 704.955 s | 618.316 s |
| First confirmed file | 272.553 s | 273.999 s |
| First upload body byte | 523.373 s | 438.337 s |
| Native context / inspect calls | 380 / 292 | 325 / 237 |
| Fresh identity checks | 2,059 | 1,785 |

Total time fell 12.29%, and upload began 85.036 seconds earlier. First-file
confirmation did not improve. This is a partial improvement; startup,
large-scale throughput and batching remain P0 work. The separate 454.311-second
legacy fallback and 174.773-second canonical scalar/deletions-on fixtures are
coverage for different paths, not a before/after product speed comparison.

Both streaming runs independently read back every local/cloud hash and exact
checkpoint count. HTTP observations confirmed 21,366,403 upload bytes once;
2,097,169 download bytes were staged once, retaining the accepted 2 MiB offset.
The two original streaming operation IDs/receipts survived interruption; strict
reconciliation completed the remaining work, and an unchanged pass performed
no transfer/publication. Scope is an isolated canonical fixture, not installed
UI, personal-root or 100 GB/TB acceptance.

## Verification and boundaries

- Full sync suite: 749 passed, no skips. Focused two-way regressions: 21 passed.
  New duplicate-read regressions fail the original runtime. Coverage includes
  both feed orders, changed/evicted hints, legacy fallback, pause/account change,
  stale/deleted parents and children, interruption and fresh strict scans.
- Raw TypeScript passed; targeted lint had no errors and existing warnings.
  Independent source and authorization reviews found no actionable issue.
- Native admission remains burst 12, three checks/second and 180/minute. No
  authority cache, cap increase or weaker effect boundary was introduced.
- Source certificate for the final changed runtime is
  `635f569192fa0d3573f756a3db2091ac30feba0edb3e3f7f0bc1d017a50ce2f2`.
  Every recorded file matched the pushed runtime head `1615585c6c`.
- Existing source-matched native/backend artifacts were reused. Personal jobs,
  grants, settings and installed account were untouched. Final signed delivery
  is coordinated after integration with the account-restore work.
- Structural Graphify output was refreshed. Scoped semantic extraction was
  bounded and incomplete; refreshed Markdown semantic coverage is not claimed.

Detailed non-secret receipts are retained locally under
`/tmp/tt-sync-native-control-latency/`; no fixture credentials or generated
private state are committed.
