import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { thingUniqueKey, thingUniqueKeys, thingUniqueKeyFilter, thingUniqueKeysFilter } from './uniqueKeys.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { fromBin } from '../auth/users.ts';

// The five AI-import/device hash families were consolidated onto the one sparse
// unique multikey `uniqueKeys` index, so their per-crystal-field indexes no
// longer exist. Two MongoDB rules make the lookup and upsert shapes load
// bearing, and both were verified against a live MongoDB 8 replica set:
//
//  1. `$or` is unioned only when EVERY branch is indexed. Adding a
//     `crystal.<field>` fallback arm alongside the indexed `uniqueKeys` arm
//     downgrades the whole query to a COLLSCAN of `things` — measured at 50,001
//     docs examined vs 1 on a 50k-row collection, on paths that run once per
//     synced live event, message segment, command and approval.
//  2. An upsert seeds the new document from its filter's equality fields, so a
//     `{ uniqueKeys: <BinData> }` filter puts a SCALAR there. `$addToSet` then
//     fails with "Cannot apply $addToSet to non-array field". The key must ride
//     `$setOnInsert` instead.

test('lookups are a single indexed uniqueKeys predicate, never an $or', () => {
	const one = thingUniqueKeyFilter('externalMessageKey', 'hash-1');
	assert.deepEqual(Object.keys(one), ['uniqueKeys']);
	assert.equal(fromBin(one.uniqueKeys as any), 'externalMessageKey:hash-1');

	const many = thingUniqueKeysFilter('deviceUniqueKey', ['a', 'b']);
	assert.deepEqual(Object.keys(many), ['uniqueKeys']);
	assert.deepEqual((many.uniqueKeys as any).$in.map(fromBin), ['deviceUniqueKey:a', 'deviceUniqueKey:b']);

	// A crystal fallback arm would be unindexed; nothing may reintroduce one.
	for (const filter of [one, many]) assert.equal(JSON.stringify(filter).includes('crystal'), false);
	for (const filter of [one, many]) assert.equal('$or' in filter, false);
});

test('domain namespacing keeps otherwise-identical hashes disjoint', () => {
	assert.notDeepEqual(thingUniqueKey('aiConnectionKey', 'same'), thingUniqueKey('externalConversationKey', 'same'));
	assert.equal(fromBin(thingUniqueKey('deviceUniqueKey', 'k')), 'deviceUniqueKey:k');
});

test('key lists dedupe and drop empty values before they reach the unique index', () => {
	assert.deepEqual(thingUniqueKeys('deviceUniqueKey', ['a', 'a', '', 'b']).map(fromBin), [
		'deviceUniqueKey:a',
		'deviceUniqueKey:b'
	]);
});

test('no upsert call site combines the equality filter with $addToSet on uniqueKeys', () => {
	// Guards rule 2 above. The failure only surfaces on the INSERT branch of an
	// upsert against a real server, so fake-collection unit tests cannot catch
	// it; pin the shape at the source instead.
	for (const path of ['../devices/deviceLiveAi.ts', '../messenger/aiConnections.ts']) {
		const source = readFileSync(new URL(path, import.meta.url), 'utf8');
		assert.equal(
			source.includes('$addToSet: { uniqueKeys'),
			false,
			`${path} must stamp uniqueKeys via $setOnInsert, not $addToSet`
		);
	}
});
