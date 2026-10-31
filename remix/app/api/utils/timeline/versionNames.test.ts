import assert from 'node:assert/strict';
import test from 'node:test';
import { Binary } from 'mongodb';
import { createHash } from 'node:crypto';
import { createVersionNameService, readTimelineVersionNames, timelineVersionNameThingId, versionNameFromDoc } from './versionNames.ts';
import { timelineEventThingId, timelineFolderId } from './repository.ts';
import { entryFixture, eventFixture } from '../../../timeline/testFixtures.ts';
import { parseTimelineEvent, type TimelineEntry, type TimelineEvent } from '../../../timeline/contract.ts';
import { TIMELINE_VERSION_NAME_KIND, TIMELINE_VERSION_NAME_LABELS, timelineVersionNameEventId, type TimelineVersionNameCommand } from '../../../timeline/versionNames.ts';
import { StorageMutationError } from '../storage/storageCore.ts';
import { fromBin } from '../auth/binary.ts';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const name = (n: number, overrides: Partial<TimelineVersionNameCommand> = {}): TimelineVersionNameCommand => ({ command: 'name-version', operationId: uuid(n), eventId: 'saved', thingId: 'page-1', name: `Name ${n}`, expectedRevision: 0, ...overrides });
const rejects = async (work: Promise<unknown>, status: number, pattern: RegExp) =>
	assert.rejects(work, (error: any) => error instanceof StorageMutationError && error.status === status && pattern.test(error.message));
const signature = (command: Record<string, unknown>) => createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(command).sort().map(key => [key, command[key]])))).digest('hex');
const snapshot = { adapter: 'thing-content', version: 1, value: { crystal: {} } };

function harness() {
	let rows: any[] = []; let charge = 0; let clock = Date.parse('2026-10-13T09:00:00.000Z'); let position = 100;
	const session = { inTransaction: () => true };
	const match = (row: any, filter: any) => Object.entries(filter).every(([key, value]: any) => {
		if (value?.$in) return value.$in.includes(row[key]);
		return Array.isArray(row[key]) ? row[key].includes(value) : row[key] === value;
	});
	const things = {
		findOne: async (filter: any, options?: any) => { if (options?.session) assert.equal(options.session, session); return rows.find(row => match(row, filter)) ?? null; },
		updateOne: async (filter: any, update: any, options: any) => { assert.equal(options.session, session); const index = rows.findIndex(row => match(row, filter)); if (index === -1) return { matchedCount: 0 }; const next = { ...rows[index], ...update.$set }; for (const key of Object.keys(update.$unset ?? {})) delete next[key]; rows[index] = next; return { matchedCount: 1 }; },
		find: (filter: any, options?: any) => {
			if (options?.session) assert.equal(options.session, session);
			let selected = rows.filter(row => match(row, filter));
			const cursor = { limit: (n: number) => { selected = selected.slice(0, n); return cursor; }, toArray: async () => selected };
			return cursor;
		},
		insertOne: async (doc: any, options: any) => { assert.equal(options.session, session); if (rows.some(row => row.shareId === doc.shareId)) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }); rows.push({ _id: `db-${rows.length}`, ...doc }); },
		deleteOne: async (filter: any, options: any) => { assert.equal(options.session, session); const index = rows.findIndex(row => match(row, filter)); if (index === -1) return { deletedCount: 0 }; rows.splice(index, 1); return { deletedCount: 1 }; }
	};
	const saved = eventFixture('saved', { source: 'api', clientId: null, mode: 'revision', operation: 'update', branchId: 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5', before: snapshot, after: snapshot });
	let events = new Map<string, TimelineEntry>([
		['saved', entryFixture(saved, 1)],
		['other-thing', entryFixture(eventFixture('other-thing', { thingId: 'other-page', source: 'api', clientId: null, mode: 'revision', operation: 'create' }), 2)],
		['draft', entryFixture(eventFixture('draft'), 3)],
		['deleted', entryFixture(eventFixture('deleted', { source: 'api', clientId: null, mode: 'revision', operation: 'delete', before: snapshot, after: null }), 4)],
		['effect', entryFixture(eventFixture('effect', { source: 'api', clientId: null, mode: 'effect', operation: 'effect', after: { adapter: 'timeline-branch', version: 1, value: {} } }), 5)]
	]);
	const appended: TimelineEvent[] = []; let race: (() => Promise<void>) | null = null; let foreign: { rows: any[]; events: [string, TimelineEntry][] } | null = null;
	const service = createVersionNameService({
		collection: async () => things as any,
		transaction: async work => {
			const before = [...rows]; const priorEvents = new Map(events); const oldCharge = charge;
			try { return await work(session); }
			catch (error) { rows = [...before, ...(foreign?.rows ?? [])]; events = new Map([...priorEvents, ...(foreign?.events ?? [])]); charge = oldCharge; foreign = null; throw error; }
		},
		debit: async (owner, bytes, tx) => { assert.equal(owner, 'user-1'); assert.equal(tx, session); charge += bytes; },
		now: () => new Date(clock += 1000),
		entries: async (_things, ownerId, ids, tx) => { assert.equal(tx, session); return ids.flatMap(id => { const entry = events.get(id); return entry && entry.event.ownerId === ownerId ? [entry] : []; }); },
		append: async (_things, event, tx, options) => {
			assert.equal(tx, session); assert.ok(options?.now instanceof Date); assert.equal(typeof options?.debit, 'function');
			const entry = entryFixture(parseTimelineEvent(event), ++position); appended.push(entry.event); events.set(event.id, entry);
			if (race) { const pending = race; race = null; const mark = rows.length; const known = new Set(events.keys()); await pending(); foreign = { rows: rows.slice(mark), events: [...events].filter(([id]) => !known.has(id)) }; }
			return entry;
		}
	});
	return { things, service, appended, saved, rows: () => rows, events: () => events, charge: () => charge, setRace: (fn: () => Promise<void>) => { race = fn; } };
}

test('naming a synced saved version stores one unbilled control record beside its event, appends a metered effect in its branch, and replays exactly', async () => {
	const h = harness();
	const result = await h.service('user-1', name(1));
	assert.ok(result.name && result.entry);
	const eventShareId = timelineEventThingId('user-1', 'saved');
	assert.deepEqual(result.name, { formatVersion: 1, id: 'saved/name', ownerId: 'user-1', eventId: 'saved', thingId: 'page-1', name: 'Name 1', revision: 1, createdAt: '2026-10-13T09:00:01.000Z', updatedAt: '2026-10-13T09:00:01.000Z' });
	assert.equal(h.rows().length, 1); const doc = h.rows()[0];
	assert.equal(doc.shareId, timelineVersionNameThingId('user-1', 'saved')); assert.deepEqual(doc.thingtime, [TIMELINE_VERSION_NAME_KIND]); assert.deepEqual(doc.acl, ['tt:user']);
	assert.equal(doc.folderId, timelineFolderId('user-1')); assert.equal(doc.parentId, null); assert.equal(doc.targetId, eventShareId);
	assert.deepEqual(doc.crystal, { name: 'Version name', targetId: eventShareId, linkKind: TIMELINE_VERSION_NAME_KIND }, 'the crystal label is constant');
	assert.equal(doc.storageClass, 'control'); assert.equal(doc.sizeBytes, undefined); assert.equal(h.charge(), 0, 'the record itself is unbilled control metadata');
	assert.equal(doc.nameRevision, 1); assert.equal(doc.timelineVersionNameVersion, 1); assert.ok(doc.secure instanceof Binary);
	assert.deepEqual(JSON.parse(fromBin(doc.secure)), result.name); assert.deepEqual(versionNameFromDoc(doc), result.name);
	assert.equal(JSON.stringify({ ...doc, secure: null }).includes('Name 1'), false, 'the name text lives only in the secure envelope');
	assert.equal(doc.createdAt.getTime(), result.entry.receipt.position);
	const event = result.entry.event;
	assert.equal(event.id, timelineVersionNameEventId(uuid(1))); assert.equal(event.operationId, signature(name(1)));
	assert.equal(event.branchId, h.saved.branchId, 'the effect sits in the named version’s lane'); assert.deepEqual(event.parentIds, []);
	assert.equal(event.source, 'api'); assert.equal(event.actorId, 'user-1'); assert.equal(event.clientId, null); assert.equal(event.mode, 'effect'); assert.equal(event.operation, 'effect');
	assert.equal(event.label, TIMELINE_VERSION_NAME_LABELS.named); assert.equal(event.before, null);
	assert.deepEqual(event.after, { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: result.name }); assert.deepEqual(event.dependencies, [{ thingId: 'page-1', eventId: 'saved' }]);
	assert.deepEqual(h.appended.map(item => item.id), [event.id]);
	assert.deepEqual(await h.service('user-1', name(1)), result); assert.equal(h.appended.length, 1); assert.equal(h.rows().length, 1);
	await rejects(h.service('user-1', name(1, { name: 'Other' })), 409, /already used for another request/);
	await rejects(h.service('user-1', name(1, { expectedRevision: 1 })), 409, /already used/);
	assert.equal(h.appended.length, 1);
});

test('rename and clear use the name revision as a CAS and append renamed/cleared effects; stale revisions refuse before any write', async () => {
	const h = harness();
	const first = await h.service('user-1', name(1));
	await rejects(h.service('user-1', name(2, { name: 'Stale', expectedRevision: 0 })), 409, /changed on another device/);
	await rejects(h.service('user-1', name(3, { name: null, expectedRevision: 0 })), 409, /changed on another device/);
	await rejects(h.service('user-1', name(3, { name: 'Ahead', expectedRevision: 2 })), 409, /changed on another device/);
	assert.equal(h.appended.length, 1);
	const renamed = await h.service('user-1', name(4, { name: 'Renamed', expectedRevision: 1 }));
	assert.ok(renamed.name && renamed.entry);
	assert.equal(renamed.name.revision, 2); assert.equal(renamed.name.name, 'Renamed'); assert.equal(renamed.name.createdAt, first.name!.createdAt); assert.ok(renamed.name.updatedAt > first.name!.updatedAt);
	assert.equal(renamed.entry.event.label, TIMELINE_VERSION_NAME_LABELS.renamed); assert.equal(renamed.entry.event.branchId, h.saved.branchId);
	assert.deepEqual(renamed.entry.event.before, { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: first.name }); assert.deepEqual(renamed.entry.event.after, { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: renamed.name });
	assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].nameRevision, 2); assert.deepEqual(versionNameFromDoc(h.rows()[0]), renamed.name);
	assert.deepEqual(await h.service('user-1', name(4, { name: 'Renamed', expectedRevision: 1 })), renamed, 'a rename replays by operation id even after the revision moved');
	const cleared = await h.service('user-1', name(5, { name: null, expectedRevision: 2 }));
	assert.equal(cleared.name, null); assert.ok(cleared.entry);
	assert.equal(cleared.entry.event.label, TIMELINE_VERSION_NAME_LABELS.cleared); assert.equal(cleared.entry.event.after, null);
	assert.deepEqual(cleared.entry.event.before, { adapter: TIMELINE_VERSION_NAME_KIND, version: 1, value: renamed.name });
	assert.equal(h.rows().length, 1, 'clearing keeps a tombstone'); assert.equal(h.rows()[0].timelineVersionNameCleared, true); assert.equal(h.rows()[0].nameRevision, 3); assert.equal(h.rows()[0].secure, undefined);
	assert.deepEqual(await readTimelineVersionNames(h.things, 'user-1', ['saved']), [], 'a tombstone never reads as a name');
	assert.deepEqual(await h.service('user-1', name(5, { name: null, expectedRevision: 2 })), cleared, 'a clear replays by operation id');
	assert.deepEqual(await h.service('user-1', name(6, { name: null, expectedRevision: 0 })), { ok: true, name: null, entry: null }, 'clearing an absent name is a no-op');
	assert.equal(h.appended.length, 3);
	const again = await h.service('user-1', name(7, { name: 'Again' }));
	assert.equal(again.name!.revision, 4, 'revisions stay monotonic across a clear, so a stale rename from the first life cannot land'); assert.equal(again.entry!.event.label, TIMELINE_VERSION_NAME_LABELS.named); assert.equal(again.entry!.event.before, null);
	await rejects(h.service('user-1', name(8, { name: 'Stale life', expectedRevision: 2 })), 409, /changed on another device/);
	assert.equal(h.rows()[0].timelineVersionNameCleared, false); assert.equal(versionNameFromDoc(h.rows()[0]).name, 'Again');
	assert.equal(h.charge(), 0);
});

test('naming a version with its current name is a no-op that writes nothing', async () => {
	const h = harness();
	const first = await h.service('user-1', name(1));
	assert.deepEqual(await h.service('user-1', name(2, { name: 'Name 1', expectedRevision: 1 })), { ok: true, name: first.name, entry: null });
	assert.equal(h.appended.length, 1); assert.equal(h.rows()[0].nameRevision, 1);
	assert.equal(h.events().has(timelineVersionNameEventId(uuid(2))), false, 'a no-op leaves no receipt to replay');
});

test('only a synced saved version of this account and Thing can be named; nothing is written otherwise', async () => {
	const h = harness();
	await rejects(h.service('user-1', name(1, { eventId: 'missing' })), 404, /Version not found/);
	await rejects(h.service('user-1', name(2, { eventId: 'other-thing' })), 404, /Version not found/);
	await rejects(h.service('other', name(3)), 404, /Version not found/);
	await rejects(h.service('user-1', name(4, { eventId: 'draft' })), 422, /Only a saved version can be named/);
	await rejects(h.service('user-1', name(5, { eventId: 'deleted' })), 422, /Only a saved version can be named/);
	await rejects(h.service('user-1', name(6, { eventId: 'effect' })), 422, /Only a saved version can be named/);
	assert.equal(h.rows().length, 0); assert.equal(h.appended.length, 0);
	await assert.rejects(h.service('user-1', { ...name(7), extra: true } as any), /Invalid Timeline version name command/);
	await assert.rejects(h.service('user-1', name(8, { name: 'x'.repeat(81) })), /Invalid Timeline version name command/);
	await assert.rejects(h.service('user-1', name(9, { name: '' })), /Invalid Timeline version name command/);
	assert.equal(h.rows().length, 0);
});

test('two concurrent first-time names end as one stored record: the losing insert maps the unique-index refusal to 409 after the event append serialised it', async () => {
	const h = harness();
	// The competing transaction commits between this transaction’s record read and its insert.
	h.setRace(async () => { assert.equal((await h.service('user-1', name(2, { name: 'Winner' }))).name!.name, 'Winner'); });
	await rejects(h.service('user-1', name(1, { name: 'Loser' })), 409, /changed on another device/);
	assert.equal(h.rows().length, 1); assert.equal(versionNameFromDoc(h.rows()[0]).name, 'Winner');
	assert.equal(h.events().has(timelineVersionNameEventId(uuid(2))), true); assert.equal(h.events().has(timelineVersionNameEventId(uuid(1))), false, 'the losing effect rolls back with its transaction');
	assert.equal((await h.service('user-1', name(3, { name: 'After', expectedRevision: 1 }))).name!.revision, 2);
});

test('page name reads are one bounded owner-scoped batch and refuse envelopes that drifted from their record', async () => {
	const h = harness();
	const other = await h.service('user-1', name(1, { eventId: 'other-thing', thingId: 'other-page', name: 'Other' }));
	const saved = await h.service('user-1', name(2, { name: 'Saved' }));
	assert.deepEqual(await readTimelineVersionNames(h.things, 'user-1', ['saved', 'other-thing', 'saved']), [other.name, saved.name]);
	assert.deepEqual(await readTimelineVersionNames(h.things, 'user-1', ['saved']), [saved.name]);
	assert.deepEqual(await readTimelineVersionNames(h.things, 'user-1', ['missing']), []);
	assert.deepEqual(await readTimelineVersionNames(h.things, 'user-1', []), []);
	assert.deepEqual(await readTimelineVersionNames(h.things, 'other', ['saved']), [], 'another account never sees these names');
	await assert.rejects(readTimelineVersionNames(h.things, 'user-1', Array.from({ length: 129 }, (_, n) => `event-${n}`)), /Too many/);
	const row = h.rows().find(item => item.shareId === timelineVersionNameThingId('user-1', 'saved'))!;
	for (const patch of [{ ownerId: 'other' }, { targetId: 'elsewhere' }, { crystal: { name: 'Saved' } }, { nameRevision: 2 }, { timelineVersionNameVersion: 2 }, { thingtime: ['note'] }])
		assert.throws(() => versionNameFromDoc({ ...row, ...patch }), /Timeline version name envelope/, JSON.stringify(patch));
	row.targetId = timelineEventThingId('user-1', 'other-thing');
	await assert.rejects(readTimelineVersionNames(h.things, 'user-1', ['saved']), /does not match its record/);
});
