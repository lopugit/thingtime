import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTemplate } from '../../ComponentsLibrary/componentTemplate';
import { usesMapPointsSource } from '../../../schemas/authoredControls';
import { loadMapboxPointPages, loadMapboxSourcePages, mapboxPointsSource } from './mapboxSource';

test('points sources retain their interval and status options and accept only literal Actions', () => {
	const source = { action: 'map-points', itemsPath: 'payload.markers', cursorPath: 'payload.after', cursorInput: 'after', itemKey: 'key',
		inputs: { selection: '{query.selected}' }, refresh: 'interval', intervalMs: 30000, showError: false };
	const template = { tag: 'tt-mapbox', props: { pointsSource: source } };
	const rendered = resolveTemplate(template, { query: { selected: 'previous' } }) as typeof template;
	const parsed = mapboxPointsSource(rendered.props.pointsSource, { query: { selected: 'current' } });
	assert.equal(parsed?.action, 'map-points');
	assert.equal(parsed?.refresh, 'interval');
	assert.equal(parsed?.intervalMs, 30000);
	assert.equal(parsed?.showError, false);
	assert.deepEqual(parsed?.inputs, { selection: 'current' });
	assert.equal(usesMapPointsSource({ blocks: [template] }), true);
	assert.equal(usesMapPointsSource({ tag: 'div', props: { pointsSource: source } }), false);
	assert.throws(() => mapboxPointsSource({ ...source, action: '{query.action}' }, { query: { action: 'foreign' } }), /saved map points Action/);
	const dynamic = resolveTemplate({ tag: 'tt-mapbox', props: { pointsSource: { ...source, action: '{query.action}' } } },
		{ query: { action: 'foreign' } }) as typeof template;
	assert.equal(dynamic.props.pointsSource, undefined);
	assert.throws(() => mapboxPointsSource({ ...source, refresh: 'live' }, {}), /source options/);
});

test('additional points drain authored cursor paths and discard partial data on later failure', async () => {
	const source = mapboxPointsSource({ action: 'map-points', itemsPath: 'payload.markers', cursorPath: 'payload.after', cursorInput: 'after', itemKey: 'key' }, {})!;
	const calls: (string | undefined)[] = [];
	const first = { status: 'ok', result: { payload: { markers: [{ key: 'a', label: 'Old' }], after: 'page2' } } };
	const result = await loadMapboxPointPages(source, async cursor => {
		calls.push(cursor);
		return cursor ? { status: 'ok', cache: 'no-store', result: { payload: { markers: [{ key: 'a', label: 'Current' }, { key: 'b' }] } } } : first;
	}, () => false);
	assert.deepEqual(calls, [undefined, 'page2']);
	assert.deepEqual(result, { status: 'ok', cache: 'no-store', result: [{ key: 'a', label: 'Current' }, { key: 'b' }] });
	const failure = { status: 'error', errorStatus: 403, error: 'Forbidden' };
	assert.deepEqual(await loadMapboxPointPages(source, async cursor => cursor ? failure : first, () => false), failure);
	await assert.rejects(loadMapboxPointPages(source, async () => first, () => false), /repeated a cursor/);
	let stale = false;
	await assert.rejects(loadMapboxPointPages(source, async () => { stale = true; return first; }, () => stale), /source changed/);
});

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

test('publishes validated pages progressively and never publishes a rejected page', async () => {
 const published: unknown[] = [];
 let calls = 0;
 const denied = await loadMapboxSourcePages(async () => ++calls === 1
  ? { status: 'ok', result: { items: [{ id: 'a' }], nextCursor: 'next' } }
  : { status: 'error', errorStatus: 403, error: 'Forbidden' }, () => false, undefined, page => published.push(page.result));
 assert.equal(published.length, 1);
 assert.deepEqual((published[0] as any).items, [{ id: 'a' }]);
 assert.equal(denied.status, 'error');
});
