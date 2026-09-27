import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineHandlers } from './_timeline.tsx';
import { entryFixture, eventFixture } from '../../../../timeline/testFixtures.ts';

function setup() {
	const calls: any[] = [];
	const state = { owner: 'user-1', plane: 'home', limited: false };
	const handlers = createTimelineHandlers({
		user: async () => state.owner ? ({ id: state.owner } as any) : null,
		limit: async (...args: any[]) => { calls.push(['rate', ...args.slice(1)]); return { allowed: !state.limited, retryAfterSeconds: 5 } as any; },
		discovery: ownerId => ({ ownerId, dataPlane: state.plane, folderId: 'timeline-folder' }),
		page: async (ownerId, request) => { calls.push(['page', ownerId, request]); return { entries: [], nextBefore: null, nextAfter: null }; },
		entry: async (ownerId, eventId) => { calls.push(['entry', ownerId, eventId]); return eventId === 'saved' ? entryFixture(eventFixture('saved')) : null; },
		push: async (ownerId, event) => { calls.push(['push', ownerId, event]); return entryFixture(event); },
		branches: async (ownerId, thingId, before, limit) => { calls.push(['branches', ownerId, thingId, before, limit]); return { branches: [], nextBefore: null }; },
		branch: async (ownerId, command) => { calls.push(['branch', ownerId, command]); return { ok: true } as any; }
	});
	return { handlers, state, calls };
}
const request = (method = 'GET', query = 'ownerId=user-1&dataPlane=home&thingId=page-1', body?: unknown) => new Request(`https://thingtime.test/api/v1/timeline?${query}`, { method, ...(method !== 'GET' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? eventFixture()) } : {}) });

test('history discovery and reads require current account and data plane before touching storage', async () => {
	const h = setup();
	const discovery = await h.handlers.loader({ request: request('GET', 'ownerId=user-1') });
	assert.equal(discovery.status, 200); assert.equal((await discovery.json()).dataPlane, 'home');
	const page = await h.handlers.loader({ request: request() });
	assert.equal(page.status, 200); assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(h.calls.filter(call => call[0] === 'page').length, 1);
	h.state.owner = 'other';
	assert.equal((await h.handlers.loader({ request: request() })).status, 409);
	h.state.owner = 'user-1'; h.state.plane = 'custom';
	assert.equal((await h.handlers.loader({ request: request() })).status, 409);
	h.state.owner = '';
	assert.equal((await h.handlers.loader({ request: request() })).status, 401);
	assert.equal(h.calls.filter(call => call[0] === 'page').length, 1);
});

test('branch commands and pages have the same account, source, privacy and strict-input gates', async () => {
	const h = setup(); const query = 'ownerId=user-1&dataPlane=home&thingId=page-1&branches=1';
	const command = { command: 'create-branch', operationId: '177abf25-b322-4ac0-9707-a59c36e7bcd5', branchId: 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5', thingId: 'page-1', eventId: 'saved', expectedRevision: 0, name: 'Experiment' };
	const page = await h.handlers.loader({ request: request('GET', query) });
	assert.equal(page.status, 200); assert.equal(page.headers.get('Cache-Control'), 'private, no-store');
	assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 200);
	assert.equal(h.calls.filter(call => call[0] === 'branch').length, 1);
	for (const suffix of ['&limit=41', '&before=NaN', '&after=1']) assert.equal((await h.handlers.loader({ request: request('GET', query + suffix) })).status, 400);
	assert.equal((await h.handlers.action({ request: request('POST', query, { ...command, ownerId: 'other' }) })).status, 400);
	h.state.owner = 'other';
	assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 409);
	assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 409);
	h.state.owner = 'user-1'; h.state.plane = 'custom';
	assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 409);
	h.state.owner = '';
	assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 401);
	assert.equal(h.calls.filter(call => call[0] === 'branch').length, 1);
	assert.equal(h.calls.filter(call => call[0] === 'branches').length, 1);
});

test('an exact version read is private, scoped, and independent of the bounded page cache', async () => {
	const h = setup(); const query = 'ownerId=user-1&dataPlane=home&eventId=saved';
	const response = await h.handlers.loader({ request: request('GET', query) });
	assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	assert.equal((await response.json()).entry.event.id, 'saved');
	assert.deepEqual(h.calls.filter(call => call[0] === 'entry'), [['entry', 'user-1', 'saved']]);
	assert.equal((await h.handlers.loader({ request: request('GET', `${query}&thingId=another-thing`) })).status, 404);
	assert.equal((await h.handlers.loader({ request: request('GET', query.replace('eventId=saved', 'eventId=missing')) })).status, 404);
	const reads = h.calls.filter(call => call[0] === 'entry').length;
	for (const suffix of ['&branches=1', '&history=1', '&before=1', '&after=1', '&limit=1', '&thingId=']) assert.equal((await h.handlers.loader({ request: request('GET', query + suffix) })).status, 400);
	for (const invalid of [query.replace('eventId=saved', 'eventId='), query.replace('&dataPlane=home', '')]) assert.equal((await h.handlers.loader({ request: request('GET', invalid) })).status, 400);
	h.state.owner = 'other'; assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 409);
	h.state.owner = 'user-1'; h.state.plane = 'custom'; assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 409);
	h.state.owner = ''; assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 401);
	assert.equal(h.calls.filter(call => call[0] === 'entry').length, reads);
});

test('draft ingestion refuses forged provenance and revisions before a write and returns the canonical receipt', async () => {
	const h = setup();
	for (const patch of [{ ownerId: 'other' }, { actorId: 'other' }, { source: 'api' }, { mode: 'revision' }, { clientId: null }, { unknown: true }]) {
		assert.equal((await h.handlers.action({ request: request('POST', undefined, { ...eventFixture(), ...patch }) })).status, 400);
	}
	assert.equal(h.calls.filter(call => call[0] === 'push').length, 0);
	const response = await h.handlers.action({ request: request('POST') });
	assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	assert.equal((await response.json()).entry.event.id, eventFixture().id);
	assert.equal(h.calls.filter(call => call[0] === 'push').length, 1);
	assert.equal((await h.handlers.action({ request: request('DELETE') })).status, 405);
});

test('invalid cursors, missing data source, and excessive page sizes do not query history', async () => {
	const h = setup();
	for (const suffix of ['before=1&after=2', 'before=NaN', 'before=0', 'limit=500', 'limit=1.5', 'after=9007199254740991']) {
		assert.equal((await h.handlers.loader({ request: request('GET', `ownerId=user-1&dataPlane=home&thingId=page-1&${suffix}`) })).status, 400);
	}
	assert.equal((await h.handlers.loader({ request: request('GET', 'ownerId=user-1&thingId=page-1') })).status, 400);
	assert.equal((await h.handlers.action({ request: request('POST', 'ownerId=user-1') })).status, 400);
	assert.equal(h.calls.filter(call => ['page', 'push'].includes(call[0])).length, 0);
});
