import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { LocalTimeline, LOCAL_TIMELINE_OWNER, localTimelineScope } from './timeline';
import { parseTimelineBranchCommand, type TimelineBranchCommand } from '../timeline/branches';
import { branchCheckoutRequest } from '../timeline/branchCheckout';
import { parseTimelineEvent, type TimelineEvent } from '../timeline/contract';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { TimelineLocalStore } from '../timeline/localStore';
import { TimelineBranchStore } from '../timeline/branchStore';
import { TimelineSync } from '../timeline/sync';
import { TimelineBranchWorkingCopy } from '../timeline/branchWorkingCopy';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} },
	partition = { kind: 'anonymous' } as const;
const page = { thingId: null, before: null, after: null, limit: 40 };
async function fixture(db: WorkspaceDatabase) {
	const things = new LocalThings(db, partition, lease),
		history = new LocalTimeline(db, lease, 'https://thingtime.example');
	const thing = await things.create({
		thingtime: ['webpage'],
		crystal: { name: 'Original page', blocks: [{ id: 'text', type: 'text', text: 'Original content' }] }
	});
	const event = (await history.page(page)).entries[0].event;
	const command = (patch: Partial<TimelineBranchCommand> = {}): TimelineBranchCommand => ({
		command: 'create-branch',
		operationId: randomUUID(),
		branchId: `branch-${randomUUID()}`,
		thingId: thing.id,
		eventId: event.id,
		expectedRevision: 0,
		name: 'My variation',
		...patch
	});
	const draft = (patch: Partial<TimelineEvent> = {}) =>
		parseTimelineEvent({
			...event,
			id: `draft-${randomUUID()}`,
			operationId: randomUUID(),
			mode: 'draft',
			operation: 'update',
			before: event.after,
			parentIds: [event.id],
			...patch
		});
	return { things, history, thing, event, command, draft };
}

test('local canonical branches replay immutable receipts, paginate stable creation positions and survive reload without changing Things', async () => {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory);
	try {
		const { history, command, draft, things, thing } = await fixture(db),
			first = command();
		const result = await history.branch(first);
		assert.equal(
			result.entry.event.operationId,
			createHash('sha256')
				.update(JSON.stringify(parseTimelineBranchCommand(first)))
				.digest('hex')
		);
		assert.equal(result.entry.event.source, 'api');
		assert.deepEqual(await history.branch(first), result);
		const second = await history.branch(command());
		const initialPage = await history.branches(thing.id, null, 1);
		assert.deepEqual(initialPage.branches, [{ branch: second.branch, head: second.head }]);
		const edited = draft({ branchId: first.branchId });
		await history.push(edited);
		const advance = command({ command: 'advance-branch', branchId: first.branchId, eventId: edited.id, expectedRevision: 1, name: null });
		const advanced = await history.branch(advance);
		assert.equal(advanced.head.revision, 2);
		assert.ok(advanced.head.updatedAt > result.head.updatedAt);
		assert.deepEqual(await history.branch(first), result, 'old retry does not rewind the head');
		assert.deepEqual((await history.branches(thing.id, initialPage.nextBefore, 1)).branches, [{ branch: advanced.branch, head: advanced.head }]);
		assert.deepEqual(await things.get(thing.id), thing);
		await db.close();
		const reopened = new WorkspaceDatabase(factory);
		try {
			const next = new LocalTimeline(reopened, lease, history.origin);
			assert.deepEqual(await next.branchHead(first.branchId, thing.id), { branch: advanced.branch, head: advanced.head });
			assert.equal((await next.checkoutBranch(branchCheckoutRequest(advanced))).checkout.entry.event.id, edited.id);
			await reopened.transaction({ kind: 'account', ownerId: 'other', origin: history.origin, dataPlane: 'home' }, 'readonly', lease, async (tx) =>
				assert.deepEqual(await tx.list('timeline-branches'), [])
			);
		} finally {
			await reopened.close();
		}
	} finally {
		await db.close();
	}
});

test('concurrent local branch advances use CAS; changed retries and divergent versions cannot overwrite a winner', async () => {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory),
		second = new WorkspaceDatabase(factory);
	try {
		const { history, command, draft, thing } = await fixture(db),
			other = new LocalTimeline(second, lease, history.origin);
		const created = await history.branch(command()),
			a = draft({ branchId: created.branch.id }),
			b = draft({ branchId: created.branch.id });
		await history.push(a);
		await other.push(b);
		const advance = (eventId: string, revision = 1) =>
			command({ command: 'advance-branch', branchId: created.branch.id, eventId, expectedRevision: revision, name: null });
		const ca = advance(a.id),
			cb = advance(b.id);
		const results = await Promise.allSettled([history.branch(ca), other.branch(cb)]);
		assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
		assert.ok(results.some((r) => r.status === 'rejected' && r.reason.status === 409));
		const winner = results[0].status === 'fulfilled' ? ca : cb,
			loser = winner === ca ? b : a;
		await assert.rejects(history.branch({ ...winner, eventId: loser.id }), /already used/);
		await assert.rejects(history.branch(advance(loser.id, 2)), /diverged/);
		await assert.rejects(history.checkoutBranch(branchCheckoutRequest(created)), /branch changed/);
		assert.equal((await history.branchHead(created.branch.id, thing.id)).head.eventId, winner.eventId);
		assert.equal((await history.page(page)).entries.filter((row) => row.event.mode === 'effect').length, 2);
	} finally {
		await db.close();
		await second.close();
	}
});

test('checkout reconstructs compact drafts from recorded ancestors, never the latest Thing', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	try {
		const { history, things, thing, event, command, draft } = await fixture(db);
		const compact = draft({
			after: {
				adapter: 'definition-source',
				version: 1,
				value: { source: JSON.stringify({ name: 'Historical variation', blocks: [{ id: 'text', type: 'text', text: 'Historical content' }] }) }
			}
		});
		await history.push(compact);
		const created = await history.branch(command({ eventId: compact.id }));
		await things.update({ id: thing.id, crystal: { name: 'Changed main', blocks: [] } });
		const checkout = (await history.checkoutBranch(branchCheckoutRequest(created))).checkout;
		assert.equal((checkout.snapshot.value as any).crystal.name, 'Historical variation');
		assert.deepEqual((await history.entry(event.id)).entry.event, event);
		assert.equal((await things.get(thing.id)).crystal.name, 'Changed main');
		const unsupported = draft({ parentIds: [], after: compact.after });
		await history.push(unsupported);
		const orphan = await history.branch(command({ eventId: unsupported.id }));
		await assert.rejects(history.checkoutBranch(branchCheckoutRequest(orphan)), /unambiguous saved basis/);
	} finally {
		await db.close();
	}
});

test('local branch effect, head, metadata and ordering roll back together on quota failure', async () => {
	class Refusing extends WorkspaceDatabase {
		refuse = true;
		override transaction<T>(...args: Parameters<WorkspaceDatabase['transaction']>): Promise<T> {
			const [scope, mode, guard, run] = args;
			return super.transaction(scope, mode, guard, (tx) =>
				run({
					...tx,
					put: async (collection, id, value) => {
						if (this.refuse && collection === 'timeline-branch-index') throw new Error('injected branch quota');
						return tx.put(collection, id, value);
					}
				})
			) as Promise<T>;
		}
	}
	const db = new Refusing(new IDBFactory());
	try {
		const { history, command, thing } = await fixture(db),
			request = command();
		await assert.rejects(history.branch(request), /branch quota/);
		assert.deepEqual(await history.branches(thing.id), { branches: [], nextBefore: null });
		assert.equal((await history.page(page)).entries.length, 1);
		db.refuse = false;
		const retry = await history.branch(request);
		assert.equal(retry.entry.receipt.position, 2);
		assert.equal(retry.head.revision, 1);
	} finally {
		await db.close();
	}
});

test('branch reads and writes reject missing, ineligible, foreign, aborted, retired and corrupted identities', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	try {
		const { history, command, thing, things } = await fixture(db);
		await assert.rejects(history.branch(command({ eventId: 'missing' })), /not available/);
		await assert.rejects(history.branch(command({ thingId: 'other' })), /not available/);
		await assert.rejects(history.branch(command({ name: ' padded' })), /Invalid/);
		const aborted = AbortSignal.abort();
		await assert.rejects(history.branch(command(), aborted), /abort/i);
		const retired = new LocalTimeline(
			db,
			{
				...lease,
				assertCurrent() {
					throw new Error('retired');
				}
			},
			history.origin
		);
		await assert.rejects(retired.branch(command()), /retired/);
		const created = await history.branch(command());
		await assert.rejects(history.branch(command({ eventId: created.entry.event.id })), /not available/);
		await things.remove([thing.id]);
		await assert.rejects(history.branch(command({ eventId: (await history.page(page)).entries[0].event.id })), /not available/);
		for (const before of [0, -1, 1.2, NaN]) await assert.rejects(history.branches(thing.id, before), /Invalid/);
		await db.transaction(partition, 'readwrite', lease, (tx) =>
			tx.put('timeline-branches', created.branch.id, { ...created.branch, ownerId: 'foreign' })
		);
		await assert.rejects(history.branchHead(created.branch.id, thing.id), /metadata is damaged/);
		await assert.rejects(history.branches(thing.id), /metadata is damaged/);
	} finally {
		await db.close();
	}
});

test('ordinary working-copy queue saves locally and replays a lost reply without mutating the current Thing', async () => {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory),
		backend = new IndexedDbTimelineBackend(factory);
	try {
		const { history, thing, things, command } = await fixture(db),
			target = await history.branch(command());
		const scope = localTimelineScope(history.origin),
			store = new TimelineLocalStore(scope, backend),
			branches = new TimelineBranchStore(scope, backend);
		const checkout = (await history.checkoutBranch(branchCheckoutRequest(target))).checkout;
		await store.accept([checkout.entry]);
		await branches.accept([target]);
		let loseReply = true;
		const sync = new TimelineSync(
			store,
			{
				page: async () => {
					throw new Error('unused');
				},
				push: async (event) => (await history.push(event)).entry,
				branch: async (command) => {
					const result = await history.branch(command);
					if (loseReply) {
						loseReply = false;
						throw new Error('lost reply');
					}
					return result;
				}
			},
			branches
		);
		const copy = new TimelineBranchWorkingCopy({ store, branches, sync }, target, checkout.snapshot, true, checkout.entry.event);
		await copy.change({ ...checkout.snapshot, value: { ...(checkout.snapshot.value as any), crystal: { name: 'Only in variation', blocks: [] } } });
		assert.equal(await copy.save(), 'pending');
		assert.equal(await copy.save(), 'saved');
		assert.equal(copy.target.head.revision, 2);
		assert.equal((await branches.queued()).length, 0);
		assert.equal((await store.forThing(thing.id)).filter((row) => row.draftKey).length, 0);
		assert.equal((await things.get(thing.id)).crystal.name, 'Original page');
		assert.equal(
			((await history.checkoutBranch(branchCheckoutRequest(copy.target))).checkout.snapshot.value as any).crystal.name,
			'Only in variation'
		);
	} finally {
		await backend.close();
		await db.close();
	}
});
