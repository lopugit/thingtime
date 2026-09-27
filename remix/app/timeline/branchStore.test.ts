import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb.ts';
import { TimelineBranchStore } from './branchStore.ts';
import { TimelineLocalStore } from './localStore.ts';
import { TimelineSync, TimelineBranchCommandRefusal } from './sync.ts';
import { parseTimelineBranchCommand, parseTimelineBranchEntry, timelineBranchHeadId } from './branches.ts';
import { parseTimelineEvent } from './contract.ts';
import { entryFixture, eventFixture } from './testFixtures.ts';

const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.com', dataPlane: 'home' };
const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
const operationId = '277abf25-b322-4ac0-9707-a59c36e7bcd5';
const command = parseTimelineBranchCommand({ command: 'create-branch', operationId, branchId, thingId: 'page', eventId: 'base', expectedRevision: 0, name: 'Experiment' });
const member = (thingId = 'page', revision = 1) => parseTimelineBranchEntry({
	branch: { formatVersion: 1, id: branchId, ownerId: scope.ownerId, name: 'Experiment', createdAt: '2026-09-27T05:00:00.000Z' },
	head: { formatVersion: 1, id: timelineBranchHeadId(branchId, thingId), ownerId: scope.ownerId, branchId, thingId, eventId: revision === 1 ? 'base' : `version-${revision}`, revision, createdAt: '2026-09-27T05:00:00.000Z', updatedAt: '2026-09-27T05:01:00.000Z' }
});

test('branch commands survive reload and concurrent tabs without changing immutable request identities', async () => {
	const factory = new IDBFactory(); const a = new IndexedDbTimelineBackend(factory); const b = new IndexedDbTimelineBackend(factory);
	const first = new TimelineBranchStore(scope, a); const second = new TimelineBranchStore(scope, b);
	const next = { ...command, operationId: '377abf25-b322-4ac0-9707-a59c36e7bcd5', branchId: 'branch-477abf25-b322-4ac0-9707-a59c36e7bcd5' };
	await Promise.all([first.enqueue(command), second.enqueue(next)]);
	await Promise.all([a.close(), b.close()]);
	const backend = new IndexedDbTimelineBackend(factory); const reopened = new TimelineBranchStore(scope, backend);
	assert.equal((await reopened.pending()).length, 2);
	await reopened.enqueue(command); assert.equal((await reopened.pending()).length, 2);
	await assert.rejects(reopened.enqueue({ ...command, name: 'Changed retry' }), /identity/);
	assert.equal((await reopened.pending()).find(item => item.operationId === command.operationId)?.name, 'Experiment');
	await backend.close();
});

test('branch metadata is shared by independent Thing heads, stale replies cannot rewind them, and cache clearing keeps commands', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineBranchStore(scope, backend);
	await store.enqueue(command); await store.accept([member()], operationId);
	await store.accept([member('page', 2), member('component')]);
	await store.accept([member()], operationId);
	assert.equal((await store.forThing('page'))[0].head.revision, 2);
	const raw = await backend.readBranchState(store.key); assert.equal(raw.branches.length, 1); assert.equal(raw.heads.length, 2); assert.equal(raw.pending.length, 0);
	assert.deepEqual(raw.heads.find(row => row.head.thingId === 'component')?.head, member('component').head);
	await assert.rejects(store.accept([{ ...member('page', 2), head: { ...member('page', 2).head, eventId: 'forged' } }]), /identity/);
	const pending = { ...command, command: 'advance-branch' as const, operationId: '377abf25-b322-4ac0-9707-a59c36e7bcd5', eventId: 'version-3', expectedRevision: 2, name: null };
	await store.enqueue(pending); await store.clearCache();
	assert.equal((await store.forThing('page')).length, 0); assert.deepEqual(await store.pending(), [pending]);
	for (const other of [{ ...scope, ownerId: 'other' }, { ...scope, apiOrigin: 'https://other.test' }, { ...scope, dataPlane: 'custom' }]) {
		const isolated = new TimelineBranchStore(other, backend); assert.deepEqual(await isolated.pending(), []); assert.deepEqual(await isolated.forThing('page'), []);
	}
	await assert.rejects(store.accept([{ ...member(), branch: { ...member().branch, ownerId: 'other' }, head: { ...member().head, ownerId: 'other' } }]), /scope/);
	await backend.close();
});

test('losing a branch acknowledgment retains its command; retry records one receipt and clears only that command', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const branches = new TimelineBranchStore(scope, backend); const events = new TimelineLocalStore(scope, backend);
	await branches.enqueue(command);
	const entry = entryFixture(parseTimelineEvent(eventFixture(`branch-op-${operationId}`, { thingId: 'page', branchId, source: 'api', clientId: null, mode: 'effect', operation: 'effect', before: null, after: { adapter: 'timeline-branch', version: 1, value: member() } })));
	let lost = true; const seen: string[] = [];
	const sync = new TimelineSync(events, {
		push: async () => { throw new Error('unused'); }, page: async () => { throw new Error('unused'); },
		branch: async value => { seen.push(JSON.stringify(value)); if (lost) { lost = false; throw new Error('Reply lost after commit'); } return { ok: true, ...member(), entry }; }
	}, branches);
	await assert.rejects(sync.pushPending(), /Reply lost/); assert.equal((await branches.pending()).length, 1);
	assert.equal(await sync.pushPending(), 1); assert.equal(seen[0], seen[1]);
	assert.deepEqual(await branches.pending(), []); assert.equal((await branches.forThing('page'))[0].head.eventId, 'base');
	assert.equal((await events.forThing('page')).length, 1); await backend.close();
});

test('a definitive refusal can be resolved without losing its version, while an uncertain command cannot be dismissed', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const branches = new TimelineBranchStore(scope, backend); const events = new TimelineLocalStore(scope, backend);
	await branches.enqueue(command);
	await assert.rejects(branches.dismissRejected(operationId), /check its result/);
	const sync = new TimelineSync(events, { push: async () => { throw new Error('unused'); }, page: async () => { throw new Error('unused'); }, branch: async () => { throw { status: 409, error: 'Pull the changed branch before pushing.' }; } }, branches);
	await assert.rejects(sync.pushPending(), TimelineBranchCommandRefusal);
	assert.deepEqual(await branches.pending(), []); assert.equal((await branches.queued())[0].failure?.status, 409);
	assert.equal((await branches.queued())[0].command.eventId, 'base');
	await branches.retryRejected(operationId); assert.deepEqual(await branches.pending(), [command]);
	await branches.reject(operationId, 409, 'Changed branch'); await branches.dismissRejected(operationId);
	assert.deepEqual(await branches.queued(), []); await backend.close();
});

test('a branch queued during an upload waits for its new local version instead of receiving a false missing-version refusal', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const branches = new TimelineBranchStore(scope, backend); const events = new TimelineLocalStore(scope, backend);
	const first = eventFixture('first', { thingId: 'page' });
	const latest = eventFixture('latest', { thingId: 'page', parentIds: ['first'] });
	await events.enqueue(first);
	let started!: () => void; let release!: () => void;
	const uploading = new Promise<void>(resolve => { started = resolve; });
	const response = new Promise<void>(resolve => { release = resolve; });
	const order: string[] = [];
	const result = { ...member(), head: { ...member().head, eventId: 'latest' } };
	const audit = entryFixture(eventFixture(`branch-op-${operationId}`, { thingId: 'page', branchId, source: 'api', clientId: null, mode: 'effect', operation: 'effect', before: null, after: { adapter: 'timeline-branch', version: 1, value: result } }), 3);
	const sync = new TimelineSync(events, {
		page: async () => { throw new Error('unused'); },
		push: async event => { order.push(event.id); if (event.id === 'first') { started(); await response; } return entryFixture(event, order.length); },
		branch: async value => { assert.equal(order.at(-1), value.eventId); order.push('branch'); return { ok: true, ...result, entry: audit }; }
	}, branches);
	const draining = sync.pushPending(); await uploading;
	await events.enqueue(latest); await branches.enqueue({ ...command, eventId: latest.id });
	release(); assert.equal(await draining, 1);
	assert.deepEqual(order, ['first']); assert.equal((await branches.queued())[0].failure, undefined);
	assert.equal(await sync.pushPending(), 2); assert.deepEqual(order, ['first', 'latest', 'branch']);
	assert.equal((await branches.queued()).length, 0); await backend.close();
});
