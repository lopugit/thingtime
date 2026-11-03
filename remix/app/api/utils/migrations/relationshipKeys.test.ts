import assert from 'node:assert/strict';
import test from 'node:test';
import { repairRelationshipKeys } from './relationshipKeys';
import { thingUniqueKey } from '../mongodb/uniqueKeys';

const fixture = (docs: any[], update?: (filter: any, operation: any) => any) => {
	let closed = 0;
	let writes = 0;
	const things = {
		find(filter: any, options: any) {
			const field = Object.keys(filter).find(key => key.startsWith('crystal.'))!.slice(8);
			assert.deepEqual(options.projection, { _id: 1, [`crystal.${field}`]: 1, uniqueKeys: 1 });
			assert.deepEqual(filter[`crystal.${field}`], { $type: 'string', $ne: '' });
			const rows = docs.filter(doc => [doc.thingtime].flat().includes(filter.thingtime) &&
				typeof doc.crystal?.[field] === 'string' && doc.crystal[field] !== '');
			return {
				batchSize(size: number) { assert.equal(size, 500); return this; },
				async *[Symbol.asyncIterator]() { yield* rows; },
				async close() { closed += 1; }
			};
		},
		async updateOne(filter: any, operation: any) {
			writes += 1;
			if (update) return update(filter, operation);
			const doc = docs.find(doc => doc._id === filter._id);
			const field = Object.keys(filter).find(key => key.startsWith('crystal.'))!.slice(8);
			assert.equal(filter[`crystal.${field}`], doc.crystal[field]);
			assert.ok([doc.thingtime].flat().includes(filter.thingtime));
			assert.deepEqual(filter.uniqueKeys.$ne, operation.$addToSet.uniqueKeys);
			assert.deepEqual(Object.keys(operation), ['$addToSet']);
			doc.uniqueKeys = [...(doc.uniqueKeys || []), operation.$addToSet.uniqueKeys];
			return { matchedCount: 1, modifiedCount: 1 };
		}
	};
	return { things, closed: () => closed, writes: () => writes };
};

test('repairs missing individual keys, preserves other keys and converges', async () => {
	const other = thingUniqueKey('externalConversationKey', 'import-1');
	const docs = [{ _id: 1, thingtime: ['chat'], crystal: { dmKey: 'a:b' }, uniqueKeys: [other] }];
	const db = fixture(docs);
	const dry = await repairRelationshipKeys(db.things, { dryRun: true });
	assert.equal(dry.matched, 1);
	assert.equal(db.writes(), 0);
	assert.equal((await repairRelationshipKeys(db.things, { dryRun: false })).migrated, 1);
	assert.deepEqual(docs[0].uniqueKeys, [other, thingUniqueKey('dmKey', 'a:b')]);
	assert.equal((await repairRelationshipKeys(db.things, { dryRun: true })).matched, 0);
	assert.equal(db.closed(), 30); // three passes over ten relationship families
});

test('never stamps free-form data or absent/empty optional relationship keys', async () => {
	const db = fixture([
		{ _id: 1, thingtime: ['data'], crystal: { memberKey: 'c:u' } },
		{ _id: 2, thingtime: ['chat'], crystal: { dmKey: null } },
		{ _id: 3, thingtime: ['friend'], crystal: { friendKey: '' } }
	]);
	assert.equal((await repairRelationshipKeys(db.things, { dryRun: false })).matched, 0);
	assert.equal(db.writes(), 0);
});

test('more than one batch of duplicate slots terminates and stays pending without leaking identities', async () => {
	const docs = Array.from({ length: 1001 }, (_, _id) => ({ _id, thingtime: ['follow'], crystal: { followKey: 'private:a:b' } }));
	const db = fixture(docs, () => { throw Object.assign(new Error('sensitive duplicate key'), { code: 11000 }); });
	const result = await repairRelationshipKeys(db.things, { dryRun: false });
	assert.equal(result.matched, 1001);
	assert.equal(result.skipped, 1001);
	assert.equal(result.migrated, 0);
	assert.equal(db.writes(), 1001);
	assert.equal(db.closed(), 10);
	assert.equal(result.notes.length, 1);
	assert.doesNotMatch(JSON.stringify(result), /private|sensitive/);
	assert.equal((await repairRelationshipKeys(db.things, { dryRun: true })).matched, 1001);
});

test('external source membership shares protected identity repair without claiming data keys', async () => {
	const docs = [
		{ _id: 1, thingtime: ['external-post-source'], crystal: { sourceKey: 'post:account' }, uniqueKeys: [] },
		{ _id: 2, thingtime: ['data'], crystal: { sourceKey: 'post:account' }, uniqueKeys: [] }
	];
	const db = fixture(docs);
	const result = await repairRelationshipKeys(db.things, { dryRun: false });
	assert.equal(result.migrated, 1);
	assert.deepEqual(docs[0].uniqueKeys, [thingUniqueKey('sourceKey', 'post:account')]);
	assert.deepEqual(docs[1].uniqueKeys, []);
	assert.equal((await repairRelationshipKeys(db.things, { dryRun: true })).matched, 0);
});

test('concurrent identity change is not counted as a successful migration', async () => {
	const db = fixture([{ _id: 1, thingtime: 'friend', crystal: { friendKey: 'a~b' } }],
		filter => {
			assert.equal(filter['crystal.friendKey'], 'a~b');
			return { matchedCount: 0, modifiedCount: 0 };
		});
	const result = await repairRelationshipKeys(db.things, { dryRun: false });
	assert.equal(result.migrated, 0);
	assert.equal(result.skipped, 1);
	assert.match(result.notes[0], /changed concurrently/);
});

test('lease failure closes the cursor and stops further writes', async () => {
	const db = fixture([{ _id: 1, thingtime: 'follow', crystal: { followKey: 'a:b' } }]);
	let leases = 0;
	await assert.rejects(repairRelationshipKeys(db.things, {
		dryRun: false,
		assertLease: async () => { if (++leases === 2) throw new Error('lease lost'); }
	}), /lease lost/);
	assert.equal(db.writes(), 0);
	assert.equal(db.closed(), 1);
});

test('non-duplicate database failures close the cursor and fail the migration', async () => {
	const db = fixture([{ _id: 1, thingtime: 'follow', crystal: { followKey: 'a:b' } }], () => { throw new Error('offline'); });
	await assert.rejects(repairRelationshipKeys(db.things, { dryRun: false }), /offline/);
	assert.equal(db.closed(), 1);
});
