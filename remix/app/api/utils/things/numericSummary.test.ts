import assert from 'node:assert/strict';
import test from 'node:test';
import { readThingNumericSummary } from './numericSummary';

const params = () => new URLSearchParams({ thingtime: 'data', schemaId: 'stop-schema', parentId: 'route', maxCrystalField: 'rank', excludeArchived: 'true' });

test('summary walks all authorized pages, including empty pages, and skips archived or nonnumeric fields', async () => {
	const cursors: (string | null)[] = [];
	const summary = await readThingNumericSummary(params(), 'user', async (query) => {
		const { cursor } = query;
		cursors.push(cursor);
		assert.deepEqual(query, { thingtime: ['data'], schemaId: 'stop-schema', parentId: 'route', cursor, limit: 50 });
		if (!cursor) return { ok: true, things: [{ crystal: { rank: -5 } }, { crystal: { rank: 99, archived: true } }], nextCursor: 'two' };
		if (cursor === 'two') return { ok: true, things: [], nextCursor: 'three' };
		return {
			ok: true,
			things: [
				{ crystal: { rank: 0 } }, { crystal: { rank: '90' } }, { crystal: { rank: Infinity } }, { crystal: { rank: NaN } },
				{ crystal: Object.create({ rank: 95 }) }
			],
			nextCursor: null
		};
	});
	assert.deepEqual(cursors, [null, 'two', 'three']);
	assert.deepEqual(summary, { ok: true, summary: { max: 0 } });
});

test('summary distinguishes empty from negative and includes archived rows when requested', async () => {
	const empty = await readThingNumericSummary(params(), 'pat', async () => ({ ok: true, things: [], nextCursor: null }));
	assert.deepEqual(empty, { ok: true, summary: { max: null } });
	const query = params();
	query.set('excludeArchived', 'false');
	const negative = await readThingNumericSummary(query, 'pat', async () => ({
		ok: true, things: [{ crystal: { rank: -5 } }, { crystal: { rank: -2, archived: true } }], nextCursor: null
	}));
	assert.deepEqual(negative, { ok: true, summary: { max: -2 } });
});

test('later failure, repeated cursor and cancellation never publish a partial maximum', async () => {
	const first = { ok: true as const, things: [{ crystal: { rank: 2 } }], nextCursor: 'two' };
	const fail = { ok: false as const, status: 403, error: 'Not available' };
	assert.deepEqual(await readThingNumericSummary(params(), 'user', async ({ cursor }) => cursor ? fail : first), fail);
	const cycle = await readThingNumericSummary(params(), 'user', async ({ cursor }) => ({
		...first, nextCursor: cursor === 'two' ? 'three' : 'two'
	}));
	assert.equal(cycle.ok === false && cycle.status, 503);
	const controller = new AbortController();
	const aborted = await readThingNumericSummary(params(), 'user', async ({ cursor }) => {
		if (cursor) controller.abort();
		return first;
	}, controller.signal);
	assert.equal(aborted.ok === false && aborted.status, 499);
});

test('summary rejects unsupported actors and query combinations before reading', async () => {
	const unreadable = async () => assert.fail('unauthorized or malformed summary must not list records');
	for (const [actor, status] of [['app', 403], ['anonymous', 401]] as const) {
		const result = await readThingNumericSummary(params(), actor, unreadable);
		assert.equal(result.ok === false && result.status, status);
	}
	for (const key of ['id', 'target', 'folder', 'appId', 'builderApp', 'sharedRoot', 'archive', 'commentProjection', 'commentSort', 'cursor', 'limit', 'key']) {
		const query = params();
		query.set(key, '');
		const result = await readThingNumericSummary(query, 'user', unreadable);
		assert.equal(result.ok === false && result.status, 400, key);
	}
	for (const [key, value] of [
		['maxCrystalField', '__proto__'], ['maxCrystalField', 'prototype'], ['maxCrystalField', 'constructor'],
		['maxCrystalField', '$rank'], ['maxCrystalField', 'rank.x'], ['thingtime', 'data,post'],
		['excludeArchived', 'yes'], ['schemaId', ''], ['parentId', '']
	]) {
		const query = params();
		query.set(key, value);
		const result = await readThingNumericSummary(query, 'user', unreadable);
		assert.equal(result.ok === false && result.status, 400, key);
	}
	const duplicated = params();
	duplicated.append('maxCrystalField', 'other');
	const result = await readThingNumericSummary(duplicated, 'user', unreadable);
	assert.equal(result.ok === false && result.status, 400);
});
