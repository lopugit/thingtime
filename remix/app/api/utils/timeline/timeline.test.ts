import assert from 'node:assert/strict';
import test from 'node:test';
import { Binary } from 'mongodb';
import { splitTimelineEvent } from '../../../timeline/records.ts';
import { entryFixture, eventFixture } from '../../../timeline/testFixtures.ts';
import { TIMELINE_EVENT_KIND, TIMELINE_LINK_KIND, parseTimelineEntry } from '../../../timeline/contract.ts';
import { appendTimelineEvent, readTimelinePage, readTimelineNodes, timelineFolderId, TIMELINE_PAGE_MAX_BYTES } from './repository.ts';
import { packTimelineEntry, unpackTimelineEntry, unpackTimelineLink } from './envelope.ts';
import { thingContentSnapshot, thingMutationEvent } from './recordMutation.ts';
import { validateClientTimelineEvent } from './service.ts';
import { thingStorageSizeBytes, currentContentStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION } from '../storage/storageCore.ts';
import { COLLECTION_SCHEMA_VERSIONS, isProtectedThingtime } from '../../../schemas/registry.ts';
import { canView, sanitizeShareId } from '../things/things.ts';
import { fromBin, toBin } from '../auth/binary.ts';

function harness() {
	let rows: any[] = [];
	let charge = 0;
	let full = false;
	const session = {};
	const match = (row: any, filter: any) => Object.entries(filter).every(([key, value]: any) => {
		if (value?.$in) return value.$in.includes(row[key]);
		if (value?.$lt) return row[key] < value.$lt;
		if (value?.$gt) return row[key] > value.$gt;
		return Array.isArray(row[key]) ? row[key].includes(value) : row[key] === value;
	});
	const things = {
		findOne: async (filter: any, options: any) => { assert.equal(options.session, session); return rows.find(row => match(row, filter)) ?? null; },
		find: (filter: any, options?: any) => {
			if (options?.session) assert.equal(options.session, session);
			let selected = rows.filter(row => match(row, filter));
			const cursor = { sort: (order: any) => { selected.sort((a, b) => order.createdAt * (a.createdAt.getTime() - b.createdAt.getTime())); return cursor; }, limit: (n: number) => { selected = selected.slice(0, n); return cursor; }, toArray: async () => selected };
			return cursor;
		},
		updateOne: async (filter: any, update: any, options: any) => {
			assert.equal(options.session, session);
			const index = rows.findIndex(row => match(row, filter));
			if (index === -1 && options.upsert) { rows.push({ _id: `db-${rows.length}`, ...update.$setOnInsert }); return { matchedCount: 0, upsertedCount: 1 }; }
			if (index === -1) return { matchedCount: 0 };
			rows[index] = { ...rows[index], ...update.$set }; return { matchedCount: 1 };
		},
		insertOne: async (doc: any, options: any) => { assert.equal(options.session, session); assert.ok(!rows.some(row => row.shareId === doc.shareId)); rows.push({ _id: `db-${rows.length}`, ...doc }); },
		insertMany: async (docs: any[], options: any) => { for (const doc of docs) await things.insertOne(doc, options); }
	};
	const append = async (event: ReturnType<typeof eventFixture>) => {
		const before = [...rows]; const oldCharge = charge;
		try { return await appendTimelineEvent(things, event, session, { plane: 'home', now: new Date('2026-09-27T05:01:00.000Z'), debit: async (owner, bytes, tx) => { assert.equal(owner, event.ownerId); assert.equal(tx, session); if (full) throw new Error('quota'); charge += bytes; } }); }
		catch (error) { rows = before; charge = oldCharge; throw error; }
	};
	return { things, session, append, rows: () => rows, charge: () => charge, fill: () => { full = true; } };
}

test('server append stores the exact local/transport schema as private binary, once per immutable event', async () => {
	const h = harness();
	const event = eventFixture();
	const first = await h.append(event);
	assert.deepEqual(first.event, parseTimelineEntry(entryFixture(event)).event);
	const bytes = h.charge();
	assert.deepEqual(await h.append(event), first);
	assert.equal(h.rows().length, 5);
	assert.equal(h.rows()[0].crystal.name, 'Timeline');
	assert.equal(h.rows()[1].folderId, timelineFolderId(event.ownerId));
	assert.deepEqual(h.rows()[1].crystal, { name: 'Change' });
	assert.ok(h.rows()[1].secure instanceof Binary);
	assert.deepEqual(JSON.parse(fromBin(h.rows()[1].secure)).event, splitTimelineEvent(event).event);
	assert.equal('parentIds' in h.rows()[1].timelineNode, false);
	assert.deepEqual(unpackTimelineEntry(h.rows()[1], h.rows().filter(row => row.thingtime.includes(TIMELINE_LINK_KIND)).map(unpackTimelineLink)), first);
	assert.equal(h.charge(), bytes);
	await assert.rejects(h.append({ ...event, label: 'Changed replay' }), /different content/);
	assert.equal(h.rows().length, 5);
	assert.equal(h.charge(), bytes);
});

test('shared dependencies and fork ancestry are separate records; missing references refuse the entire append', async () => {
	const h = harness();
	await h.append(eventFixture('component-version', { thingId: 'component' }));
	await h.append(eventFixture('base'));
	const baseDoc = JSON.stringify(h.rows().find(row => row.timelineNode?.id === 'base'));
	const refs = [{ thingId: 'component', eventId: 'component-version' }];
	await h.append(eventFixture('a', { parentIds: ['base'], dependencies: refs }));
	await h.append(eventFixture('b', { branchId: 'alternate', parentIds: ['base'], dependencies: refs }));
	assert.equal(JSON.stringify(h.rows().find(row => row.timelineNode?.id === 'base')), baseDoc);
	const links = h.rows().filter(row => row.thingtime.includes(TIMELINE_LINK_KIND)).map(unpackTimelineLink);
	assert.equal(links.filter(link => link.relation === 'dependency' && link.targetId === 'component-version').length, 2);
	assert.deepEqual((await readTimelineNodes(h.things, 'user-1', ['a', 'b'])).map(node => node.parentIds), [['base'], ['base']]);
	const count = h.rows().length;
	await assert.rejects(h.append(eventFixture('bad', { dependencies: [{ thingId: 'foreign', eventId: 'component-version' }] })), /dependency/);
	assert.equal(h.rows().length, count);
	const missing = h.rows().findIndex(row => row.thingtime.includes(TIMELINE_LINK_KIND) && unpackTimelineLink(row).eventId === 'a' && unpackTimelineLink(row).relation === 'parent');
	h.rows().splice(missing, 1);
	await assert.rejects(readTimelineNodes(h.things, 'user-1', ['a']), /incomplete/);
	await assert.rejects(readTimelinePage(h.things, 'user-1', { thingId: 'page-1', limit: 40, before: null, after: null }), /incomplete/);
});

test('legacy event envelopes remain readable without translating or rewriting their immutable payload', () => {
	const entry = parseTimelineEntry(entryFixture(eventFixture('legacy', { parentIds: ['earlier'] })));
	for (const timelineEnvelopeVersion of [1, 2]) assert.deepEqual(unpackTimelineEntry({ thingtime: [TIMELINE_EVENT_KIND], timelineEnvelopeVersion, secure: toBin(JSON.stringify(entry)) }), entry);
});

test('server cursor advances despite equal clocks; page reads isolate owner and Thing and cover both directions', async () => {
	const h = harness();
	const a = await h.append(eventFixture('a'));
	const b = await h.append(eventFixture('b', { parentIds: ['a'] }));
	await h.append(eventFixture('other', { ownerId: 'other', actorId: 'other' }));
	await h.append(eventFixture('other-thing', { thingId: 'other-page' }));
	assert.equal(b.receipt.position, a.receipt.position + 1);
	const first = await readTimelinePage(h.things, 'user-1', { thingId: 'page-1', limit: 1, before: null, after: null });
	assert.deepEqual(first.entries.map(entry => entry.event.id), ['b']);
	const older = await readTimelinePage(h.things, 'user-1', { thingId: 'page-1', limit: 1, before: first.nextBefore, after: null });
	assert.deepEqual(older.entries.map(entry => entry.event.id), ['a']);
	assert.equal(older.nextBefore, null);
	const newer = await readTimelinePage(h.things, 'user-1', { thingId: 'page-1', limit: 1, before: null, after: a.receipt.position });
	assert.deepEqual(newer.entries.map(entry => entry.event.id), ['b']);
});

test('missing and foreign parents, quota refusal, and missing transaction never leave a success event', async () => {
	const h = harness();
	await assert.rejects(h.append(eventFixture('orphan', { parentIds: ['missing'] })), /earlier changes/);
	assert.equal(h.rows().length, 0);
	await h.append(eventFixture('foreign', { thingId: 'other-page' }));
	await assert.rejects(h.append(eventFixture('child', { parentIds: ['foreign'] })), /earlier changes/);
	const before = h.rows().length; const bytes = h.charge();
	h.fill();
	await assert.rejects(h.append(eventFixture('quota')), /quota/);
	assert.equal(h.rows().length, before); assert.equal(h.charge(), bytes);
	await assert.rejects(appendTimelineEvent(h.things, eventFixture(), null), /transaction/);
});

test('large history pages stop at the byte budget and continue without skipping an event', async () => {
	const h = harness();
	for (let n = 0; n < 5; n++) await h.append(eventFixture(`large-${n}`, { after: { adapter: 'thing', version: 1, value: 'x'.repeat(1_600_000) } }));
	const seen: string[] = []; let before: number | null = null;
	do {
		const page = await readTimelinePage(h.things, 'user-1', { thingId: 'page-1', before, after: null, limit: 40 });
		assert.ok(Buffer.byteLength(JSON.stringify(page)) <= TIMELINE_PAGE_MAX_BYTES);
		seen.push(...page.entries.map(entry => entry.event.id)); before = page.nextBefore;
	} while (before !== null);
	assert.deepEqual(seen, ['large-4', 'large-3', 'large-2', 'large-1', 'large-0']);
});

test('small snapshots with many shared dependency links are paged within the relational join budget', async () => {
	const h = harness(); const dependencies: { thingId: string; eventId: string }[] = [];
	for (let n = 0; n < 160; n++) {
		const thingId = `component-${n}-${'x'.repeat(170)}`; const eventId = `version-${n}-${'y'.repeat(170)}`;
		await h.append(eventFixture(eventId, { thingId })); dependencies.push({ thingId, eventId });
	}
	for (let n = 0; n < 40; n++) await h.append(eventFixture(`page-revision-${n}`, { dependencies }));
	const first = await readTimelinePage(h.things, 'user-1', { thingId: 'page-1', before: null, after: null, limit: 40 });
	assert.ok(first.entries.length > 0 && first.entries.length < 40, 'The link join must be budgeted even though all wire references fit');
	assert.ok(Buffer.byteLength(JSON.stringify(first)) < TIMELINE_PAGE_MAX_BYTES);
	const ids = first.entries.map(entry => entry.event.id); let before = first.nextBefore;
	while (before !== null) {
		const page = await readTimelinePage(h.things, 'user-1', { thingId: 'page-1', before, after: null, limit: 40 });
		ids.push(...page.entries.map(entry => entry.event.id)); before = page.nextBefore;
	}
	assert.equal(ids.length, 40); assert.equal(new Set(ids).size, 40);
});

test('history bytes participate in canonical accounting, and plaintext/missing envelopes fail closed', () => {
	const envelope = packTimelineEntry(entryFixture(eventFixture()));
	const doc = { schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, thingtime: [TIMELINE_EVENT_KIND], crystal: { name: 'Change' }, extended: null, tags: [], ...envelope };
	const bytes = thingStorageSizeBytes(doc);
	assert.equal(bytes, Buffer.byteLength(JSON.stringify({ before: eventFixture().before, after: eventFixture().after })));
	assert.equal(thingStorageSizeBytes({ ...doc, timelineEnvelopeVersion: 1 }), Buffer.byteLength(JSON.stringify({ crystal: doc.crystal, extended: null, tags: [] })) + envelope.secure.length());
	assert.equal(currentContentStorageSizeBytes({ ...doc, sizeBytes: bytes }), bytes);
	for (const secure of [undefined, 'plaintext', {}]) {
		assert.throws(() => thingStorageSizeBytes({ ...doc, secure }), /envelope/);
		assert.equal(currentContentStorageSizeBytes({ ...doc, secure, sizeBytes: bytes }), null);
	}
});

test('retaining a deleted Thing transfers exactly its content bytes, including at a full quota', () => {
	const source = { shareId: 'data-1', ownerId: 'user-1', thingtime: ['data'], crystal: { title: 'Small Thing', value: 'hello' }, extended: null, tags: [] };
	const deleted = thingMutationEvent(source, null, { id: 'delete-1', operationId: 'delete-op', actorId: 'user-1', source: 'api', now: new Date('2026-09-27T05:00:00.000Z') })!;
	const history = { thingtime: [TIMELINE_EVENT_KIND], crystal: { name: 'Change' }, ...packTimelineEntry(entryFixture(deleted)) };
	assert.equal(thingStorageSizeBytes(history), thingStorageSizeBytes(source));
	const malicious = { ...deleted, source: 'client' as const, mode: 'draft' as const, clientId: 'browser', before: { adapter: 'thing-content', version: 1, value: { ...deleted.before!.value as object, ignored: 'x'.repeat(20_000) } } };
	assert.ok(thingStorageSizeBytes({ ...history, ...packTimelineEntry(entryFixture(malicious)) }) > 20_000, 'A client cannot hide unmetered data in a snapshot');
});

test('client uploads cannot forge server provenance or another owner, and generic APIs cannot mint/read event Things', () => {
	assert.equal(validateClientTimelineEvent('user-1', eventFixture()).mode, 'draft');
	for (const patch of [{ ownerId: 'other' }, { actorId: 'other' }, { mode: 'revision' }, { source: 'api' }, { clientId: null }]) assert.throws(() => validateClientTimelineEvent('user-1', { ...eventFixture(), ...patch }));
	assert.equal(isProtectedThingtime([TIMELINE_EVENT_KIND]), true);
	assert.equal(isProtectedThingtime([TIMELINE_LINK_KIND]), true);
	assert.equal((sanitizeShareId('timeline-forged') as any).ok, false);
	const doc: any = { shareId: 'event', ownerId: 'user-1', thingtime: [TIMELINE_EVENT_KIND], acl: ['tt:all'] };
	for (const viewer of [null, { id: 'user-1' }, { id: 'other' }]) for (const kind of [TIMELINE_EVENT_KIND, TIMELINE_LINK_KIND]) assert.equal(canView({ ...doc, thingtime: [kind] }, viewer), false);
});

test('server content projection omits credentials and counters, suppresses bookkeeping-only changes, and preserves baseline content', () => {
	const before = { shareId: 'page', ownerId: 'user-1', thingtime: ['webpage'], crystal: { name: 'Before' }, secure: { password: 'not-a-credential' }, linkKey: 'private-link', sizeBytes: 100, updatedAt: new Date() };
	const capture = { id: 'server-event', operationId: 'server-operation', actorId: 'editor', source: 'api' as const, now: new Date('2026-09-27T05:00:00.000Z') };
	assert.equal(thingMutationEvent(before, { ...before, updatedAt: new Date(), sizeBytes: 200 }, capture), null);
	const event = thingMutationEvent(before, { ...before, crystal: { name: 'After' } }, capture)!;
	assert.equal(event.actorId, 'editor'); assert.equal(event.ownerId, 'user-1'); assert.deepEqual(event.parentIds, []);
	assert.deepEqual(event.before, thingContentSnapshot(before));
	assert.equal(JSON.stringify(event).includes('private-link'), false); assert.equal(JSON.stringify(event).includes('password'), false);
	assert.equal(thingMutationEvent(null, { ...before, shareId: 'timeline-internal' }, capture), null);
});
