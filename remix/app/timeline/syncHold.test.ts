import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb.ts';
import { TimelineLocalStore } from './localStore.ts';
import { TimelineBranchStore } from './branchStore.ts';
import { TimelineNoteStore } from './noteStore.ts';
import { TimelineNameStore } from './nameStore.ts';
import { TimelineSync, TimelineBranchCommandRefusal, type TimelineTransport } from './sync.ts';
import { entryFixture, eventFixture } from './testFixtures.ts';
import type { TimelineEntry } from './contract.ts';
import { timelineVersionNameId } from './versionNames.ts';

// The account sync hold (Settings → History) and the Settings export scan, on
// the real IndexedDB protocol. The hold is read inside push(), so every
// pushPending() caller — provider, controls, branch working copy — obeys it.
const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.test', dataPlane: 'home' };
const draft = (id: string, parentIds: string[] = []) => eventFixture(id, { parentIds, operationId: `operation-${id}`, label: `Edit ${id}` });
const page = (entries: TimelineEntry[], nextBefore: number | null = null, extra: Record<string, unknown> = {}) => ({ entries, nextBefore, nextAfter: null, ...extra });
const open = (transport: Partial<TimelineTransport>, held: () => boolean) => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory());
	const store = new TimelineLocalStore(scope, backend); const branches = new TimelineBranchStore(scope, backend); const notes = new TimelineNoteStore(scope, backend); const names = new TimelineNameStore(scope);
	const sync = new TimelineSync(store, { push: async event => entryFixture(event), page: async () => page([]), ...transport }, branches, notes, names, { held });
	return { backend, store, branches, notes, names, sync };
};

test('held: nothing leaves the device, pending rows and commands stay intact, and the count is index-only', async () => {
	let held = true; const calls: string[] = [];
	// Definitive refusals once lifted: the pass still uploads every event first and reports the command for its control.
	const { backend, store, branches, notes, sync } = open({
		push: async event => { calls.push(`push:${event.id}`); return entryFixture(event, calls.length); },
		branch: async () => { calls.push('branch'); throw Object.assign(new Error('refused'), { status: 422, error: 'Branch refused' }); },
		note: async () => { calls.push('note'); throw Object.assign(new Error('refused'), { status: 422, error: 'Note refused' }); }
	}, () => held);
	await store.enqueue(draft('a')); await store.enqueue(draft('b', ['a']), { pinDraft: true });
	await branches.enqueue({ command: 'create-branch', operationId: '11111111-1111-4111-8111-111111111111', branchId: 'branch-22222222-2222-4222-8222-222222222222', thingId: 'page-1', eventId: 'b', expectedRevision: 0, name: 'Named' });
	await notes.enqueue({ command: 'add-note', operationId: '33333333-3333-4333-8333-333333333333', eventId: 'a', thingId: 'page-1', text: 'Why' });
	assert.equal(await store.pendingCount(), 2);
	assert.equal(await sync.pushPending(), 0);
	assert.equal(await sync.pushPending(), 0);
	assert.deepEqual(calls, [], 'the transport is never touched while held');
	assert.deepEqual((await store.pending()).map(event => event.id), ['a', 'b']);
	assert.equal(await store.pendingCount(), 2);
	assert.equal((await branches.pending()).length, 1); assert.equal((await notes.pending()).length, 1);
	await store.prune(0, 0);
	assert.equal(await store.pendingCount(), 2, 'pending rows are eviction-proof by construction');
	held = false;
	await assert.rejects(sync.pushPending(), TimelineBranchCommandRefusal);
	assert.deepEqual(calls, ['push:a', 'push:b', 'branch', 'note'], 'the lifted queue drains in dependency order, events before the commands that cite them');
	assert.equal(await store.pendingCount(), 0); assert.equal((await store.pending()).length, 0);
	assert.equal((await store.forThing('page-1')).length, 2, 'accepted rows keep their receipts');
	assert.equal((await branches.pending()).length, 0); assert.equal((await notes.pending()).length, 0, 'definitive refusals are recorded, not retried');
	await backend.close();
});

test('the hold is consulted at call time and a stopped queue still refuses', async () => {
	let held = false; let pushes = 0;
	const { backend, store, sync } = open({ push: async event => { pushes++; return entryFixture(event, pushes); } }, () => held);
	await store.enqueue(draft('a'));
	held = true; assert.equal(await sync.pushPending(), 0); assert.equal(pushes, 0);
	held = false; assert.equal(await sync.pushPending(), 1); assert.equal(pushes, 1);
	held = true; sync.stop();
	await assert.rejects(sync.pushPending(), /stopped/, 'held never masks a released connection');
	await backend.close();
});

test('scan validates like a page read and leaves every store untouched', async () => {
	const requests: unknown[] = [];
	const accepted = [entryFixture(draft('old'), 3), entryFixture(draft('older'), 2), entryFixture(draft('oldest'), 1)];
	const notes = [{ formatVersion: 1, id: 'note-44444444-4444-4444-8444-444444444444', ownerId: 'user-1', eventId: 'old', thingId: 'page-1', author: 'owner', text: 'Why', createdAt: '2026-09-27T05:02:00.000Z' }];
	const names = [{ formatVersion: 1, id: timelineVersionNameId('older'), ownerId: 'user-1', eventId: 'older', thingId: 'page-1', name: 'Launch', revision: 1, createdAt: '2026-10-13T05:00:00.000Z', updatedAt: '2026-10-13T05:00:00.000Z' }];
	let response: any = page(accepted.slice(0, 2), 2, { notes, names });
	const { backend, store, notes: noteStore, names: nameStore, sync } = open({ page: async request => { requests.push(request); return response; } }, () => false);
	await store.enqueue(draft('mine'));
	const first = await sync.scan();
	assert.deepEqual(requests[0], { thingId: null, before: null, after: null, limit: 40 }, 'the account page, newest first');
	assert.deepEqual(first.entries.map(entry => entry.event.id), ['old', 'older']); assert.equal(first.nextBefore, 2);
	assert.deepEqual(first.notes, notes); assert.deepEqual(first.names, names);
	response = page([accepted[2]]);
	const last = await sync.scan({ before: first.nextBefore! });
	assert.deepEqual(requests[1], { thingId: null, before: 2, after: null, limit: 40 });
	assert.deepEqual(last, { entries: [accepted[2]], notes: [], names: [], nextBefore: null }, 'servers without notes or names yield empty lists');
	assert.deepEqual((await store.forThing('page-1')).map(row => row.event.id), ['mine'], 'the cache holds only what this device authored');
	assert.equal(await store.pendingCount(), 1);
	assert.equal((await noteStore.forEvents(['old'])).size, 0); assert.equal(nameStore.forEvents(['older']).size, 0);
	for (const bad of [page(accepted.slice(0, 2), 2, { entries: [accepted[1], accepted[0]] }), page(accepted.slice(0, 2), 7), page([entryFixture(eventFixture('foreign', { ownerId: 'user-2', actorId: 'user-2' }), 9)]), page(accepted.slice(0, 2), 2, { reset: true }), page(accepted.slice(0, 2), 2, { related: { thingIds: ['page-1'], revision: 'r1' } })]) {
		response = bad; await assert.rejects(sync.scan(), /Invalid (Timeline|related history)|another account/);
	}
	for (const cursor of [{ before: 0 }, { before: 1.5 }, { after: 3 } as any, { before: 2, related: true } as any]) await assert.rejects(sync.scan(cursor), /Invalid Timeline cursor/);
	assert.equal((await store.forThing('page-1')).length, 1, 'rejected pages wrote nothing either');
	await backend.close();
});
