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
import { createBranchMergeProposal } from './branchMerge.ts';

const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.com', dataPlane: 'home' };
const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
const operationId = '277abf25-b322-4ac0-9707-a59c36e7bcd5';
const command = parseTimelineBranchCommand({ command: 'create-branch', operationId, branchId, thingId: 'page', eventId: 'base', expectedRevision: 0, name: 'Experiment' });
const member = (thingId = 'page', revision = 1) => parseTimelineBranchEntry({
	branch: { formatVersion: 1, id: branchId, ownerId: scope.ownerId, name: 'Experiment', createdAt: '2026-09-27T05:00:00.000Z' },
	head: { formatVersion: 1, id: timelineBranchHeadId(branchId, thingId), ownerId: scope.ownerId, branchId, thingId, eventId: revision === 1 ? 'base' : `version-${revision}`, revision, createdAt: '2026-09-27T05:00:00.000Z', updatedAt: '2026-09-27T05:01:00.000Z' }
});

test('a reviewed merge survives offline reload and a lost branch reply with identical canonical records and one command', async () => {
	const factory = new IDBFactory(); const backend = new IndexedDbTimelineBackend(factory);
	const snapshot = { adapter: 'thing-content', version: 1, value: { crystal: { title: 'Merged' }, extended: {}, tags: [], geo: null, acl: null, folderId: null } };
	const proposal = createBranchMergeProposal({ ...member(), incomingEventId: 'incoming', baseEventId: 'ancestor', current: snapshot, incoming: snapshot, result: snapshot, conflicts: [] }, 'browser-merge');
	await new TimelineLocalStore(scope, backend).enqueue(proposal.event);
	await new TimelineBranchStore(scope, backend).enqueue(proposal.command);
	await backend.close();
	const reopened = new IndexedDbTimelineBackend(factory); const store = new TimelineLocalStore(scope, reopened); const branches = new TimelineBranchStore(scope, reopened);
	assert.deepEqual(await store.pending(), [proposal.event]); assert.deepEqual(await branches.pending(), [proposal.command]);
	const result = { ...member(), head: { ...member().head, eventId: proposal.event.id, revision: 2 } };
	const receipt = entryFixture(eventFixture(`branch-op-${proposal.command.operationId}`, { thingId: 'page', branchId, source: 'api', clientId: null, mode: 'effect', operation: 'effect', after: { adapter: 'timeline-branch', version: 1, value: result } }), 2);
	const requests: string[] = []; let lost = true; let uploads = 0;
	const sync = new TimelineSync(store, {
		page: async () => { throw new Error('unused'); },
		push: async event => { assert.deepEqual(event, proposal.event); uploads++; return entryFixture(event); },
		branch: async value => { assert.equal(uploads, 1); requests.push(JSON.stringify(value)); if (lost) { lost = false; throw new Error('Lost merge acknowledgment'); } return { ok: true, ...result, entry: receipt }; }
	}, branches);
	await assert.rejects(sync.pushPending(), /Lost merge acknowledgment/);
	assert.deepEqual(await store.pending(), []); assert.deepEqual(await branches.pending(), [proposal.command]);
	await sync.pushPending(); assert.equal(requests[0], requests[1]); assert.equal(uploads, 1);
	assert.deepEqual((await branches.forThing('page'))[0], result); assert.deepEqual(await branches.queued(), []);
	assert.deepEqual((await store.forThing('page')).find(row => row.event.id === proposal.event.id)?.event, proposal.event);
	await reopened.close();
});

test('a stale merged-branch push retains the accepted merged version after its command is dismissed', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend); const branches = new TimelineBranchStore(scope, backend);
	const snapshot = { adapter: 'thing-content', version: 1, value: { crystal: {}, extended: {}, tags: [], geo: null, acl: null, folderId: null } };
	const proposal = createBranchMergeProposal({ ...member(), incomingEventId: 'incoming', baseEventId: 'ancestor', current: snapshot, incoming: snapshot, result: snapshot, conflicts: [] }, 'browser');
	await store.enqueue(proposal.event, { pinDraft: true }); await branches.enqueue(proposal.command);
	const sync = new TimelineSync(store, { page: async () => { throw new Error('unused'); }, push: async event => entryFixture(event), branch: async () => { throw { status: 409, error: 'Branch changed' }; } }, branches);
	await assert.rejects(sync.pushPending(), TimelineBranchCommandRefusal);
	assert.equal((await branches.queued())[0].failure?.status, 409);
	assert.equal((await store.draft('page', branchId))?.id, proposal.event.id);
	await branches.dismissRejected(proposal.command.operationId);
	assert.equal((await store.forThing('page'))[0].event.id, proposal.event.id); assert.deepEqual(await branches.queued(), []);
	await backend.close();
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


test('branch acknowledgment releases its saved draft pin after reload while preserving newer or refused edits', async () => {
 for (const newer of [false, true]) {
  const backend = new IndexedDbTimelineBackend(new IDBFactory()); const branches = new TimelineBranchStore(scope, backend); const events = new TimelineLocalStore(scope, backend);
  const base = eventFixture('base', { thingId: 'page', branchId });
  await events.enqueue(base, { pinDraft: true }); await branches.enqueue(command);
  if (newer) await events.enqueue(eventFixture('newer', { thingId: 'page', branchId, parentIds: ['base'] }), { pinDraft: true });
  const audit = entryFixture(eventFixture(`branch-op-${operationId}`, { thingId: 'page', branchId, source: 'api', clientId: null, mode: 'effect', operation: 'effect', before: null, after: { adapter: 'timeline-branch', version: 1, value: member() } }), 3);
  let lost = true;
  const sync = new TimelineSync(events, { page: async () => { throw new Error('unused'); }, push: async event => entryFixture(event, event.id === 'base' ? 1 : 2), branch: async () => { if (lost) { lost = false; throw new Error('Lost reply'); } return { ok: true, ...member(), entry: audit }; } }, branches);
  await assert.rejects(sync.pushPending(), /Lost reply/); assert.equal((await events.draft('page', branchId))?.id, newer ? 'newer' : 'base');
  await sync.pushPending(); assert.equal((await events.draft('page', branchId))?.id ?? null, newer ? 'newer' : null);
  await backend.close();
 }
});


test('exact branch pulls populate an empty cache without consuming pending commands or rewinding newer heads', async () => {
 const backend = new IndexedDbTimelineBackend(new IDBFactory());
 const store = new TimelineLocalStore(scope, backend); const branches = new TimelineBranchStore(scope, backend);
 const queued = { ...command, command: 'advance-branch' as const, expectedRevision: 2, eventId: 'local-edit', name: null };
 await branches.enqueue(queued);
 let response = member('page', 2); const calls: string[][] = [];
 const sync = new TimelineSync(store, { push: async () => { throw new Error('Read must not push'); }, page: async () => { throw new Error('Read must not scan'); },
  branchHead: async (id, thingId) => { calls.push([id, thingId]); return response; }
 }, branches);
 assert.deepEqual(await sync.branchHead(branchId, 'page'), member('page', 2));
 assert.deepEqual(await branches.forThing('page'), [member('page', 2)]);
 assert.deepEqual(await branches.pending(), [queued]); assert.deepEqual(await store.forThing('page'), []);
 await branches.accept([member('page', 3)]); await sync.branchHead(branchId, 'page');
 assert.deepEqual(await branches.forThing('page'), [member('page', 3)]);
 response = member('other'); await assert.rejects(sync.branchHead(branchId, 'page'), /another/);
 response = { ...member(), branch: { ...member().branch, ownerId: 'other' }, head: { ...member().head, ownerId: 'other' } };
 await assert.rejects(sync.branchHead(branchId, 'page'), /another/);
 await assert.rejects(sync.branchHead('main', 'page'), /Invalid/);
 assert.equal(calls.length, 4); assert.deepEqual(await branches.pending(), [queued]);
 await backend.close();
});

test('an account/source change stops an in-flight exact branch read before cache adoption', async () => {
 const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend); const branches = new TimelineBranchStore(scope, backend);
 let complete!: (value: ReturnType<typeof member>) => void; let signal: AbortSignal | undefined;
 const sync = new TimelineSync(store, { push: async () => { throw new Error('unused'); }, page: async () => { throw new Error('unused'); },
  branchHead: async (_id, _thing, requestSignal) => { signal = requestSignal; return new Promise(resolve => { complete = resolve; }); }
 }, branches);
 const pending = sync.branchHead(branchId, 'page'); sync.stop(); assert.equal(signal?.aborted, true); complete(member());
 await assert.rejects(pending, /stopped/); assert.deepEqual(await branches.forThing('page'), []); await backend.close();
});

test('Published heads round-trip unchanged through the same local branch store but cannot be pushed as variations', async () => {
 const factory = new IDBFactory(), backend = new IndexedDbTimelineBackend(factory);
 const published = parseTimelineBranchEntry({ branch: { ...member().branch, id: 'main', name: 'Published' }, head: { ...member().head, id: timelineBranchHeadId('main', 'page'), branchId: 'main' } });
 await new TimelineBranchStore(scope, backend).accept([published]); await backend.close();
 const reopened = new IndexedDbTimelineBackend(factory), store = new TimelineBranchStore(scope, reopened);
 assert.deepEqual(await store.forThing('page'), [published]);
 await assert.rejects(store.enqueue({ ...command, branchId: 'main' }), /Invalid Timeline branch/);
 await reopened.close();
});
