# Account restore admission and review planning

This is an implementation phase of complete independent account backup and
recovery, not delivery of the whole-backup feature.

The task branch starts at freshly fetched origin/main
41fc975e32b55d1513297a5a45bfb85ecf95bde5. It reuses the released, clean managed
native-compound-upload checkout on codex/account-restore-admission. No installed
app, native service, account data or other task checkout is modified.

The worker validates every retained byte stream and known canonical payload,
indexes dependency aliases/mappings on private disposable SQLite, and writes
immutable paged review objects. The plan nonce makes allocation identities stable
on resume and distinct for new plans. A review binds the exact source descriptor,
destination owner/origin/root/revision, capability values, adapter contracts,
ordered records, coverage and explicit issues. Planned IDs confer no authority.

Review corrections include per-page trusted hash pins before yielding any record,
current source-account/cancellation checks before every yield, strict record
validation, metadata-only account file descriptors and canonical attachment
fingerprint/size/version closure. Completion, break and errors clean scratch;
explicit idempotent close covers never-consumed handles.

Available-disk mode keeps a 2 MiB SQLite cache, no memory mapping and disk temporary
storage. It uses actual filesystem/SQLite capacity unless an explicit caller
resource budget is supplied. Existing workspace consumers keep their earlier
policy. This is not evidence of a 100 TB transfer.

Legacy v1 source coverage remains unknown and reference discovery partial.
Canonical writers are unavailable; whole-account readiness is always false.
Existing ordinary-record v1 serializer limitations (100,000 nodes and 128 MiB)
are included in coverage. Larger valid ordinary content cannot currently be
captured by that codec. A separately versioned streaming codec must preserve
v1 readers. Revalidation after an interrupted preparation currently rereads the
sealed source; long verification checkpoints remain open.

The full backup suite passes 106 tests. Focused planner/workspace/key coverage
passes 10 tests against the final behavior. TypeScript passes. Full ESLint has
0 errors and 420 existing warnings; changed-file lint passes. The stale negative
account inventory fixture now exceeds its actual unchanged processing bound,
while a valid 90,001-node value has positive admission coverage.

Remaining product gates include full managed/security/settings/device capture,
complete dependency closure, canonical restore writers and historical recovery,
server jobs/receipts, encryption/key recovery, installed product UI, independently
verified provider durability and measured 100 GB–100 TB acceptance. Android and
physical-media delivery retain their separately deferred scope.


Graphify structural refresh produced 72,418 nodes and verified the new source
paths in the active manifest, with portable HTML regenerated. A scoped semantic
refresh of three existing changed documents expanded into 77 model slices and
was stopped after five to bound work; no partial semantic result was activated.
Those modified documents are not claimed semantically refreshed. The small
PR-specific note receives a separate bounded semantic attempt.
