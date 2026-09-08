import assert from 'node:assert/strict';
import test from 'node:test';
import { createThingsDataIndexes, thingsIndexPlanEntries } from './collections';
import { createRelationshipLookup } from './relationshipLookup';
import { migrateRelationshipIndexLayout, prepareRelationshipIndexLayout, relationshipIndexLayoutReady, RELATIONSHIP_LAYOUT_KEY, retireRelationshipLookupIndexes, SHARED_RELATIONSHIP_LOOKUPS } from './relationshipIndexLayout';
import { thingUniqueKey } from './uniqueKeys';

test('home shares five lookup families while custom/repair fallback retains their indexes', async () => {
	const home = await thingsIndexPlanEntries();
	assert.equal(home.length + 1, 54);
	for (const name of Object.keys(SHARED_RELATIONSHIP_LOOKUPS)) assert.equal(home.some(entry => entry.name === name), false);
	const customNames: string[] = [];
	await Promise.all(createThingsDataIndexes({ collection: () => ({
		createIndex: async (_keys: unknown, options: any = {}) => { customNames.push(options.name); },
		dropIndex: async () => undefined
	}) }, { relationshipLookups: true }));
	for (const name of Object.keys(SHARED_RELATIONSHIP_LOOKUPS)) assert.ok(customNames.includes(name));
});

test('lookup waits for home readiness and preserves custom-plane/home-pinned routing', async () => {
	let custom = true;
	let preparations = 0;
	const lookup = createRelationshipLookup({ customActive: () => custom, prepareHome: async () => { preparations++; return true; } });
	assert.deepEqual(await lookup.filter('memberKey', 'c:u'), { 'crystal.memberKey': 'c:u' });
	assert.deepEqual(await lookup.filter('followKey', ['a:b']), { 'crystal.followKey': { $in: ['a:b'] } });
	assert.equal(preparations, 0);
	assert.deepEqual(await lookup.filter('memberKey', 'c:u', { home: true }), { uniqueKeys: thingUniqueKey('memberKey', 'c:u'), 'crystal.memberKey': 'c:u' });
	assert.equal(preparations, 1);
	custom = false;
	assert.deepEqual(await lookup.filter('followKey', ['a:b', 'a:b', '']), { uniqueKeys: { $in: [thingUniqueKey('followKey', 'a:b')] }, 'crystal.followKey': { $in: ['a:b', 'a:b', ''] } });
	assert.equal(preparations, 2);
	const pending = createRelationshipLookup({ customActive: () => false, prepareHome: async () => false });
	assert.deepEqual(await pending.filter('memberKey', 'c:u'), { 'crystal.memberKey': 'c:u' });
	const failed = createRelationshipLookup({ customActive: () => false, prepareHome: async () => { throw new Error('migration required'); } });
	await assert.rejects(failed.filter('memberKey', 'c:u'), /migration required/);
});

const fixture = (duplicate = false) => {
	const events: string[] = [];
	const oldKey = thingUniqueKey('externalConversationKey', 'imported');
	const doc: any = { _id: 1, crystal: { dmKey: 'a:b' }, uniqueKeys: [oldKey] };
	return {
		events, doc, oldKey,
		things: {
			async createIndex(keys: unknown, options: unknown) {
				assert.deepEqual(keys, { uniqueKeys: 1 });
				assert.deepEqual(options, { unique: true, sparse: true });
				events.push('constraint');
			},
			find(filter: any) {
				events.push('scan');
				return {
					batchSize() { return this; },
					async *[Symbol.asyncIterator]() { if (filter.thingtime === 'chat') yield doc; },
					async close() {}
				};
			},
			async updateOne(filter: any, update: any) {
				events.push('repair');
				assert.equal(filter['crystal.dmKey'], 'a:b');
				if (duplicate) throw Object.assign(new Error('duplicate'), { code: 11000 });
				doc.uniqueKeys.push(update.$addToSet.uniqueKeys);
				return { matchedCount: 1, modifiedCount: 1 };
			},
			async indexes() { return Object.entries(SHARED_RELATIONSHIP_LOOKUPS).map(([name, field]) => ({
				name, key: { [field]: 1 }, partialFilterExpression: { [field]: name === 'things_friend_key_lookup' ? { $exists: true } : { $type: 'string' } }
			})); },
			async dropIndex(name: string) { events.push(`drop:${name}`); }
		}
	};
};

test('constraint and additive repair complete before any lookup retirement', async () => {
	const db = fixture();
	await prepareRelationshipIndexLayout(db.things);
	assert.equal(db.events[0], 'constraint');
	assert.equal(db.events.some(event => event.startsWith('drop:')), false);
	assert.deepEqual(db.doc.uniqueKeys, [db.oldKey, thingUniqueKey('dmKey', 'a:b')]);
	await retireRelationshipLookupIndexes(db.things);
	assert.equal(db.events.filter(event => event.startsWith('drop:')).length, 5);
});

test('duplicate repair blocks activation and leaves every old lookup in place', async () => {
	const db = fixture(true);
	await assert.rejects(prepareRelationshipIndexLayout(db.things), /Relationship keys need repair/);
	assert.equal(db.events.some(event => event.startsWith('drop:')), false);
});

test('retirement refuses unique or unexpectedly redefined indexes', async () => {
	for (const index of [
		{ name: 'things_friend_key_lookup', key: { 'crystal.friendKey': 1 }, unique: true },
		{ name: 'things_friend_key_lookup', key: { anotherField: 1 } }
	]) {
		let dropped = false;
		await assert.rejects(retireRelationshipLookupIndexes({ indexes: async () => [index], dropIndex: async () => { dropped = true; } }), /preserved/);
		assert.equal(dropped, false);
	}
});

test('explicit migration dry-run does not write, and lease is mandatory for activation', async () => {
	const db = fixture();
	const settings = { findOne: async () => null, updateOne: async () => { throw new Error('unexpected write'); } };
	assert.equal((await migrateRelationshipIndexLayout(db.things, settings, { dryRun: true })).matched, 7);
	assert.equal(db.events.some(event => event === 'constraint' || event === 'repair' || event.startsWith('drop:')), false);
	await assert.rejects(migrateRelationshipIndexLayout(db.things, settings, { dryRun: false }), /requires an active lease/);
});

test('readiness is an indexed metadata read; validation precedes activation and retirement', async () => {
	const db = fixture();
	let ready = false;
	const settings = {
		findOne: async (filter: unknown, options: unknown) => {
			assert.deepEqual(filter, { key: RELATIONSHIP_LAYOUT_KEY });
			assert.deepEqual(options, { projection: { ready: 1 } });
			return { ready };
		},
		updateOne: async () => { assert.ok(db.events.includes('repair')); db.events.push('activate'); ready = true; }
	};
	assert.equal(await relationshipIndexLayoutReady(settings), false);
	assert.equal(db.events.length, 0);
	await migrateRelationshipIndexLayout(db.things, settings, { dryRun: false, assertLease: async () => { db.events.push('lease'); } });
	assert.equal(await relationshipIndexLayoutReady(settings), true);
	assert.ok(db.events.indexOf('activate') < db.events.findIndex(event => event.startsWith('drop:')));
	assert.ok(db.events.filter(event => event === 'lease').length >= 8);
});

test('duplicates and lease loss never activate an incomplete layout', async () => {
	const settings = { updateOne: async () => { throw new Error('must not activate'); } };
	await assert.rejects(migrateRelationshipIndexLayout(fixture(true).things, settings, { dryRun: false, assertLease: async () => {} }), /Relationship keys need repair/);
	const db = fixture();
	await assert.rejects(migrateRelationshipIndexLayout(db.things, settings, { dryRun: false, assertLease: async () => { throw new Error('lost lease'); } }), /lost lease/);
	assert.equal(db.events.length, 0);
});
