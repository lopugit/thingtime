import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { LocalTimeline, LOCAL_TIMELINE_OWNER, localTimelineScope } from './timeline';
import { parseTimelineEvent, type TimelineEvent } from '../timeline/contract';
import { parseBranchMergePreview, createBranchMergeProposal, type BranchMergeRequest } from '../timeline/branchMerge';
import { branchCheckoutRequest } from '../timeline/branchCheckout';
import { captureComponentBindings, capturedComponentBindings } from '../timeline/componentBindings';
import { mergeComponentVersions } from '../timeline/componentMerge';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { TimelineLocalStore } from '../timeline/localStore';
import { TimelineBranchStore } from '../timeline/branchStore';
import { TimelineSync } from '../timeline/sync';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} },
	partition = { kind: 'anonymous' } as const;
async function fixture(db: WorkspaceDatabase) {
	const things = new LocalThings(db, partition, lease),
		history = new LocalTimeline(db, lease, 'https://thingtime.example');
	const thing = await things.create({ thingtime: ['data'], crystal: { name: 'Base', left: 0, right: 0 } });
	const base = (await history.page({ thingId: thing.id, before: null, after: null, limit: 40 })).entries[0].event;
	const branchId = `branch-${randomUUID()}`;
	const draft = async (crystal: object, extra: Partial<TimelineEvent> = {}) => {
		const event = parseTimelineEvent({
			...base,
			id: randomUUID(),
			operationId: randomUUID(),
			mode: 'draft',
			operation: 'update',
			branchId,
			before: base.after,
			after: { ...base.after!, value: { ...(base.after!.value as any), crystal } },
			parentIds: [base.id],
			...extra
		});
		await history.push(event);
		return event;
	};
	const current = await draft({ name: 'Base', left: 1, right: 0 }),
		incoming = await draft({ name: 'Base', left: 0, right: 2 });
	const target = await history.branch({
		command: 'create-branch',
		operationId: randomUUID(),
		branchId,
		thingId: thing.id,
		eventId: current.id,
		expectedRevision: 0,
		name: 'Combined variation'
	});
	const request: BranchMergeRequest = {
		command: 'preview-branch-merge',
		branchId,
		thingId: thing.id,
		expectedHeadId: current.id,
		expectedRevision: 1,
		eventId: incoming.id,
		choices: {},
		componentChoices: {}
	};
	return { things, history, thing, base, draft, current, incoming, target, request };
}

test('local branch comparison, normal proposal queue and cold checkout merge independent edits without changing the current Thing', async () => {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory),
		backend = new IndexedDbTimelineBackend(factory);
	try {
		const h = await fixture(db),
			before = await h.history.page({ thingId: h.thing.id, before: null, after: null, limit: 40 });
		const preview = parseBranchMergePreview((await h.history.branchMerge(h.request)).preview, LOCAL_TIMELINE_OWNER, h.request);
		assert.deepEqual((preview.result.value as any).crystal, { name: 'Base', left: 1, right: 2 });
		assert.deepEqual(await h.history.page({ thingId: h.thing.id, before: null, after: null, limit: 40 }), before, 'comparison is read-only');
		const proposal = createBranchMergeProposal(preview, 'local-merge-test');
		const scope = localTimelineScope(h.history.origin),
			store = new TimelineLocalStore(scope, backend),
			branches = new TimelineBranchStore(scope, backend);
		await store.accept([(await h.history.entry(h.current.id)).entry, (await h.history.entry(h.incoming.id)).entry]);
		await branches.accept([h.target]);
		await store.enqueue(proposal.event);
		await branches.enqueue(proposal.command);
		const sync = new TimelineSync(
			store,
			{
				page: async () => {
					throw new Error('unused');
				},
				push: async (event) => (await h.history.push(event)).entry,
				branch: (command) => h.history.branch(command)
			},
			branches
		);
		await sync.pushPending();
		assert.deepEqual(await branches.queued(), []);
		const next = await h.history.branchHead(h.target.branch.id, h.thing.id);
		assert.equal(next.head.revision, 2);
		const checkout = (await h.history.checkoutBranch(branchCheckoutRequest(next))).checkout;
		assert.deepEqual(checkout.entry.event.parentIds, [h.current.id, h.incoming.id]);
		assert.equal(checkout.entry.event.operation, 'merge');
		assert.equal(checkout.entry.event.source, 'client');
		assert.deepEqual(await h.things.get(h.thing.id), h.thing);
		await db.close();
		const reopened = new WorkspaceDatabase(factory);
		try {
			const again = new LocalTimeline(reopened, lease, h.history.origin);
			assert.deepEqual((await again.checkoutBranch(branchCheckoutRequest(next))).checkout, checkout);
		} finally {
			await reopened.close();
		}
	} finally {
		await backend.close();
		await db.close();
	}
});

test('overlapping local edits require explicit choices; a changed head preserves the proposal and refuses its stale push', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	try {
		const h = await fixture(db),
			incoming = await h.draft({ name: 'Base', left: 3, right: 0 });
		const request = { ...h.request, eventId: incoming.id };
		const preview = (await h.history.branchMerge(request)).preview;
		assert.equal(preview.conflicts.length, 1);
		assert.throws(() => createBranchMergeProposal(preview, 'local'), /resolve/);
		const chosen = { ...request, choices: { '["crystal","left"]': 'incoming' as const } };
		const resolved = parseBranchMergePreview((await h.history.branchMerge(chosen)).preview, LOCAL_TIMELINE_OWNER, chosen);
		assert.equal((resolved.result.value as any).crystal.left, 3);
		await assert.rejects(h.history.branchMerge({ ...request, choices: { '["not-a-conflict"]': 'current' } }), /choices/);
		const proposal = createBranchMergeProposal(resolved, 'local');
		await h.history.push(proposal.event);
		await h.history.branch({ ...proposal.command, operationId: randomUUID(), eventId: h.current.id });
		await assert.rejects(h.history.branchMerge(request), /branch changed/);
		await assert.rejects(h.history.branch(proposal.command), (error: any) => error.status === 409);
		assert.equal((await h.history.entry(proposal.event.id)).entry.event.operation, 'merge', 'the selected merged version remains recoverable');
		assert.equal((await h.history.branchHead(h.target.branch.id, h.thing.id)).head.eventId, h.current.id);
	} finally {
		await db.close();
	}
});

async function componentFixture(db: WorkspaceDatabase) {
	const h = await fixture(db),
		ref = 'card',
		crystal = { name: 'Page', blocks: [{ id: 'card', type: 'component', component: ref }] };
	const capture = async (label: string, parent: TimelineEvent) => {
		const event = parseTimelineEvent({
			...parent,
			id: randomUUID(),
			operationId: randomUUID(),
			mode: 'draft',
			operation: 'update',
			branchId: h.target.branch.id,
			before: parent.after,
			after: { ...parent.after!, value: { ...(parent.after!.value as any), crystal } },
			parentIds: [parent.id],
			dependencies: []
		});
		const captures = captureComponentBindings(event, { card: { id: 'component-id', crystal: { render: { tag: 'p', children: label } } } }, [], () =>
			randomUUID()
		);
		for (const captured of captures.events) await h.history.push(captured);
		const completed = parseTimelineEvent({ ...event, dependencies: captures.dependencies });
		await h.history.push(completed);
		return completed;
	};
	const base = await capture('Recorded base', h.base),
		current = await capture('Recorded current', base),
		incoming = await capture('Recorded incoming', base);
	const target = await h.history.branch({
		command: 'create-branch',
		operationId: randomUUID(),
		branchId: `branch-${randomUUID()}`,
		thingId: h.thing.id,
		eventId: current.id,
		expectedRevision: 0,
		name: 'Component variation'
	});
	const request = { ...h.request, branchId: target.branch.id, expectedHeadId: current.id, eventId: incoming.id };
	return { ...h, base, current, incoming, target, request };
}

test('component conflicts retain exact recorded definitions and merge the explicitly selected dependency', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	try {
		const h = await componentFixture(db);
		const { componentChoices: _choices, ...oldClient } = h.request;
		await assert.rejects(h.history.branchMerge(oldClient), /review recorded/);
		const first = parseBranchMergePreview((await h.history.branchMerge(h.request)).preview, LOCAL_TIMELINE_OWNER, h.request);
		assert.equal(first.components!.entries.length, 3);
		assert.equal(mergeComponentVersions(first.components!, first.result).conflicts.length, 1);
		assert.throws(() => createBranchMergeProposal(first, 'local'), /resolve/);
		const request = { ...h.request, componentChoices: { '["card"]': 'incoming' as const } };
		const selected = parseBranchMergePreview((await h.history.branchMerge(request)).preview, LOCAL_TIMELINE_OWNER, request);
		const proposal = createBranchMergeProposal(selected, 'local');
		assert.deepEqual(proposal.event.dependencies, h.incoming.dependencies);
		await h.history.push(proposal.event);
		const saved = await h.history.branch(proposal.command);
		const captures = (await h.history.componentBindings(saved.head.eventId)).entries.map((row) => row.event);
		const binding = capturedComponentBindings(proposal.event, captures, (proposal.event.after!.value as any).crystal.blocks);
		assert.equal((binding.components.card!.crystal.render as any).children, 'Recorded incoming');
		assert.deepEqual(binding.missing, []);
		assert.deepEqual(await h.things.get(h.thing.id), h.thing);
		await assert.rejects(
			h.history.branchMerge({ ...h.request, expectedHeadId: saved.head.eventId, expectedRevision: 2, componentChoices: { '["absent"]': 'current' } }),
			/choices/
		);
	} finally {
		await db.close();
	}
});

test('component batch size preflight refuses oversized metadata before decoding capture payloads', async () => {
	class Guarded extends WorkspaceDatabase {
		refusedCapture = '';
		inspected = false;
		override transaction<T>(...args: Parameters<WorkspaceDatabase['transaction']>): Promise<T> {
			const [scope, mode, guard, run] = args;
			return super.transaction(scope, mode, guard, (tx) =>
				run({
					...tx,
					get: async <V>(collection: string, id: string) => {
						if (this.refusedCapture && collection === 'timeline-events' && id === this.refusedCapture) {
							this.inspected = true;
							throw new Error('capture decoded before preflight');
						}
						return tx.get<V>(collection, id);
					}
				})
			) as Promise<T>;
		}
	}
	const db = new Guarded(new IDBFactory());
	try {
		const h = await componentFixture(db),
			id = h.incoming.dependencies[0].eventId;
		await db.transaction(partition, 'readwrite', lease, async (tx) => {
			const header = await tx.get<any>('timeline-index', id);
			await tx.put('timeline-index', id, { ...header, bytes: 4 * 1024 * 1024 });
		});
		db.refusedCapture = id;
		await assert.rejects(h.history.branchMerge(h.request), (error: any) => error.status === 413 && /too large/.test(error.message));
		assert.equal(db.inspected, false);
	} finally {
		await db.close();
	}
});

test('local branch merge refuses foreign versions, invalid choices, aborted/retired scopes and unsupported dependencies', async () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	try {
		const h = await fixture(db);
		for (const patch of [{ thingId: 'foreign' }, { eventId: 'missing' }])
			await assert.rejects(h.history.branchMerge({ ...h.request, ...patch }), /not found|unavailable/);
		await assert.rejects(h.history.branchMerge(h.request, AbortSignal.abort()), /abort/i);
		const retired = new LocalTimeline(
			db,
			{
				...lease,
				assertCurrent() {
					throw new Error('retired');
				}
			},
			h.history.origin
		);
		await assert.rejects(retired.branchMerge(h.request), /retired/);
		const depended = await h.draft({ name: 'Dependent' }, { dependencies: [{ thingId: h.thing.id, eventId: h.base.id }] });
		await assert.rejects(
			h.history.branchMerge({ ...h.request, eventId: depended.id }),
			(error: any) => error.status === 422 && /dependencies/.test(error.message)
		);
		assert.deepEqual(await h.things.get(h.thing.id), h.thing);
	} finally {
		await db.close();
	}
});
