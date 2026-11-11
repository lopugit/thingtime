# SQLite collection foundation — 12 November 2026

The new collection layer runs on the real file-backed SQLite/BSON store, alongside
the existing bundled MongoDB provider. It does not activate a new database for
any account or native profile. See `verification.json` for exact inputs, source
hashes, commands and observed results.

The combined primitive/collection suite passes 21 tests with no skips. Scoped
lint and raw TypeScript pass. `integration-checks.json` records the combined
zero-error typecheck ratchet and full lint result (372 existing warnings). The
updated progress plan passes 1440/390/320px full-scroll, filter and navigation
checks under `plan/`. These are local results, not CI or deployed acceptance.

The supported contract includes string/ObjectId identity, explicit typed filters,
object-field paths, scalar array membership, deterministic identity-key paging,
conditional set/unset/checked integer increments and deletion. Definitions retain
single-field sparse/multikey uniqueness across reopening the file. One scoped
transaction can mutate multiple collections, and a failed operation poisons that
transaction even if its caller catches the error.

Real-file tests exercise BSON type fidelity, reopen, an independently calculated
bytewise page order, a controlled two-handle revision race, rollback of synthetic
content and ledger documents, unique-key changes and rejection of unsupported
syntax on empty/no-match collections. Hostile getters, proxies and forged BSON
wrapper internals must be rejected without running their hooks. The earlier
primitive suite separately covers independent-process reopening.

## Integration still required

This is an explicit native vocabulary, not MongoDB query compatibility. Equality
distinguishes BSON numeric types, null is different from missing, paths do not
traverse arrays implicitly, and identity-key order is not Mongo sort order. The
current implementation scans all collection rows for each operation; its internal
scan batches do not truncate data, but it has not established production-scale
query performance.

1. Map the canonical collections/session boundary onto provider operations without
   pretending a partial object is a MongoClient. Preserve home/auth and selected
   data-plane ownership and exact transaction/session binding.
2. Implement the actual registration/private-Thing query, projection, sort,
   conditional-update and index contracts. Ledger pipelines, history writes,
   partial/compound uniqueness, TTL, bulk operations and aggregation remain gaps.
3. Run normal API registration, private CRUD, restart, two-account and anonymous
   refusal, stale-revision conflicts, and atomic content/ledger/history failure
   cases against an isolated SQLite destination. Synthetic collection tests are
   not evidence for these API or authorization behaviors.
4. Bind explicit provider choice and file lifecycle to isolated native profiles;
   verify iOS application startup, WebView, suspension/recovery and device storage.
   Never silently migrate, dual-write or fall back between account stores.

No production, signed-app or physical-device acceptance is claimed here.
