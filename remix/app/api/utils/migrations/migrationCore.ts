import { isBillableStorageThing } from '../storage/storageCore.ts';

// Exact optimistic delete guard for legacy collection conversion. Matching the
// whole BSON preimage (inside $literal, so user keys are never interpreted as
// operators) catches field additions/removals as well as value changes and
// remains safe for historical rows which never had an updatedAt token.
export const exactDocumentSnapshotMatch = (doc: Record<string, unknown>): Record<string, unknown> => ({
	_id: doc._id,
	$expr: { $eq: ['$$ROOT', { $literal: doc }] }
});

export const builtinSchemaSeedNeedsRefresh = (
	twin: { crystal?: unknown; storageClass?: unknown } | null | undefined,
	expectedCrystal: unknown
): boolean =>
	!twin || twin.storageClass !== 'control' || JSON.stringify(twin.crystal ?? {}) !== JSON.stringify(expectedCrystal);

export const storageMigrationOwnership = (
	doc: Parameters<typeof isBillableStorageThing>[0],
	knownUsers: ReadonlySet<string>
): 'excluded' | 'known-user' | 'unknown-user' => {
	if (!isBillableStorageThing(doc)) return 'excluded';
	return knownUsers.has(String(doc.ownerId)) ? 'known-user' : 'unknown-user';
};

// --------------------------------------------------------------------------
// Reading an unordered bulkWrite outcome — the batched claim phase of
// collectionToThingsMigration.
//
// This is the subtlest step in the whole conversion: the claim decides which
// candidates this run created, and the consume phase deletes a legacy source
// only for candidates it believes landed. Misreading the driver here means
// either converting a doc twice or deleting a source whose destination never
// arrived, so both claim shapes (bulk insert for waitlist's non-deterministic
// ids, bulk upsert for deterministic shareIds) read it through these two pure
// functions, pinned in migrationCore.test.ts.

// op index → write-error code for a rejected bulkWrite.
//
// null means the rejection is NOT a per-op outcome — a write-concern failure,
// a connection loss, any driver-level error. Those carry no writeErrors and
// say nothing about which documents landed, so the caller must rethrow rather
// than read them as "these candidates conflicted".
//
// Indexes are the ORIGINAL positions in the ops array we passed: the driver
// rewrites batch-relative indexes back when it merges batch results, so they
// line up even when a page is split across several wire batches. The array
// check is deliberate — the driver types writeErrors as one-or-many, and a
// lone object must fail closed to the rethrow, never read as an empty map
// (which would silently mark a conflicting insert as successful).
export const bulkWriteErrorCodesByOp = (error: any): Map<number, number> | null => {
	const writeErrors = error?.writeErrors;
	if (!Array.isArray(writeErrors) || !writeErrors.length) return null;
	const codes = new Map<number, number>();
	for (const writeError of writeErrors) codes.set(writeError?.index, writeError?.code ?? writeError?.err?.code);
	return codes;
};

// Op indexes whose upsert CREATED the destination doc — genuinely ours by
// construction, which is what licenses the consume phase to repair them.
//
// Accepts either a resolved BulkWriteResult or the `result` a bulk write error
// carries: unordered execution still applies every op that did not fail, so a
// partial failure leaves real upserts that must be recovered rather than
// re-claimed on the next run. Ops that MATCHED an existing doc are absent by
// design — those are prior-run twins and have to pass the genuine check.
export const upsertedOpIndexes = (result: any): number[] => Object.keys(result?.upsertedIds ?? {}).map(Number);

// --------------------------------------------------------------------------
// Building a page of destination things — phase 1 of collectionToThingsMigration.
//
// `toThing` is pure, but it is also arbitrary conversion code running over
// LEGACY documents, which is precisely where corrupt values survive: a users
// row whose `emailVerificationRequiredBy` is truthy but unparseable reaches
// buildUserSecure's `new Date(...).toISOString()` and raises RangeError rather
// than returning { ok: false }. The per-doc loop this batching replaced ran the
// build inside the same try/catch as its I/O, so one poisoned row was skipped
// and noted while the rest of the page converted.
//
// That isolation has to survive the batching, and it matters more here than it
// did per-doc: an exception escaping the page loop aborts run() BEFORE the row
// is recorded in skippedIds, so the next run re-reads the same page, hits the
// same row, and aborts identically — one bad document wedges the migration
// permanently instead of costing it a single skip.
//
// Outcomes are returned in batch order so the caller emits its skip notes in
// the order the per-doc path did.
export type ConversionBuildOutcome<D, T> = { ok: true; doc: D; thing: T } | { ok: false; doc: D; reason: string };

export const conversionBuildOutcomes = <D, T>(
	batch: readonly D[],
	toThing: (doc: D) => { ok: true; thing: T } | { ok: false; reason?: string }
): ConversionBuildOutcome<D, T>[] =>
	batch.map((doc) => {
		let built;
		try {
			built = toThing(doc);
		} catch {
			// generic reason only — never echo err.message, which could embed a doc
			// field value into the admin-visible migration report
			return { ok: false as const, doc, reason: 'conversion error' };
		}
		if (built.ok) return { ok: true as const, doc, thing: built.thing };
		return { ok: false as const, doc, reason: 'reason' in built && built.reason ? built.reason : 'conversion failed' };
	});
