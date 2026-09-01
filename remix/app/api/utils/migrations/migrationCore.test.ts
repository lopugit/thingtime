import assert from 'node:assert/strict';
import test from 'node:test';

import {
	builtinSchemaSeedNeedsRefresh,
	bulkWriteErrorCodesByOp,
	conversionBuildOutcomes,
	exactDocumentSnapshotMatch,
	storageMigrationOwnership,
	upsertedOpIndexes
} from './migrationCore.ts';

test('legacy conversion delete pins the full source even without updatedAt', () => {
	const source = { _id: 'legacy-1', email: 'person@example.test', nested: { value: 1 } };
	const match = exactDocumentSnapshotMatch(source) as any;
	assert.equal(match._id, source._id);
	assert.equal(Object.prototype.hasOwnProperty.call(match, 'updatedAt'), false);
	assert.deepEqual(match.$expr, { $eq: ['$$ROOT', { $literal: source }] });
	assert.notDeepEqual(match.$expr.$eq[1].$literal, { ...source, nested: { value: 2 } });
});

test('billable content with no current user remains unresolved', () => {
	const known = new Set(['user-1']);
	assert.equal(storageMigrationOwnership({ ownerId: 'user-1', thingtime: ['data'] }, known), 'known-user');
	assert.equal(storageMigrationOwnership({ ownerId: 'missing-user', thingtime: ['data'] }, known), 'unknown-user');
	assert.equal(storageMigrationOwnership({ ownerId: 'missing-user', thingtime: ['subscription'], storageClass: 'control' }, known), 'excluded');
	assert.equal(storageMigrationOwnership({ ownerId: 'system', thingtime: ['schema'], storageClass: 'control' }, known), 'excluded');
	assert.equal(storageMigrationOwnership({ ownerId: 'user-1', thingtime: ['schema'] }, known), 'known-user');
});

test('builtin schema seed treats a missing control-plane stamp as repairable drift', () => {
	const crystal = { id: 'service-quota', name: 'Service quota' };
	assert.equal(builtinSchemaSeedNeedsRefresh({ crystal }, crystal), true);
	assert.equal(builtinSchemaSeedNeedsRefresh({ crystal, storageClass: 'content' }, crystal), true);
	assert.equal(builtinSchemaSeedNeedsRefresh({ crystal, storageClass: 'control' }, crystal), false);
	assert.equal(
		builtinSchemaSeedNeedsRefresh({ crystal: { ...crystal, name: 'Stale' }, storageClass: 'control' }, crystal),
		true
	);
});

// --------------------------------------------------------------------------
// Batched claim phase of collectionToThingsMigration (perf: one bulk write per
// page instead of one round trip per doc). The claim decides which candidates
// THIS run created, and only those may have their legacy source consumed, so a
// misread of the driver's bulk outcome is a data-loss bug rather than a
// cosmetic one. These pin the two readers against the shapes the mongodb
// driver actually produces (v6 `MongoBulkWriteError`: `writeErrors` keyed by
// the original op index, plus a `result` BulkWriteResult carrying the upserts
// that still landed).

test('a fully successful bulk upsert reports exactly the ops that created a doc', () => {
	// ops 0 and 2 inserted; op 1 MATCHED a prior-run twin and is deliberately
	// absent — it has to go through the genuine check, not be claimed as ours
	assert.deepEqual(upsertedOpIndexes({ upsertedIds: { 0: 'id-a', 2: 'id-c' } }), [0, 2]);
	assert.deepEqual(upsertedOpIndexes({ upsertedIds: {} }), []);
	assert.deepEqual(upsertedOpIndexes(undefined), []);
	assert.deepEqual(upsertedOpIndexes(null), []);
});

test('a partially failed unordered bulk write still yields its landed upserts', () => {
	// unordered execution applies every op that did not fail: op 1 duplicated a
	// key, ops 0 and 2 upserted anyway and must NOT be re-claimed next run
	const error = {
		writeErrors: [{ index: 1, code: 11000 }],
		result: { upsertedIds: { 0: 'id-a', 2: 'id-c' } }
	};
	assert.deepEqual(upsertedOpIndexes(error.result), [0, 2]);
	assert.deepEqual([...bulkWriteErrorCodesByOp(error)!], [[1, 11000]]);
});

test('write-error codes are keyed by the original op index, with an err.code fallback', () => {
	const codes = bulkWriteErrorCodesByOp({
		writeErrors: [{ index: 3, code: 11000 }, { index: 7, err: { code: 121 } }]
	})!;
	assert.equal(codes.get(3), 11000);
	// a WriteError exposing its code only through the nested err payload
	assert.equal(codes.get(7), 121);
	// 11000 is the only code that means "a unique key is already held"; anything
	// else is a generic per-doc conversion error and is skipped, not re-read
	assert.equal(codes.get(0), undefined);
	assert.equal(codes.size, 2);
});

test('a rejection with no per-op write errors is not a per-op outcome', () => {
	// write-concern failure, connection loss, any driver-level error: these say
	// nothing about which documents landed, so the caller must rethrow instead
	// of reading an empty map as "nothing conflicted"
	assert.equal(bulkWriteErrorCodesByOp({ writeErrors: [] }), null);
	assert.equal(bulkWriteErrorCodesByOp({ result: { upsertedIds: {} } }), null);
	assert.equal(bulkWriteErrorCodesByOp(new Error('connection closed')), null);
	assert.equal(bulkWriteErrorCodesByOp(undefined), null);
});

test('a lone write error object fails closed to the rethrow', () => {
	// the driver types writeErrors as one-or-many. A bare object must never read
	// as an empty map: that would mark a conflicting insert as successful and
	// let the consume phase delete its legacy source.
	assert.equal(bulkWriteErrorCodesByOp({ writeErrors: { index: 0, code: 11000 } }), null);
});

// --------------------------------------------------------------------------
// Build phase of the same page loop. The per-doc conversion this batching
// replaced built inside its try/catch, so a corrupt legacy row cost one skip.
// Batching the page put the build in a bare loop, where the same throw escapes
// run() before skippedIds records the row — every re-run then re-reads the same
// page and aborts identically, wedging the migration on one document.

test('a page of buildable docs converts in order, with no skips', () => {
	const outcomes = conversionBuildOutcomes([{ id: 'a' }, { id: 'b' }], (doc) => ({ ok: true as const, thing: { shareId: doc.id } }));
	assert.deepEqual(outcomes, [
		{ ok: true, doc: { id: 'a' }, thing: { shareId: 'a' } },
		{ ok: true, doc: { id: 'b' }, thing: { shareId: 'b' } }
	]);
});

test('a declared conversion failure keeps its own reason for the admin note', () => {
	const outcomes = conversionBuildOutcomes([{ id: 'a' }], () => ({ ok: false as const, reason: 'missing passwordHash' }));
	assert.deepEqual(outcomes, [{ ok: false, doc: { id: 'a' }, reason: 'missing passwordHash' }]);
	// a spec that reports failure without a reason still yields a usable note
	assert.deepEqual(conversionBuildOutcomes([{ id: 'b' }], () => ({ ok: false as const })), [
		{ ok: false, doc: { id: 'b' }, reason: 'conversion failed' }
	]);
});

test('a THROWING conversion is isolated to its own doc, never propagated', () => {
	// the real shape: users.ts buildUserSecure calls .toISOString() on a legacy
	// emailVerificationRequiredBy, so a truthy unparseable value raises
	// RangeError instead of returning { ok: false }
	const poison = { id: 'poison', emailVerificationRequiredBy: 'soon' };
	const outcomes = conversionBuildOutcomes<any, Record<string, any>>([{ id: 'a' }, poison, { id: 'c' }], (doc: any) => {
		if (doc.emailVerificationRequiredBy) return { ok: true as const, thing: { at: new Date(doc.emailVerificationRequiredBy).toISOString() } };
		return { ok: true as const, thing: { shareId: doc.id } };
	});
	// every other doc on the page still converted — the throw did not abort the page
	assert.deepEqual(
		outcomes.map((o) => o.ok),
		[true, false, true]
	);
	assert.equal(outcomes[1].ok, false);
	// generic reason only: err.message could embed a doc field value, and this
	// note goes into the admin-visible migration report
	assert.equal((outcomes[1] as any).reason, 'conversion error');
	assert.equal((outcomes[1] as any).doc, poison);
});
