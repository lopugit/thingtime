import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineHandlers } from './_timeline.tsx';
import { entryFixture, eventFixture } from '../../../../timeline/testFixtures.ts';
import { runWithMongoEndpoint, getActiveMongoEndpoint } from '../../../../api/utils/mongodb/endpoint.ts';
import { timelineDiscovery, timelineDataPlane } from '../../../../api/utils/timeline/service.ts';
import { StorageMutationError } from '../../../../api/utils/storage/storageCore.ts';
import { timelineNoteId, type TimelineNote } from '../../../../timeline/notes.ts';

const noteFixture = (operationId: string, author: 'owner' | 'lopu' = 'owner'): TimelineNote => ({ formatVersion: 1, id: timelineNoteId(operationId), ownerId: 'user-1', eventId: 'saved', thingId: 'page-1', author, text: author === 'owner' ? 'Renamed before review.' : 'The title changed.', createdAt: '2026-10-13T09:30:00.000Z' });

function setup() {
	const calls: any[] = [];
	const state = { owner: 'user-1', plane: 'home', limited: false, limitedExplain: false, kind: 'user', temporary: false };
	const handlers = createTimelineHandlers({
		user: async () => state.owner ? ({ id: state.owner, accountKind: state.kind, temporary: state.temporary } as any) : null,
		limit: async (...args: any[]) => { calls.push(['rate', ...args.slice(1)]); return { allowed: !state.limited && !(args[1] === 'timeline.explain' && state.limitedExplain), resetAt: new Date(Date.now() + 5000).toISOString() } as any; },
		note: async (ownerId, command, context) => { calls.push(['note', ownerId, command, context?.signal instanceof AbortSignal]); return command.command === 'remove-note' ? { ok: true, removed: true, noteId: command.noteId } : { ok: true, note: noteFixture(command.operationId, command.command === 'add-note' ? 'owner' : 'lopu') }; },
		notes: async (ownerId, eventIds) => { calls.push(['notes', ownerId, eventIds]); return eventIds.includes('saved') ? [noteFixture('177abf25-b322-4ac0-9707-a59c36e7bcd5')] : []; },
		discovery: ownerId => ({ ownerId, dataPlane: state.plane, folderId: 'timeline-folder' }),
		componentBindings: async (ownerId, eventId) => { calls.push(['components', ownerId, eventId]); return eventId === 'saved' ? { eventId, entries: [] } : null; },
		page: async (ownerId, request) => { calls.push(['page', ownerId, request]); return { entries: [], nextBefore: null, nextAfter: null }; },
		entry: async (ownerId, eventId) => { calls.push(['entry', ownerId, eventId]); return eventId === 'saved' ? entryFixture(eventFixture('saved')) : null; },
		push: async (ownerId, event) => { calls.push(['push', ownerId, event]); return entryFixture(event); },
		branchHead: async (ownerId, branchId, thingId) => { calls.push(['branchHead', ownerId, branchId, thingId]); return thingId === 'page-1' ? ({ branch: { id: branchId, ownerId }, head: { thingId, eventId: 'saved', revision: 3 } } as any) : null; },
		branches: async (ownerId, thingId, before, limit) => { calls.push(['branches', ownerId, thingId, before, limit]); return { branches: [], nextBefore: null }; },
		branchCheckout: async (ownerId, command) => { calls.push(['branchCheckout', ownerId, command]); return { ok: true, checkout: {} } as any; },
		branchMerge: async (ownerId, command) => { calls.push(['branchMerge', ownerId, command]); return { ok: true, preview: {} } as any; },
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

test('explicit home requests leave custom selection only within their async operation and keep every authorization fence', async () => {
	const previous = process.env.MONGODB_CONNECTION_STRING;
	process.env.MONGODB_CONNECTION_STRING = 'mongodb://home.test/thingtime';
	try {
		const selection = { url: 'mongodb://custom.test/other', savedId: null };
		let owner: string | null = 'user-1'; const reads: string[] = []; const writes: string[] = [];
		const handlers = createTimelineHandlers({ user: async () => owner ? ({ id: owner } as any) : null,
			limit: async () => ({ allowed: true } as any), discovery: timelineDiscovery,
			page: async () => { await Promise.resolve(); reads.push(timelineDataPlane()); return { entries: [], nextBefore: null, nextAfter: null }; },
			push: async (_owner, event) => { await Promise.resolve(); writes.push(timelineDataPlane()); return entryFixture(event); }
		});
		await runWithMongoEndpoint(selection, async () => {
			const custom = timelineDataPlane(); assert.match(custom, /^custom-/);
			const home = 'ownerId=user-1&dataPlane=home&thingId=page-1&storage=home';
			const [homeRead, selectedRead] = await Promise.all([
				handlers.loader({ request: request('GET', home) }),
				handlers.loader({ request: request('GET', `ownerId=user-1&dataPlane=${custom}&thingId=page-1`) })
			]);
			assert.equal(homeRead.status, 200); assert.equal(selectedRead.status, 200);
			assert.deepEqual(new Set(reads), new Set(['home', custom]));
			assert.equal(getActiveMongoEndpoint(), selection);
			assert.equal((await handlers.action({ request: request('POST', home) })).status, 200);
			assert.deepEqual(writes, ['home']); assert.equal(timelineDataPlane(), custom);
			for (const query of [home.replace('&storage=home', ''), home.replace('dataPlane=home', `dataPlane=${custom}`)]) assert.equal((await handlers.loader({ request: request('GET', query) })).status, 409);
			for (const query of [home + '&storage=selected', home.replace('storage=home', 'storage=other')]) assert.equal((await handlers.loader({ request: request('GET', query) })).status, 400);
			owner = 'other'; assert.equal((await handlers.action({ request: request('POST', home) })).status, 409);
			owner = null; assert.equal((await handlers.loader({ request: request('GET', home) })).status, 401);
			assert.equal(reads.length, 2); assert.equal(writes.length, 1);
		});
		assert.equal(getActiveMongoEndpoint(), null);
		assert.equal(runWithMongoEndpoint({ url: process.env.MONGODB_CONNECTION_STRING, savedId: null }, timelineDataPlane), 'home');
	} finally { if (previous === undefined) delete process.env.MONGODB_CONNECTION_STRING; else process.env.MONGODB_CONNECTION_STRING = previous; }
});


test('named-branch preview is read-only and uses the same private actor and source fences', async () => {
 const h = setup(); const query = 'ownerId=user-1&dataPlane=home';
 const command = { command: 'preview-branch-merge', branchId: 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5', thingId: 'page-1', eventId: 'saved', expectedHeadId: 'head', expectedRevision: 1, choices: {} };
 const result = await h.handlers.action({ request: request('POST', query, command) });
 assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
 assert.deepEqual(h.calls.filter(call => ['push', 'branch', 'branchMerge'].includes(call[0])), [['branchMerge', 'user-1', command]]);
 assert.equal((await h.handlers.action({ request: request('POST', query, { ...command, operationId: 'extra' }) })).status, 400);
 h.state.owner = ''; assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 401);
 h.state.owner = 'other'; assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 409);
 h.state.owner = 'user-1'; h.state.plane = 'custom'; assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 409);
 assert.equal(h.calls.filter(call => call[0] === 'branchMerge').length, 1);
});


test('branch comparison replies are capped before sending an oversized preview', async () => {
 const command = { command: 'preview-branch-merge', branchId: 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5', thingId: 'page-1', eventId: 'saved', expectedHeadId: 'head', expectedRevision: 1, choices: {} };
 const handlers = createTimelineHandlers({ user: async () => ({ id: 'user-1' } as any), limit: async () => ({ allowed: true } as any), discovery: ownerId => ({ ownerId, dataPlane: 'home', folderId: 'timeline' }), branchMerge: async () => ({ ok: true, preview: { content: 'x'.repeat(4 * 1024 * 1024) } } as any) });
 const result = await handlers.action({ request: request('POST', 'ownerId=user-1&dataPlane=home', command) });
 assert.equal(result.status, 413); assert.equal(result.headers.get('Cache-Control'), 'private, no-store'); assert.match((await result.json()).error, /too large/);
});


test('branch checkout uses private actor/source gates and never dispatches a mutation', async () => {
 const h = setup(); const query = 'ownerId=user-1&dataPlane=home';
 const command = { command: 'checkout-branch', branchId: 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5', thingId: 'page-1', expectedHeadId: 'head', expectedRevision: 1 };
 const result = await h.handlers.action({ request: request('POST', query, command) });
 assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
 assert.deepEqual(h.calls.filter(call => call[0] !== 'rate'), [['branchCheckout', 'user-1', command]]);
 assert.equal((await h.handlers.action({ request: request('POST', query, { ...command, ownerId: 'other' }) })).status, 400);
 h.state.owner = ''; assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 401);
 h.state.owner = 'other'; assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 409);
 h.state.owner = 'user-1'; h.state.plane = 'custom'; assert.equal((await h.handlers.action({ request: request('POST', query, command) })).status, 409);
 assert.equal(h.calls.filter(call => call[0] === 'branchCheckout').length, 1);
 const oversized = createTimelineHandlers({ user: async () => ({ id: 'user-1' } as any), limit: async () => ({ allowed: true } as any), discovery: ownerId => ({ ownerId, dataPlane: 'home', folderId: 'timeline' }), branchCheckout: async () => ({ ok: true, checkout: { content: 'x'.repeat(4 * 1024 * 1024) } } as any) });
 assert.equal((await oversized.action({ request: request('POST', query, command) })).status, 413);
});


test('direct named branch lookup is private, exact, and refuses ambiguous selectors before reading', async () => {
 const h = setup();
 const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
 const query = `ownerId=user-1&dataPlane=home&thingId=page-1&branchId=${branchId}`;
 const result = await h.handlers.loader({ request: request('GET', query) });
 assert.equal(result.status, 200); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
 assert.equal((await result.json()).head.revision, 3);
 assert.deepEqual(h.calls.filter(call => call[0] === 'branchHead'), [['branchHead', 'user-1', branchId, 'page-1']]);
 assert.equal((await h.handlers.loader({ request: request('GET', query.replace('page-1', 'missing')) })).status, 404);
 const reads = h.calls.filter(call => call[0] === 'branchHead').length;
 for (const suffix of ['&branches=1', '&history=1', '&eventId=saved', '&before=1', '&after=1', '&limit=1', '&thingId=page-1', `&branchId=${branchId}`, '&ownerId=user-1', '&dataPlane=home', '&unknown=1', '&storage=home&storage=selected']) {
  assert.equal((await h.handlers.loader({ request: request('GET', query + suffix) })).status, 400, suffix);
 }
 for (const invalid of [query.replace('&dataPlane=home', ''), query.replace('&thingId=page-1', ''), query.replace('page-1', ''), query.replace(branchId, 'main'), query.replace(branchId, ''), query.replace('page-1', 'x'.repeat(201))]) {
  assert.equal((await h.handlers.loader({ request: request('GET', invalid) })).status, 400, invalid);
 }
 h.state.owner = 'other'; assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 409);
 h.state.owner = 'user-1'; h.state.plane = 'custom'; assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 409);
 h.state.plane = 'home'; h.state.limited = true; assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 429);
 h.state.owner = ''; assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 401);
 assert.equal(h.calls.filter(call => call[0] === 'branchHead').length, reads);
 assert.equal(h.calls.filter(call => ['branches', 'page', 'entry', 'branch', 'push'].includes(call[0])).length, 0);
});


test('recorded component batch requires one exact owner/source/event and refuses ambiguous or paging selectors', async () => {
 const h = setup(); const query = 'ownerId=user-1&dataPlane=home&eventId=saved&components=1';
 const read = (suffix = '') => h.handlers.loader({ request: request('GET', query + suffix) });
 const response = await read(); assert.equal(response.status, 200);
 assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
 assert.deepEqual(await response.json(), { ok: true, eventId: 'saved', entries: [] });
 for (const suffix of ['&thingId=page-1', '&eventId=other', '&components=1', '&ownerId=user-1', '&dataPlane=home', '&branchId=branch-x', '&history=1', '&before=1', '&limit=40', '&unknown=1']) assert.equal((await read(suffix)).status, 400);
 assert.equal((await h.handlers.loader({ request: request('GET', query.replace('eventId=saved', 'eventId=missing')) })).status, 404);
 h.state.plane = 'custom'; assert.equal((await read()).status, 409);
 h.state.plane = 'home'; h.state.owner = 'other'; assert.equal((await read()).status, 409);
 h.state.owner = ''; assert.equal((await read()).status, 401);
 assert.equal(h.calls.filter(item => item[0] === 'components').length, 2);
});

test('related history refuses ambiguous selectors and missing cursor membership before resolving dependencies', async () => {
 const calls: any[] = []; let owner = 'user-1';
 const handlers = createTimelineHandlers({ user: async () => owner ? ({ id: owner } as any) : null,
  discovery: id => ({ ownerId: id, dataPlane: 'home', folderId: 'timeline' }), limit: async () => ({ allowed: true } as any),
  relatedPage: async (...args) => { calls.push(args); return { entries: [], nextBefore: null, nextAfter: null, related: { rootId: 'page', thingIds: ['page'], revision: 'a'.repeat(64), sharedCount: 0 } }; }
 });
 const query = 'ownerId=user-1&dataPlane=home&thingId=page&related=1';
 const read = (suffix = '') => handlers.loader({ request: request('GET', query + suffix) });
 const first = await read(); assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'private, no-store');
 for (const suffix of ['&history=1', '&eventId=x', '&components=1', '&branches=1', '&branchId=x', '&related=1', '&thingIds=foreign', '&before=10', '&relatedRevision=bad', '&limit=41', '&after=NaN']) assert.equal((await read(suffix)).status, 400, suffix);
 assert.equal(calls.length, 1);
 const revision = 'a'.repeat(64);
 assert.equal((await read(`&after=10&relatedRevision=${revision}`)).status, 200);
 assert.equal(calls[1][1].relatedRevision, revision);
 owner = 'other'; assert.equal((await read()).status, 409);
 owner = ''; assert.equal((await read()).status, 401);
 assert.equal(calls.length, 2);
});

test('note commands reach the note service with the request signal, behind the same account, source and strict-input gates', async () => {
	const h = setup(); const query = 'ownerId=user-1&dataPlane=home';
	const add = { command: 'add-note', operationId: '177abf25-b322-4ac0-9707-a59c36e7bcd5', eventId: 'saved', thingId: 'page-1', text: 'Renamed before review.' };
	const remove = { command: 'remove-note', operationId: '277abf25-b322-4ac0-9707-a59c36e7bcd5', noteId: 'note-177abf25-b322-4ac0-9707-a59c36e7bcd5' };
	const added = await h.handlers.action({ request: request('POST', query, add) });
	assert.equal(added.status, 200); assert.equal(added.headers.get('Cache-Control'), 'private, no-store');
	assert.deepEqual(await added.json(), { ok: true, note: noteFixture(add.operationId) });
	const removed = await h.handlers.action({ request: request('POST', query, remove) });
	assert.equal(removed.status, 200); assert.deepEqual(await removed.json(), { ok: true, removed: true, noteId: remove.noteId });
	assert.deepEqual(h.calls.filter(call => call[0] === 'note'), [['note', 'user-1', add, true], ['note', 'user-1', remove, true]]);
	assert.deepEqual(h.calls.filter(call => call[0] === 'rate').map(call => call[1]), ['timeline.write', 'timeline.write'], 'owner notes use the ordinary write allowance only');
	for (const invalid of [{ ...add, operationId: 'nope' }, { ...add, text: '' }, { ...add, text: 'x'.repeat(2001) }, { ...add, ownerId: 'other' }, { ...add, eventId: '' }, { ...remove, noteId: 'saved' }, { ...remove, eventId: 'saved' }, { command: 'add-note' }])
		assert.equal((await h.handlers.action({ request: request('POST', query, invalid) })).status, 400, JSON.stringify(invalid));
	assert.equal(h.calls.filter(call => ['note', 'push', 'version', 'branch'].includes(call[0])).length, 2);
	assert.equal((await h.handlers.action({ request: request('POST', 'ownerId=user-1', add) })).status, 400);
	h.state.limited = true; assert.equal((await h.handlers.action({ request: request('POST', query, add) })).status, 429); h.state.limited = false;
	h.state.owner = 'other'; assert.equal((await h.handlers.action({ request: request('POST', query, add) })).status, 409);
	h.state.owner = 'user-1'; h.state.plane = 'custom'; assert.equal((await h.handlers.action({ request: request('POST', query, add) })).status, 409);
	h.state.owner = ''; assert.equal((await h.handlers.action({ request: request('POST', query, add) })).status, 401);
	assert.equal(h.calls.filter(call => call[0] === 'note').length, 2);
	const refusing = createTimelineHandlers({ user: async () => ({ id: 'user-1', accountKind: 'user', temporary: false } as any), limit: async () => ({ allowed: true } as any), discovery: ownerId => ({ ownerId, dataPlane: 'home', folderId: 'timeline' }),
		note: async () => { throw new StorageMutationError(413, 'storage_invariant', 'This change already has 8 notes. Remove one to add another.'); } });
	const full = await refusing.action({ request: request('POST', query, add) });
	assert.equal(full.status, 413); assert.equal(full.headers.get('Cache-Control'), 'private, no-store');
	assert.deepEqual(await full.json(), { ok: false, error: 'This change already has 8 notes. Remove one to add another.', code: 'storage_invariant' });
});

test('asking Lopu to explain needs a full account and its own bounded allowance before the note service runs', async () => {
	const h = setup(); const query = 'ownerId=user-1&dataPlane=home';
	const explain = { command: 'explain-change', operationId: '377abf25-b322-4ac0-9707-a59c36e7bcd5', eventId: 'saved', thingId: 'page-1' };
	const explained = await h.handlers.action({ request: request('POST', query, explain) });
	assert.equal(explained.status, 200); assert.equal(explained.headers.get('Cache-Control'), 'private, no-store');
	assert.deepEqual(await explained.json(), { ok: true, note: noteFixture(explain.operationId, 'lopu') });
	assert.deepEqual(h.calls.filter(call => call[0] === 'rate').map(call => call.slice(1)), [['timeline.write', 'user:user-1', { failClosed: true }], ['timeline.explain', 'user:user-1', { failClosed: true }]]);
	assert.deepEqual(h.calls.filter(call => call[0] === 'note'), [['note', 'user-1', explain, true]]);
	h.state.limitedExplain = true;
	const busy = await h.handlers.action({ request: request('POST', query, explain) });
	assert.equal(busy.status, 429); assert.ok(Number(busy.headers.get('Retry-After')) >= 1); assert.equal(busy.headers.get('Cache-Control'), 'private, no-store');
	h.state.limitedExplain = false;
	for (const patch of [{ kind: 'app' }, { kind: 'sandbox' }, { temporary: true }]) {
		Object.assign(h.state, { kind: 'user', temporary: false }, patch);
		const refused = await h.handlers.action({ request: request('POST', query, explain) });
		assert.equal(refused.status, 401, JSON.stringify(patch)); assert.match((await refused.json()).error, /full account/);
	}
	Object.assign(h.state, { kind: 'user', temporary: false });
	assert.equal(h.calls.filter(call => call[0] === 'note').length, 1);
	assert.equal(h.calls.filter(call => call[0] === 'rate' && call[1] === 'timeline.explain').length, 2, 'the account gate runs before the Lopu allowance is spent');
	assert.equal((await h.handlers.action({ request: request('POST', query, { ...explain, text: 'not allowed' }) })).status, 400);
	h.state.owner = 'other'; assert.equal((await h.handlers.action({ request: request('POST', query, explain) })).status, 409);
	h.state.owner = ''; assert.equal((await h.handlers.action({ request: request('POST', query, explain) })).status, 401);
	assert.equal(h.calls.filter(call => call[0] === 'note').length, 1);
	const unavailable = createTimelineHandlers({ user: async () => ({ id: 'user-1', accountKind: 'user', temporary: false } as any), limit: async () => ({ allowed: true } as any), discovery: ownerId => ({ ownerId, dataPlane: 'home', folderId: 'timeline' }),
		note: async () => { throw new StorageMutationError(503, 'storage_invariant', 'Lopu could not explain this change right now. Try again in a moment.'); } });
	const down = await unavailable.action({ request: request('POST', query, explain) });
	assert.equal(down.status, 503); assert.match((await down.json()).error, /could not explain this change right now/);
});

test('an exact version read returns its notes beside the entry and never looks notes up for a missing version', async () => {
	const h = setup(); const query = 'ownerId=user-1&dataPlane=home&eventId=saved';
	const response = await h.handlers.loader({ request: request('GET', query) });
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.entry.event.id, 'saved'); assert.deepEqual(body.notes, [noteFixture('177abf25-b322-4ac0-9707-a59c36e7bcd5')]);
	assert.deepEqual(h.calls.filter(call => call[0] === 'notes'), [['notes', 'user-1', ['saved']]]);
	assert.equal((await h.handlers.loader({ request: request('GET', query.replace('eventId=saved', 'eventId=missing')) })).status, 404);
	assert.equal((await h.handlers.loader({ request: request('GET', `${query}&thingId=another-thing`) })).status, 404);
	h.state.owner = 'other'; assert.equal((await h.handlers.loader({ request: request('GET', query) })).status, 409);
	assert.equal(h.calls.filter(call => call[0] === 'notes').length, 1);
});
