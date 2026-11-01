import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb.ts';
import { TimelineLocalStore } from './localStore.ts';
import { TimelineBranchStore } from './branchStore.ts';
import { TimelineSync } from './sync.ts';
import { entryFixture, eventFixture } from './testFixtures.ts';
import { captureComponentBindings, capturedComponentBindings } from './componentBindings.ts';
import { componentVersion, mergeComponentVersions, parseComponentMergeContext } from './componentMerge.ts';
import { createBranchMergeProposal } from './branchMerge.ts';
import { timelineBranchHeadId } from './branches.ts';
import { splitTimelineEvent, joinTimelineEvent } from './records.ts';
import type { TimelineSnapshot } from './contract.ts';

const blocks = (...refs: string[]) => refs.map((component, index) => ({ id: `block-${index}`, type: 'component', component }));
const snapshot = (...refs: string[]): TimelineSnapshot => ({
	adapter: 'thing-content',
	version: 1,
	value: { crystal: { blocks: blocks(...refs) }, extended: {}, tags: [], geo: null, acl: null, folderId: null }
});
const component = (text: string) => ({ id: 'card-id', crystal: { render: { tag: 'h2', children: text } } });
const capture = (id: string, values: Record<string, any>) => {
	const page = eventFixture(id, { thingId: 'page', after: snapshot(...Object.keys(values)) });
	const result = captureComponentBindings(page, values, [], (ref) => `${id}-${ref}`);
	const entries = result.events.map((event, index) => entryFixture(event, index + 1));
	return {
		page: { ...page, dependencies: result.dependencies },
		entries,
		version: componentVersion({ ...page, dependencies: result.dependencies }, blocks(...Object.keys(values)), entries)
	};
};
const context = (base: ReturnType<typeof capture>, current: ReturnType<typeof capture>, incoming: ReturnType<typeof capture>) => ({
	base: base.version,
	current: current.version,
	incoming: incoming.version,
	entries: [...base.entries, ...current.entries, ...incoming.entries],
	choices: {}
});

test('component merge combines independent definitions by content and excludes removed references', () => {
	const base = capture('base', { card: component('Old'), other: component('Old') });
	const current = capture('current', { card: component('Current'), other: component('Old') });
	const incoming = capture('incoming', { card: component('Old'), other: component('Incoming') });
	const input = context(base, current, incoming);
	const merged = mergeComponentVersions(input, snapshot('card', 'other'));
	assert.deepEqual(merged.conflicts, []);
	assert.deepEqual(merged.dependencies, [current.version.card, incoming.version.other]);
	assert.deepEqual(mergeComponentVersions(input, snapshot('other')).dependencies, [incoming.version.other]);
	const same = capture('same', { card: component('Current'), other: component('Old') });
	assert.deepEqual(mergeComponentVersions(context(base, current, same), snapshot('card')).dependencies, [current.version.card]);
});

test('overlapping definitions, missing history and explicit unavailable captures require honest choices', () => {
	const base = capture('base', { card: component('Old') });
	const current = capture('current', { card: component('Current') });
	const incoming = capture('incoming', { card: component('Incoming') });
	const input = context(base, current, incoming);
	assert.deepEqual(
		mergeComponentVersions(input, snapshot('card')).conflicts.map((item) => item.path),
		[['card']]
	);
	assert.deepEqual(mergeComponentVersions({ ...input, choices: { '["card"]': 'incoming' } }, snapshot('card')).dependencies, [incoming.version.card]);
	assert.throws(() => mergeComponentVersions({ ...input, choices: { '["card"]': 'incoming' } }, snapshot()), /no longer match/);
	const missing = { ...input, current: { card: null } };
	assert.equal(mergeComponentVersions(missing, snapshot('card')).conflicts[0].current.present, false);
	const kept = mergeComponentVersions({ ...missing, choices: { '["card"]': 'current' } }, snapshot('card'));
	assert.deepEqual(kept.missing, ['card']);
	assert.deepEqual(kept.dependencies, []);
	const unavailable = capture('unavailable', { card: null });
	const unavailableResult = mergeComponentVersions(context(base, base, unavailable), snapshot('card'));
	assert.equal((unavailableResult.result.value as any).card, null);
	assert.deepEqual(unavailableResult.missing, []);
	assert.deepEqual(
		mergeComponentVersions({ ...input, current: {} }, snapshot('card')).dependencies,
		[incoming.version.card],
		'Only the incoming page references this component'
	);
});

test('component comparison parser rejects foreign, duplicate, unrelated and mismatched records and treats prototype refs as data', () => {
	const values = Object.fromEntries([
		['__proto__', component('Old')],
		['constructor', component('Old')]
	]);
	const a = capture('a', values),
		b = capture('b', values),
		c = capture('c', values);
	const input = context(a, b, c);
	const page = snapshot('__proto__', 'constructor');
	const parsed = parseComponentMergeContext(input, 'user-1', page, page, {});
	assert.equal(mergeComponentVersions(parsed, page).dependencies.length, 2);
	assert.throws(() => parseComponentMergeContext(input, 'foreign', page, page, {}), /records/);
	assert.throws(() => parseComponentMergeContext({ ...input, entries: [...input.entries, input.entries[0]] }, 'user-1', page, page, {}), /records/);
	assert.throws(
		() => parseComponentMergeContext({ ...input, current: { ...input.current, constructor: input.current.__proto__ } }, 'user-1', page, page, {}),
		/does not match/
	);
	assert.throws(() => parseComponentMergeContext(input, 'user-1', snapshot('other'), page, {}), /another page/);
	assert.throws(
		() =>
			componentVersion({ ...a.page, dependencies: [{ eventId: 'missing', thingId: 'timeline-component-missing' }] }, blocks('__proto__'), a.entries),
		/unavailable/
	);
});

test('resolved component merges survive IndexedDB reload and lost acknowledgments without losing canonical links', async () => {
	const a = capture('a', { card: component('Old') }),
		b = capture('b', { card: component('Current') }),
		c = capture('c', { card: component('Incoming') });
	const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.test', dataPlane: 'home' };
	const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
	const date = '2026-09-27T05:00:00.000Z';
	const target = {
		branch: { formatVersion: 1 as const, id: branchId, ownerId: scope.ownerId, name: 'Captured merge', createdAt: date },
		head: {
			formatVersion: 1 as const,
			id: timelineBranchHeadId(branchId, 'page'),
			branchId,
			ownerId: scope.ownerId,
			thingId: 'page',
			eventId: b.page.id,
			revision: 1,
			createdAt: date,
			updatedAt: date
		}
	};
	const preview = {
		...target,
		incomingEventId: c.page.id,
		baseEventId: a.page.id,
		current: snapshot('card'),
		incoming: snapshot('card'),
		result: snapshot('card'),
		conflicts: [],
		components: { ...context(a, b, c), choices: { '["card"]': 'incoming' as const } }
	};
	const proposal = createBranchMergeProposal(preview, 'browser');
	const split = splitTimelineEvent(proposal.event);
	assert.deepEqual(joinTimelineEvent(split.event, split.links), proposal.event);
	assert.equal('dependencies' in split.event, false);
	const factory = new IDBFactory();
	const backend = new IndexedDbTimelineBackend(factory);
	const store = new TimelineLocalStore(scope, backend);
	await store.accept(c.entries);
	await store.enqueue(proposal.event);
	await new TimelineBranchStore(scope, backend).enqueue(proposal.command);
	await backend.close();
	const reopened = new IndexedDbTimelineBackend(factory);
	const recovered = new TimelineLocalStore(scope, reopened);
	const branches = new TimelineBranchStore(scope, reopened);
	const merge = (await recovered.pending())[0];
	assert.deepEqual(merge, proposal.event);
	const retained = await recovered.entries(merge.dependencies.map((link) => link.eventId));
	assert.equal(
		capturedComponentBindings(
			merge,
			retained.map((row) => row.event),
			blocks('card')
		).components.card!.crystal.render.children,
		'Incoming'
	);
	const result = { ...target, head: { ...target.head, revision: 2, eventId: merge.id } };
	const receipt = entryFixture(
		eventFixture(`branch-op-${proposal.command.operationId}`, {
			thingId: 'page',
			branchId,
			source: 'api',
			clientId: null,
			mode: 'effect',
			operation: 'effect',
			after: { adapter: 'timeline-branch', version: 1, value: result }
		}),
		20
	);
	const requests: string[] = [];
	let lost = true;
	let pushed = 0;
	const sync = new TimelineSync(
		recovered,
		{
			page: async () => {
				throw new Error('unused');
			},
			push: async (event) => {
				pushed++;
				assert.deepEqual(event.dependencies, [c.version.card]);
				return entryFixture(event, 10);
			},
			branch: async (command) => {
				requests.push(JSON.stringify(command));
				if (lost) {
					lost = false;
					throw new Error('Lost reply');
				}
				return { ok: true, ...result, entry: receipt };
			}
		},
		branches
	);
	await assert.rejects(sync.pushPending(), /Lost reply/);
	await sync.pushPending();
	assert.equal(pushed, 1);
	assert.equal(requests[0], requests[1]);
	assert.deepEqual(await branches.queued(), []);
	assert.equal(
		(await new TimelineLocalStore({ ...scope, ownerId: 'other' }, reopened).entries(merge.dependencies.map((link) => link.eventId))).length,
		0
	);
	await reopened.close();
});
