# PR #74 — Batch `collectionToThingsMigration` per page

Branch: `claude/batch-collection-things-migration` · Base: `develop` ·
Origin: PR #69 review finding **c16**

## What the PR does

`collectionToThingsMigration.run` converted the legacy `users`, `themes`,
`feedAlgorithms`, and `waitlist` collections into things one document at a time,
paying 3-4 sequential Mongo round trips per document. Migrating ~50k accounts
meant ~150-200k serial round trips inside a single admin HTTP request.

Each `CONVERT_BATCH` (200) page now batches every step that can batch **without
weakening a guard**:

- **CLAIM (deterministic shareId — `users` / `themes` / `feedAlgorithms`)** — one
  unordered `bulkWrite` of `$setOnInsert` upserts atomically claims every
  destination id; `upsertedIds` classifies inserted vs. pre-existing; a single
  `shareId` `$in` re-read runs the genuine check on the remainder.
- **CLAIM (non-deterministic shareId — `waitlist`)** — a new optional
  `spec.findExistingMany` resolves the whole page's `uniqueKeys` existence
  lookup in one `$in` query, then one bulk insert. Falls back to per-doc
  `findExisting` when a spec doesn't provide it.
- **CONSUME (reads)** — one `legacy` `_id` `$in` fresh read, one `things`
  `shareId` `$in` destination read, and one `settings` `key` `$in` conversion-receipt
  read, all per page.
- **CONSUME (mutations)** — the receipt-verified consume of each survivor
  (lease re-assert, CAS `replaceOne` repair, exact-snapshot `deleteOne`, receipt
  write) stays **per document**: a conversion receipt may only certify a delete
  that verifiably landed, and the lease is re-asserted immediately before each
  delete so the fence still holds at the moment data is destroyed.

Net effect is roughly halved round trips — about 3 per migrated document instead
of 6-7 — not the per-page constant the original PR description claimed. Batching
the guarded delete would need a different receipt protocol and is left as
follow-up.

## Review history

Seven Lopu review rounds ran on this branch. The substantive outcomes:

- **Driver semantics verified, then pinned.** The claim phase's reading of
  `mongodb@6`'s bulk outcome is the subtlest part of the change — misreading it
  means deleting a legacy source whose destination never landed. It was
  extracted into `bulkWriteErrorCodesByOp` / `upsertedOpIndexes` in
  `migrationCore.ts` and covered by five tests, including the fail-closed
  behaviour for a lone (non-array) `writeErrors` object and for rejections that
  carry no per-op write errors at all (write-concern failure, connection loss →
  rethrow, never "nothing conflicted").
- **The CHANGELOG was corrected** where it oversold the win as `O(pages)`.
- **Build-phase fault isolation was restored** (below).

## Fix: a throwing `toThing` must not abort the run

Batching moved the destination-thing build into a bare page loop:

```ts
for (const doc of batch) {
  const built = spec.toThing(doc);   // no try/catch
  ...
}
```

The per-document loop it replaced ran that same build **inside** the per-doc
`try/catch`, so a conversion that threw cost one `skip` note and the rest of the
page converted.

`toThing` is pure, but it is arbitrary conversion code over *legacy* rows, which
is exactly where corrupt values survive. `usersToThings.toThing` forwards
`doc.emailVerificationRequiredBy` straight into `buildUserSecure`
(`app/api/utils/auth/users.ts:345`):

```ts
emailVerificationRequiredBy: doc.emailVerificationRequiredBy ? new Date(doc.emailVerificationRequiredBy).toISOString() : null,
```

A truthy but unparseable value (e.g. the string `'soon'`) makes `.toISOString()`
raise `RangeError: Invalid time value` rather than returning `{ ok: false }`.

The consequence is worse than a lost note. The throw escapes `run()` **before**
the row is recorded in `skippedIds`, and `skippedIds` is per-invocation in-memory
state — so the next run issues the same unfiltered page query, hits the same row,
and aborts identically. One corrupt document wedges the entire migration until
somebody hand-edits the database.

The build now runs through `conversionBuildOutcomes` in `migrationCore.ts`, which
returns per-document outcomes in batch order (so skip notes keep their original
ordering) and degrades a throw to the same generic
`conversion error — left for a later re-run` note the old catch emitted — generic
on purpose, since `err.message` could embed a document field value into the
admin-visible migration report.

## Fix: the receipt lookup did not need to be per-document

The consume phase grouped its conversion-receipt lookup with the operations that
genuinely must stay per-document. It doesn't belong there. `hasCollectionConversionReceipt`
is a pure **read**, and its key derives only from `(collection, source._id)` —
the identical key for a page-query snapshot and for the `fresh` re-read of that
same `_id`. So one `key: { $in: [...] }` query against the unique `settings.key`
index resolves a whole page's receipts, and one lookup serves *both* consume-phase
checks (the already-consumed `!fresh` branch and the `receiptCoversFresh`
freshness check).

The predicate was split out as `conversionReceiptCovers(receipt, source)` so the
single-doc and batched lookups cannot drift apart in what they accept — a
disagreement there would mean deleting a legacy source on weaker proof in one
path than the other. The freshness comparison still runs per document, against
the exact snapshot being judged.

Hoisting the read out of the loop is safe in the same direction as every other
batched read here: receipts are only ever upserted, never deleted or revoked, so
a page-old snapshot can **miss** a receipt a concurrent runner just wrote but can
never **invent** one. A miss falls through to the stricter semantic-equality
path, and the concurrent runner that wrote the receipt also deleted the source,
so the exact-snapshot `deleteOne` matches 0 and the doc is left for the next run.

What remains per-document is genuinely irreducible: the lease re-assert (a fence
that must hold at the moment of the delete), the exact-snapshot `deleteOne`
(unordered `bulkWrite` reports only a total `deletedCount`, not which guarded
deletes matched), and the receipt write that must follow it.

## Validation

- **End-to-end against a throwaway mongod**, driving the real
  `runMigration('users-to-things', { confirm: true })` and counting round trips
  **server-side** with `db.setProfilingLevel(2)` rather than inferring them from
  the code. `system.profile` was recreated at 256MB first — it is capped and
  defaults to 1MB, and silent eviction undercounts rather than errors (the first
  250-doc run did exactly that).

  | server-side op, 250 docs / 2 pages | before | after |
  |---|---|---|
  | `settings` receipt reads | **250** | **2** |
  | `settings` writes (lease + receipts) | 507 | 507 |
  | `users` guarded deletes | 250 | 250 |
  | `things` destination reads | 2 | 2 |

  Both runs migrated 250/250, drained the legacy collection, wrote 250 receipts,
  produced an identical report, kept credentials out of the thing (`secure` blob
  present, no plaintext `email`/`passwordHash`, `ownerId === shareId`, legacy
  `_id` preserved as `shareId`), and re-ran as a clean no-op.
- `npm run test:migrations` — **34/34 pass** (`app/api/utils/migrations/*.test.ts`
  alone: 31/31). Earlier rounds added 3 covering ordered success, a declared
  `{ ok: false }` reason including the missing-reason fallback, and a throwing
  conversion isolated to its own document; this round added 3 more pinning
  `conversionReceiptCovers` — an absent receipt (`null` from `findOne`,
  `undefined` from the batched `Map`) and a receipt with no recorded destination
  both refuse to certify; a receipt covers a source only up to the state it
  recorded; and an unusable timestamp on either side routes to the digest
  instead of reading as a satisfied comparison.
- **Mutation check** — relaxing `sourceUpdatedAtMs >= sourceTime` to `true` makes
  `a conversion receipt certifies a source only up to the state it recorded`
  fail, and restoring it passes. The new tests bite.
- **Mutation check** — deleting the new `try/catch` makes
  `a THROWING conversion is isolated to its own doc, never propagated` fail, and
  restoring it makes it pass. The test genuinely pins the regression.
- **Reproduction** — the `RangeError` was reproduced by extracting
  `buildUserSecure`/`packSecure`/`toBin` verbatim from `users.ts` at this head
  (sliced from the file, never retyped) and driving them with the exact argument
  object `migrations.ts` builds. Old per-doc shape: `built = [a, c]`,
  `skipped = [poison]`. New bare-loop shape: run aborted after `a`.
- `tsc --noEmit` with the repo tsconfig — output is **byte-identical** to the
  pre-change baseline apart from one pre-existing error shifting by the single
  added import line. Zero new type errors.

One non-obvious detail worth keeping: the call site tests `outcome.ok === false`
rather than `!outcome.ok`. This tsconfig sets `strictNullChecks: false`, where
truthiness does **not** narrow a boolean discriminant — the same reason the
original build read `'reason' in built`. Simplifying it back to `!outcome.ok`
breaks the typecheck.

## Open follow-ups (not addressed here)

- `skippedIds` still accumulates into a growing `_id: { $nin: [...] }` page
  filter. Pre-existing, unchanged by this PR, and unbounded in principle on a
  collection with many skips; a `_id`-cursor page walk would remove it.
- The consume phase's batched destination and receipt snapshots are read once per
  page, so their staleness window is wider than the per-doc reads they replaced.
  Every mutation underneath them is CAS-guarded (`destinationVersionCas` for the
  repair, the exact source snapshot for the delete), and a stale receipt snapshot
  can only under-report, so staleness degrades to "skip, retry next run" rather
  than to a lost write — but it is a deliberate widening, not a neutral one.
- Batching the guarded delete needs a receipt protocol that can certify a set of
  deletes rather than one. `bulkWrite` reports only a total `deletedCount`, not
  which individual guarded deletes matched, so the per-op outcome each receipt
  depends on is not available today.
- `assertLease()` is an unconditional `settings.updateOne` and runs once per
  survivor, so the consume phase pays ~2 settings writes per migrated document
  (lease renew + receipt write). That is deliberate — the fence has to hold at
  the instant data is destroyed, so it is not a batching candidate — but it does
  mean the per-document floor here is 3 round trips, not 2, and it dominates
  what is left. Reducing it would mean a different fencing design, not a
  different query shape.
