import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb';
import { TimelineLocalStore } from './localStore';
import { TimelineBranchStore } from './branchStore';
import { TimelineSync } from './sync';
import { TimelineBranchWorkingCopy } from './branchWorkingCopy';
import { parseTimelineBranchEntry, timelineBranchHeadId } from './branches';
import { entryFixture, eventFixture } from './testFixtures';
import type { TimelineSnapshot } from './contract';
const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.test', dataPlane: 'home' };
const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
const time = '2026-09-28T05:00:00.000Z';
const snapshot = (text: string): TimelineSnapshot => ({
	adapter: 'thing-content',
	version: 1,
	value: {
		crystal: { name: 'Page', blocks: [{ type: 'text', id: 'title', text }] },
		extended: {},
		tags: [],
		geo: null,
		acl: ['tt:user'],
		folderId: 'folder'
	}
});
async function setup() {
	const backend = new IndexedDbTimelineBackend(new IDBFactory());
	const store = new TimelineLocalStore(scope, backend);
	const branches = new TimelineBranchStore(scope, backend);
	let target = parseTimelineBranchEntry({
		branch: { formatVersion: 1, id: branchId, ownerId: scope.ownerId, name: 'Experiment', createdAt: time },
		head: {
			formatVersion: 1,
			id: timelineBranchHeadId(branchId, 'page'),
			branchId,
			ownerId: scope.ownerId,
			thingId: 'page',
			eventId: 'base',
			revision: 1,
			createdAt: time,
			updatedAt: time
		}
	});
	await store.accept([entryFixture(eventFixture('base', { thingId: 'page', after: snapshot('Published') }))]);
	await branches.accept([target]);
	const state = { offline: false, lost: false, refuse: false };
	const commands: any[] = [];
	const receipts = new Map<string, any>();
	let position = 100;
	const sync = new TimelineSync(
		store,
		{
			page: async () => {
				throw new Error('unused');
			},
			push: async (event) => {
				if (state.offline) throw new Error('Offline');
				return entryFixture(event, position++);
			},
			branch: async (command) => {
				commands.push(command);
				if (state.offline) throw new Error('Offline');
				if (state.refuse) throw { status: 409, error: 'Branch changed' };
				if (receipts.has(command.operationId)) return receipts.get(command.operationId);
				assert.equal(command.expectedRevision, target.head.revision);
				target = {
					...target,
					head: {
						...target.head,
						eventId: command.eventId,
						revision: target.head.revision + 1,
						updatedAt: new Date(Date.parse(time) + position).toISOString()
					}
				};
				const entry = entryFixture(
					eventFixture(`branch-op-${command.operationId}`, {
						thingId: 'page',
						branchId,
						source: 'api',
						clientId: null,
						mode: 'effect',
						operation: 'effect',
						after: { adapter: 'timeline-branch', version: 1, value: target }
					}),
					position++
				);
				const result = { ok: true as const, ...target, entry };
				receipts.set(command.operationId, result);
				if (state.lost) {
					state.lost = false;
					throw new Error('Lost reply');
				}
				return result;
			}
		},
		branches
	);
	const connection = { store, branches, sync };
	const copy = new TimelineBranchWorkingCopy(connection, target, snapshot('Published'));
	return { backend, store, branches, sync, connection, copy, state, commands, target };
}
test('visual and field working copies continue after confirmed saves using the acknowledged branch parent', async () => {
	const h = await setup();
	await h.copy.change(snapshot('First'));
	assert.equal(await h.copy.save(), 'saved');
	assert.equal(h.copy.target.head.revision, 2);
	assert.equal(h.copy.edited, false);
	assert.equal(h.copy.locked, false);
	const firstId = h.copy.target.head.eventId;
	await h.copy.change(snapshot('Second'));
	assert.equal(await h.copy.save(), 'saved');
	assert.equal(h.copy.target.head.revision, 3);
	const latest = (await h.store.forThing('page')).find((row) => row.event.id === h.copy.target.head.eventId)!;
	assert.deepEqual(latest.event.parentIds, [firstId]);
	assert.deepEqual((await h.store.forThing('page')).find((row) => row.event.id === 'base')!.event.after, snapshot('Published'));
	assert.equal((await h.store.forThing('page')).filter((row) => row.draftKey).length, 0);
	await h.backend.close();
});
test('offline and uncertain pushes freeze the operation and preserve the draft until exact acknowledgment', async () => {
	const h = await setup();
	h.state.offline = true;
	await h.copy.change(snapshot('Offline'));
	assert.equal(await h.copy.save(), 'pending');
	const queued = (await h.branches.queued())[0].command;
	assert.throws(() => h.copy.change(snapshot('Cannot overwrite queued payload')), /Finish syncing/);
	await assert.rejects(h.copy.discard(), /pending/);
	assert.equal((await h.store.forThing('page')).filter((row) => row.draftKey).length, 1);
	h.state.offline = false;
	h.state.lost = true;
	assert.equal(await h.copy.save(), 'pending');
	assert.deepEqual((await h.branches.queued())[0].command, queued);
	assert.equal(await h.copy.save(), 'saved');
	assert.deepEqual(h.commands[0], h.commands[1]);
	assert.equal(h.copy.target.head.revision, 2);
	await h.backend.close();
});
test('stale pushes retain local content and parallel receipt checks do not race session state', async () => {
	const h = await setup();
	await h.copy.change(snapshot('Local'));
	h.state.refuse = true;
	assert.equal(await h.copy.save(), 'refused');
	assert.equal(h.copy.locked, true);
	assert.deepEqual(JSON.parse(JSON.stringify(h.copy.snapshot)), snapshot('Local'));
	assert.ok((await h.branches.queued())[0].failure);
	assert.equal((await h.store.forThing('page')).filter((row) => row.draftKey).length, 1);
	h.state.refuse = false;
	await h.branches.retryRejected((await h.branches.queued())[0].command.operationId);
	await h.sync.pushPending();
	assert.deepEqual(await Promise.all([h.copy.reconcile(), h.copy.reconcile()]), ['saved', 'saved']);
	assert.equal(h.copy.target.head.revision, 2);
	await h.backend.close();
});
test('recovery checks branch identity, and discarding keeps events while releasing the draft pin', async () => {
	const h = await setup();
	await h.copy.change(snapshot('Recoverable'));
	const row = (await h.store.forThing('page')).find((row) => row.draftKey)!;
	const reopened = new TimelineBranchWorkingCopy(h.connection, h.target, snapshot('Published'));
	reopened.resume(row.event);
	for (const patch of [{ ownerId: 'other' }, { branchId: 'draft-other' }, { thingId: 'other' }, { mode: 'effect' as const }])
		assert.throws(() => reopened.resume({ ...row.event, ...patch }), /another branch/);
	const discarding = reopened.discard();
	assert.throws(() => reopened.change(snapshot('Racing edit')), /Finish syncing/);
	await assert.rejects(reopened.save(), /already saving/);
	await discarding;
	assert.deepEqual(JSON.parse(JSON.stringify(reopened.snapshot)), snapshot('Published'));
	assert.equal(reopened.edited, false);
	assert.ok((await h.store.forThing('page')).some((item) => item.event.id === row.event.id));
	// Resumed pins use the original recorder's key and must be released too.
	assert.equal((await h.store.forThing('page')).filter((item) => item.draftKey).length, 0);
	const unknown = new TimelineBranchWorkingCopy(h.connection, h.target, row.event.after!, false);
	unknown.resume(row.event);
	await assert.rejects(unknown.discard(), /Reconnect/);
	await h.backend.close();
});
