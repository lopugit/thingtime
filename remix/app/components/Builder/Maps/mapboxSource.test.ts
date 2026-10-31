import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMapboxSourcePages } from './mapboxSource';

test('map Action sources drain cursor pages, preserve order, deduplicate updates and no-store', async () => {
	const calls: (string | undefined)[] = [];
	const result = await loadMapboxSourcePages(async (cursor) => {
		calls.push(cursor);
		return cursor ? { status: 'ok', cache: 'no-store', result: { items: [{ id: 'a', label: 'Updated' }, { id: 'b' }], points: [{ id: 'stop2' }], nextCursor: null } }
			: { status: 'ok', result: { route: { id: 'route' }, items: [{ id: 'a', label: 'Old' }], points: [{ id: 'stop1' }], nextCursor: 'page2' } };
	}, () => false);
	assert.deepEqual(calls, [undefined, 'page2']);
	assert.equal(result.cache, 'no-store');
	assert.deepEqual(result.result, { route: { id: 'route' }, items: [{ id: 'a', label: 'Updated' }, { id: 'b' }], points: [{ id: 'stop1' }, { id: 'stop2' }], nextCursor: null });
});

test('a map source is not truncated by collection page or item caps', async () => {
	const result = await loadMapboxSourcePages(async (cursor) => {
		const page = Number(cursor || 0);
		return { status: 'ok', result: { items: Array.from({ length: 50 }, (_, index) => ({ id: `${page}-${index}` })), nextCursor: page < 240 ? String(page + 1) : null } };
	}, () => false);
	assert.equal((result.result as any).items.length, 12050);
});

test('repeated cursors and malformed pages stop instead of looping or silently omitting records', async () => {
	await assert.rejects(loadMapboxSourcePages(async () => ({ status: 'ok', result: { items: [], nextCursor: 'again' } }), () => false), /repeated a cursor/);
	await assert.rejects(loadMapboxSourcePages(async () => ({ status: 'ok', result: { items: [{ title: 'No ID' }] } }), () => false), /stable IDs/);
	await assert.rejects(loadMapboxSourcePages(async () => ({ status: 'ok', result: { unexpected: [] } }), () => false), /list of records/);
});

test('identity cancellation and access refusal stop page reads without publishing partial results', async () => {
	let stale = false, calls = 0;
	await assert.rejects(loadMapboxSourcePages(async () => { calls++; stale = true; return { status: 'ok', result: { items: [{ id: 'private' }], nextCursor: 'next' } }; }, () => stale), /source changed/);
	assert.equal(calls, 1);
	let page = 0;
	const denied = await loadMapboxSourcePages(async () => ++page === 1 ? { status: 'ok', result: { items: [{ id: 'private' }], nextCursor: 'next' } } : { status: 'error', errorStatus: 403, error: 'Forbidden' }, () => false);
	assert.deepEqual(denied, { status: 'error', errorStatus: 403, error: 'Forbidden' });
});
