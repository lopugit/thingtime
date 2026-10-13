import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb';
import { TimelineLocalStore } from './localStore';
import { TimelineDraftRecorder } from './draftRecorder';
import { TimelineSync } from './sync';
import { parseTimelineEvent } from './contract';
import { splitTimelineEvent, joinTimelineEvent } from './records';
import { eventFixture, entryFixture } from './testFixtures';
import {
	captureComponentBindings,
	capturedComponentBindings,
	bindingsForBlocks,
	readComponentBinding,
	webpageComponentRefs
} from './componentBindings';
const component = (text: string) => ({
	id: 'component-card',
	crystal: { name: 'Card', render: { tag: 'p', children: text }, args: [{ name: 'enabled', default: false }] }
});
const blocks = [
	{ id: 'card', type: 'component', component: 'card' },
	{ id: 'missing', type: 'component', component: 'missing' }
];
const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.test', dataPlane: 'home' };
const page = eventFixture('page');

test('component captures retain only readable render fields and use atomic canonical events and links', () => {
	const capture = captureComponentBindings(
		page,
		{ card: { ...component('Original'), secure: 'secret', linkKey: 'hidden', acl: ['tt:all'] } as any, missing: null },
		[],
		(ref) => `capture-${ref}`
	);
	const linked = parseTimelineEvent({ ...page, dependencies: capture.dependencies });
	const record = splitTimelineEvent(linked);
	assert.equal('dependencies' in record.event, false);
	assert.equal(record.links.filter((link) => link.relation === 'dependency').length, 2);
	assert.deepEqual(joinTimelineEvent(record.event, record.links), linked);
	const value = capturedComponentBindings(linked, capture.events, blocks);
	assert.deepEqual(value.missing, []);
	assert.equal(value.components.card!.crystal.render.children, 'Original');
	assert.equal(value.components.missing, null);
	assert.deepEqual(Object.keys(value.components.card!).sort(), ['crystal', 'id']);
	assert.equal(capture.events[0].mode, 'draft');
	assert.equal(capture.events[0].source, 'client');
});

test('an unchanged definition is reused and changed definitions cannot rewrite old pages', () => {
	const first = captureComponentBindings(page, { card: component('Old') }, [], () => 'old');
	const unchanged = captureComponentBindings(eventFixture('page-2'), { card: component('Old') }, first.events, () => {
		throw new Error('should reuse');
	});
	assert.equal(unchanged.events[0].id, 'old');
	const next = captureComponentBindings(eventFixture('page-3'), { card: component('New') }, first.events, () => 'new');
	assert.notEqual(next.events[0].id, first.events[0].id);
	assert.equal(readComponentBinding(first.events[0])!.component!.crystal.render.children, 'Old');
	assert.equal(readComponentBinding(next.events[0])!.component!.crystal.render.children, 'New');
});

test('missing historical references stay missing; foreign, unrelated and duplicate captures are refused', () => {
	const first = captureComponentBindings(page, { card: component('Old') }, [], () => 'old');
	const linked = { ...page, dependencies: first.dependencies };
	assert.deepEqual(capturedComponentBindings(page, [], blocks).missing, ['card', 'missing']);
	assert.deepEqual(capturedComponentBindings(linked, first.events, blocks).missing, ['missing']);
	assert.throws(() => capturedComponentBindings(linked, [{ ...first.events[0], ownerId: 'other' }], blocks), /another version/);
	assert.throws(() => capturedComponentBindings(page, first.events, blocks), /another version/);
	assert.throws(() => capturedComponentBindings(linked, [...first.events, ...first.events], blocks), /Duplicate/);
	assert.throws(
		() =>
			readComponentBinding(
				parseTimelineEvent({
					...first.events[0],
					after: { ...first.events[0].after!, value: { ...(first.events[0].after!.value as any), secret: 'x' } }
				})
			),
		/Invalid/
	);
});

test('capture follows bounded container references, preserves explicit unresolved refs and cannot borrow prototype properties', () => {
	assert.deepEqual(webpageComponentRefs([{ type: 'container', children: [...blocks, ...blocks] }]), ['card', 'missing']);
	assert.deepEqual(Object.keys(bindingsForBlocks(blocks, { card: component('x') })), ['card']);
	assert.deepEqual(Object.keys(bindingsForBlocks([{ type: 'component', component: 'toString' }], {})), []);
	assert.throws(
		() => webpageComponentRefs(Array.from({ length: 121 }, (_, index) => ({ type: 'component', component: `ref-${index}` }))),
		/capture limit/
	);
	let nested: any[] = [];
	for (let index = 0; index < 26; index++) nested = [{ type: 'container', children: nested }];
	assert.throws(() => webpageComponentRefs(nested), /nesting/);
});

test('device drafts retain exact definitions across reload, deduplicate edits and synchronize dependencies first after a lost reply', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory());
	const local = new TimelineLocalStore(scope, backend);
	const recorder = new TimelineDraftRecorder(local, 'page-1', 'draft-editor', 'device');
	const snap = (text: string) => ({ adapter: 'webpage-draft', version: 1, value: { crystal: { blocks, name: text } } });
	await recorder.capture(snap('Before'), snap('One'), 'Edit page', { card: component('Old'), missing: null });
	await recorder.capture(snap('One'), snap('Two'), 'Edit page', { card: component('Old'), missing: null });
	const reopened = new TimelineLocalStore(scope, backend);
	const queue = await reopened.pending();
	assert.equal(queue.length, 4);
	const draft = queue[queue.length - 1];
	assert.equal(draft.thingId, 'page-1');
	const dependencies = await reopened.entries(draft.dependencies.map((item) => item.eventId));
	assert.equal(
		capturedComponentBindings(
			draft,
			dependencies.map((item) => item.event),
			blocks
		).components.card!.crystal.render.children,
		'Old'
	);
	assert.equal((await reopened.draft('page-1', 'draft-editor'))?.id, draft.id);
	const committed = new Map<string, ReturnType<typeof entryFixture>>();
	let lost = true;
	const sync = new TimelineSync(reopened, {
		page: async () => {
			throw new Error('unused');
		},
		push: async (event) => {
			for (const dep of event.dependencies) assert.ok(committed.has(dep.eventId));
			const entry = committed.get(event.id) ?? entryFixture(event, committed.size + 1);
			committed.set(event.id, entry);
			if (lost) {
				lost = false;
				throw new Error('Lost reply');
			}
			return entry;
		}
	});
	await assert.rejects(sync.pushPending(), /Lost reply/);
	await sync.pushPending();
	assert.equal(committed.size, 4);
	assert.equal((await reopened.pending()).length, 0);
	const other = new TimelineLocalStore({ ...scope, ownerId: 'other' }, backend);
	assert.deepEqual(await other.entries(draft.dependencies.map((item) => item.eventId)), []);
	await reopened.prune(0, 0);
	assert.equal((await reopened.entries(draft.dependencies.map((item) => item.eventId))).length, 0);
	await reopened.accept(dependencies.map((item) => committed.get(item.event.id)!));
	assert.equal((await reopened.entries(draft.dependencies.map((item) => item.eventId))).length, 2);
});
