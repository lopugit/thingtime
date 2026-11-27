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
- 31 focused dual-feed tests, 765 file-sync tests and 20 fixture transport tests
  pass. Pause/removal/destination change after deferral still refuse protected
  reads; legacy behavior and zero-effect/checkpoint boundaries are covered.
- Raw TypeScript passes; focused lint has zero errors and seven existing warnings.
- Integrated reconnect merge `23015acf06a25c00eacd90abd3ec1f0cfbdddd9d`.
  Pre-location tested runtime source: `442c898801863646de2182c985c3c97f5101bdd7`.
- Pre-location same-source healthy and recovery runs both passed. Healthy: 186.995 s,
  first upload body 42.915 s, first confirmation 34.206 s, 279 native calls and
  586 fresh identity checks. Recovery measurements are retained below.
- That pair used freshly rebuilt native fixture, Rust indexer and middleware API.
  Historical source certificates pin 383 source hashes and actual native/backend/indexer
  binary paths and hashes; Rust reports `commander-indexer 0.1.0`. The temporary
  signed fixture is removed by normal cleanup. Parent independently verified
  all 383 hashes and surviving binary hashes with zero mismatches.
- Compatible native publication 1.3.0 exposed a stale exact 1.2.0 fixture
  assertion. The harness now uses the canonical major/minimum contract check.
- Capture the guarded-host decision once before journal awaits. A controlled
  true-to-undefined change failed before the fix and now retains authorization
  before protected point reads. No cached policy or identity result is reused.
- Signed installed-app acceptance remains with the parent release task.

## Pre-location recovery acceptance

Same 40-path tree and exact bytes/hashes as the healthy run, all three accepted
reply losses (stage, publication, cloud) and native restarts exercised.
Recovery scenario: 199.994 s across fault/recovery phases; first upload body 55.615 s; first
confirmation 44.886 s. Preserve original operation IDs, accepted range offsets, no-replay transfer
counts, strict checkpoints and unchanged convergence. Complete per-phase timings
are in `/tmp/tt-sync-healthy-startup/integrated-validation.json`; phase definitions
differ from the healthy lane, so this is recovery coverage, not a causal
healthy-versus-fault speed ratio.

First confirmation still takes about 34 seconds. This latency remains open;
the source improvement does not complete the parent's broader performance goal.

## Graph coverage

The scoped semantic refresh expanded the five changed documents into 109 model
chunks. That attempt was stopped before activation to bound cost; its partial
output is not published as complete coverage. The canonical structural update,
clustering and portable export cover the final source fingerprint. Semantic
coverage of this note, TESTING.md, CHANGELOG.md and the two changed sync/map docs
was not refreshed; that limitation is distinct from passing source acceptance.

## Required peer-base integration

The first normal merge attempt was refused after all four required checks
passed, because the location PR #1397 advanced `main` to
`8379dca5dee260ebb477e242cba58b546fe35a22`. This strict-base requirement is
satisfied through an ordinary feature-branch merge, never an admin bypass.

The required base changed six formerly certified native/Electron files, added
DeviceAlerts/DeviceLocation sources and device API/schema/registry behavior.
`ThingtimeAPIClient.requireCredential(deviceID:)` now selects one matching
credential from `loadAll()`, so the historical 383-file certificate is not
whole-source acceptance of this new base. The sync engine, guard ordering and
Rust indexer remain unchanged.

The newly integrated runtime is `91e149c228f75a1e15158865ee9a179e60b5f28d`.
Fresh Swift/Rust/backend builds and a new same-source healthy/recovery pair
are required before merge. Their exact source/binary certificates and observed
outcomes are published in the [PR description](https://github.com/lopugit/thingtime/pull/1400)
and retained under `/tmp/tt-sync-healthy-startup/integrated-*.json`. The matched
before/after timing table remains scoped to its original measured inputs.
No installed app, personal sync or location-release state is modified here.
