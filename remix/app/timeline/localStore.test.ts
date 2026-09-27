import assert from 'node:assert/strict';
import test from 'node:test';
import { TimelineLocalStore, timelineLocalIndex, type TimelineLocalBackend, type LocalTimelineRow, type TimelineLocalSelection } from './localStore.ts';
import { TimelineSync, type TimelineTransport } from './sync.ts';
import { entryFixture, eventFixture } from './testFixtures.ts';

// This exercises the storage/sync protocol. Real IndexedDB transaction and
// reload behavior is covered separately in browser acceptance.
class MemoryBackend implements TimelineLocalBackend {
	rows = new Map<string, LocalTimelineRow>();
	async read(scope: string, selection?: TimelineLocalSelection) { return structuredClone([...this.rows.values()].filter(row => row.scope === scope && (!selection?.thingId || row.event.thingId === selection.thingId) && (!selection?.status || row.status === selection.status) && (!selection?.draftKey || row.draftKey === selection.draftKey))); }
	async change(scope: string, ids: string[], update: Parameters<TimelineLocalBackend['change']>[2]) {
		const rows = structuredClone([...this.rows.values()].filter(row => row.scope === scope));
		const changes = update(rows.map(timelineLocalIndex), rows.filter(row => ids.includes(row.event.id)));
		for (const row of changes.put) this.rows.set(JSON.stringify([scope, row.event.id]), structuredClone(row));
		for (const id of changes.remove) this.rows.delete(JSON.stringify([scope, id]));
		for (const touch of changes.touch ?? []) { const row = this.rows.get(JSON.stringify([scope, touch.id])); if (row) { row.accessedAt = touch.accessedAt; if ('draftKey' in touch) row.draftKey = touch.draftKey; } }
	}
}
const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.com', dataPlane: 'home' };

test('reloading preserves pending edits; accepting twice deduplicates without mutating the event', async () => {
	const backend = new MemoryBackend();
	const local = new TimelineLocalStore(scope, backend);
	const event = eventFixture();
	await local.enqueue(event);
	event.label = 'mutated by caller';
	const reopened = new TimelineLocalStore(scope, backend);
	assert.equal((await reopened.pending())[0].label, 'Add page');
	await reopened.accept([entryFixture(eventFixture())]);
	await reopened.accept([entryFixture(eventFixture())]);
	await reopened.enqueue(eventFixture());
	assert.equal((await reopened.pending()).length, 0);
	assert.equal((await reopened.forThing('page-1')).length, 1);
	await assert.rejects(reopened.enqueue(event), /identity/);
	await assert.rejects(reopened.accept([entryFixture(eventFixture(), 2)]), /receipt identity/);
});

test('eviction removes acknowledged cache only; API history can be fetched back later', async () => {
	const backend = new MemoryBackend();
	const local = new TimelineLocalStore(scope, backend);
	await local.enqueue(eventFixture('pending'));
	const api = eventFixture('api-event', { source: 'api', clientId: null, mode: 'revision' });
	await local.accept([entryFixture(api)]);
	await local.prune(0, 0);
	assert.deepEqual((await local.pending()).map(event => event.id), ['pending']);
	assert.equal((await local.forThing('page-1')).length, 1);
	await local.accept([entryFixture(api)]);
	assert.equal((await local.forThing('page-1')).length, 2);
});

test('account, origin and data-plane changes cannot adopt another pending queue', async () => {
	const backend = new MemoryBackend();
	const callerScope = { ...scope };
	const local = new TimelineLocalStore(callerScope, backend);
	callerScope.ownerId = 'user-2';
	await local.enqueue(eventFixture());
	for (const other of [{ ...scope, ownerId: 'user-2' }, { ...scope, apiOrigin: 'https://preview.thingtime.com' }, { ...scope, dataPlane: 'custom' }]) {
		const isolated = new TimelineLocalStore(other, backend);
		assert.equal((await isolated.pending()).length, 0);
		assert.equal((await isolated.forThing('page-1')).length, 0);
	}
	await assert.rejects(local.accept([entryFixture(eventFixture('x', { ownerId: 'user-2' }))]), /another account/);
});

test('parent-first pushes ignore clock skew and lost acknowledgments retry immutable identities', async () => {
	const local = new TimelineLocalStore(scope, new MemoryBackend());
	await local.enqueue(eventFixture('child', { parentIds: ['parent'], occurredAt: '2000-01-01T00:00:00.000Z' }));
	await local.enqueue(eventFixture('parent'));
	const calls: string[] = [];
	const committed = new Map<string, ReturnType<typeof entryFixture>>();
	let loseReply = true;
	const sync = new TimelineSync(local, {
		push: async event => {
			calls.push(event.id);
			if (!committed.has(event.id)) committed.set(event.id, entryFixture(event, committed.size + 1));
			if (loseReply) { loseReply = false; throw new Error('connection lost after commit'); }
			return committed.get(event.id)!;
		}, page: async () => { throw new Error('not needed'); }
	});
	await assert.rejects(sync.pushPending(), /connection lost/);
	assert.equal((await local.pending()).length, 2);
	assert.equal(await sync.pushPending(), 2);
	assert.deepEqual(calls, ['parent', 'parent', 'child']);
	assert.equal(committed.size, 2);
	assert.equal((await local.pending()).length, 0);
});

test('an in-flight acknowledgment after account switch leaves the old queue recoverable', async () => {
	const local = new TimelineLocalStore(scope, new MemoryBackend());
	await local.enqueue(eventFixture());
	let reply!: (entry: ReturnType<typeof entryFixture>) => void;
	let started!: () => void;
	const didStart = new Promise<void>(resolve => { started = resolve; });
	const sync = new TimelineSync(local, { push: async () => { started(); return new Promise(resolve => { reply = resolve; }); }, page: async () => { throw new Error('unused'); } });
	const push = sync.pushPending();
	await didStart;
	sync.stop();
	reply(entryFixture(eventFixture()));
	await assert.rejects(push, /stopped/);
	assert.equal((await local.pending()).length, 1);
});

test('pending dependency versions sync before the page that references them', async () => {
	const store = new TimelineLocalStore(scope, new MemoryBackend());
	await store.enqueue(eventFixture('page', { dependencies: [{ thingId: 'component', eventId: 'component-version' }] }));
	await store.enqueue(eventFixture('component-version', { thingId: 'component' }));
	assert.deepEqual((await store.pending()).map(event => event.id), ['component-version', 'page']);
});

test('simultaneous history subscribers share a page request, then a later refresh fetches anew', async () => {
	const store = new TimelineLocalStore(scope, new MemoryBackend());
	let calls = 0; let reply!: (page: any) => void;
	const sync = new TimelineSync(store, { push: async () => { throw new Error('unused'); }, page: async () => { calls++; return new Promise(resolve => { reply = resolve; }); } });
	const a = sync.page('page-1'); const b = sync.page('page-1'); assert.equal(a, b); assert.equal(calls, 1);
	reply({ entries: [entryFixture(eventFixture('remote'))], nextBefore: null, nextAfter: null }); await Promise.all([a, b]);
	const c = sync.page('page-1'); assert.equal(calls, 2); reply({ entries: [], nextBefore: null, nextAfter: null }); await c;
});

test('history is loaded per Thing, paged both ways, and remote refresh preserves dirty local events', async () => {
	const local = new TimelineLocalStore(scope, new MemoryBackend());
	await local.enqueue(eventFixture('dirty'));
	const requests: unknown[] = [];
	const transport: TimelineTransport = {
		push: async () => { throw new Error('read only'); },
		page: async request => {
			requests.push(request);
			const positions = request.after ? [11, 12] : request.before ? [8] : [10, 9];
			return { entries: positions.map(position => entryFixture(eventFixture(`api-${position}`, { source: 'api', mode: 'revision', clientId: null }), position)), nextBefore: request.before || request.after ? null : 9, nextAfter: null };
		}
	};
	const sync = new TimelineSync(local, transport);
	assert.equal((await sync.page('page-1')).nextBefore, 9);
	await sync.page('page-1', { before: 9 });
	await sync.page('page-1', { after: 10 });
	assert.equal((await local.forThing('page-1')).length, 6);
	assert.deepEqual((await local.pending()).map(event => event.id), ['dirty']);
	assert.deepEqual(requests, [
		{ thingId: 'page-1', before: null, after: null, limit: 40 },
		{ thingId: 'page-1', before: 9, after: null, limit: 40 },
		{ thingId: 'page-1', before: null, after: 10, limit: 40 }
	]);
});

test('out-of-scope and skipped/duplicate paging responses do not enter the cache', async () => {
	const local = new TimelineLocalStore(scope, new MemoryBackend());
	for (const page of [
		{ entries: [entryFixture(eventFixture('foreign', { thingId: 'different' }))], nextBefore: null, nextAfter: null },
		{ entries: [entryFixture(eventFixture('first'), 2), entryFixture(eventFixture('second'), 2)], nextBefore: null, nextAfter: null },
		{ entries: [entryFixture(eventFixture('first'), 3), entryFixture(eventFixture('second'), 2)], nextBefore: 3, nextAfter: null },
		{ entries: [entryFixture(eventFixture('first'), 3)], nextBefore: 1, nextAfter: null }
	]) {
		const sync = new TimelineSync(local, { push: async () => { throw new Error('unused'); }, page: async () => page });
		await assert.rejects(sync.page('page-1'));
	}
	assert.equal((await local.forThing('page-1')).length, 0);
});
