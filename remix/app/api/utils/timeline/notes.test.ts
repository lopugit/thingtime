import assert from 'node:assert/strict';
import test from 'node:test';
import { Binary } from 'mongodb';
import { createNoteService, noteFromDoc, readTimelineNotes, timelineNoteThingId } from './notes.ts';
import { timelineEventThingId, timelineFolderId } from './repository.ts';
import { entryFixture, eventFixture } from '../../../timeline/testFixtures.ts';
import type { TimelineEntry } from '../../../timeline/contract.ts';
import { TIMELINE_NOTE_KIND, TIMELINE_NOTES_PER_EVENT, timelineNoteId, type TimelineNoteCommand } from '../../../timeline/notes.ts';
import { StorageMutationError, USER_STORAGE_ACCOUNTING_VERSION } from '../storage/storageCore.ts';
import { fromBin } from '../auth/binary.ts';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const add = (n: number, overrides: Partial<Extract<TimelineNoteCommand, { command: 'add-note' }>> = {}): TimelineNoteCommand =>
	({ command: 'add-note', operationId: uuid(n), eventId: 'saved', thingId: 'page-1', text: `Note ${n}`, ...overrides });
const explain = (n: number, overrides: Partial<Extract<TimelineNoteCommand, { command: 'explain-change' }>> = {}): TimelineNoteCommand =>
	({ command: 'explain-change', operationId: uuid(n), eventId: 'saved', thingId: 'page-1', ...overrides });
const remove = (n: number, noteId: string): TimelineNoteCommand => ({ command: 'remove-note', operationId: uuid(n), noteId });
const rejects = async (work: Promise<unknown>, status: number, pattern: RegExp) =>
	assert.rejects(work, (error: any) => error instanceof StorageMutationError && error.status === status && pattern.test(error.message));

function harness(options: { billable?: boolean } = {}) {
	let rows: any[] = [{ _id: 'db-folder', shareId: timelineFolderId('user-1'), ownerId: 'user-1', thingtime: ['folder'], updatedAt: new Date(0) }]; let charge = 0; let clock = Date.parse('2026-10-13T09:00:00.000Z');
	const touches: Date[] = []; let failDebit=false;
	const session = { inTransaction: () => true }; const ai: string[] = []; let reply: string | null = 'The title changed from Hello to World through the editor.';
	const match = (row: any, filter: any) => Object.entries(filter).every(([key, value]: any) => {
		if (value?.$in) return value.$in.includes(row[key]);
        if (value && Object.prototype.hasOwnProperty.call(value, '$ne')) return row[key] !== value.$ne;
		return Array.isArray(row[key]) ? row[key].includes(value) : row[key] === value;
	});
	const things = {
		findOne: async (filter: any) => rows.find(row => match(row, filter)) ?? null,
		updateOne: async (filter: any, update: any, options: any) => { assert.equal(options.session, session); const index = rows.findIndex(row => match(row, filter)); if (index === -1) return { matchedCount: 0 }; rows[index] = { ...rows[index], ...update.$set }; touches.push(update.$set.updatedAt); return { matchedCount: 1 }; },
		find: (filter: any, options?: any) => {
			if (options?.session) assert.equal(options.session, session);
			let selected = rows.filter(row => match(row, filter));
			const cursor = { sort: (order: any) => { selected.sort((a, b) => order.createdAt * (a.createdAt.getTime() - b.createdAt.getTime())); return cursor; }, limit: (n: number) => { selected = selected.slice(0, n); return cursor; }, toArray: async () => selected };
			return cursor;
		},
		countDocuments: async (filter: any, options: any) => { if (options.session) assert.equal(options.session, session); assert.equal(options.limit, TIMELINE_NOTES_PER_EVENT); return Math.min(rows.filter(row => match(row, filter)).length, options.limit); },
		insertOne: async (doc: any, options: any) => { assert.equal(options.session, session); assert.ok(!rows.some(row => row.shareId === doc.shareId)); rows.push({ _id: `db-${rows.length}`, ...doc }); },
		replaceOne: async (filter: any, next: any, options: any) => { assert.equal(options.session, session); const index = rows.findIndex(row => match(row, filter)); assert.ok(index >= 0); rows[index] = {_id:rows[index]._id,...next}; return {matchedCount:1}; },
		deleteOne: async (filter: any, options: any) => { assert.equal(options.session, session); const index = rows.findIndex(row => match(row, filter)); if (index === -1) return { deletedCount: 0 }; rows.splice(index, 1); return { deletedCount: 1 }; }
	};
	const events = new Map<string, TimelineEntry>([['saved', entryFixture(eventFixture('saved'))], ['other-thing', entryFixture(eventFixture('other-thing', { thingId: 'other-page' }))]]);
	const service = createNoteService({
		collection: async () => things as any,
		transaction: async work => { const before = [...rows]; const oldCharge = charge; try { return await work(session); } catch (error) { rows = before; charge = oldCharge; throw error; } },
		debit: async (owner, bytes, tx) => { assert.ok(['user-1','other'].includes(owner)); assert.equal(tx, session); if(failDebit){failDebit=false;throw new Error('Quota transaction refused');} charge += bytes; },
		billable: () => options.billable ?? true, now: () => new Date(clock += 1000),
		entries: async (_things, ownerId, ids) => ids.flatMap(id => { const entry = events.get(id); return entry && entry.event.ownerId === ownerId ? [entry] : []; }),
		explain: async entry => { ai.push(entry.event.id); if (reply === null) throw new StorageMutationError(503, 'storage_invariant', 'Lopu could not explain this change right now. Try again in a moment.'); return reply; }
	});
	return { things, service, ai, failNextDebit:()=>{failDebit=true;}, rows: () => rows.filter(row => row._id !== 'db-folder'), folder: () => rows.find(row => row._id === 'db-folder'), touches, charge: () => charge, reply: (value: string | null) => { reply = value; } };
}

test('an owner note is one protected relational Thing beside its event, metered once, and an exact retry returns it without a second write', async () => {
	const h = harness();
	const result = await h.service('user-1', add(1));
	assert.equal(result.ok, true); assert.ok('note' in result);
	const eventShareId = timelineEventThingId('user-1', 'saved');
	assert.deepEqual(result.note, { formatVersion: 1, id: timelineNoteId(uuid(1)), ownerId: 'user-1', eventId: 'saved', thingId: 'page-1', author: 'owner', text: 'Note 1', createdAt: '2026-10-13T09:00:01.000Z' });
	assert.equal(h.rows().length, 1);
	const doc = h.rows()[0];
	assert.equal(doc.shareId, timelineNoteThingId('user-1', result.note.id));
	assert.deepEqual(doc.thingtime, [TIMELINE_NOTE_KIND]); assert.deepEqual(doc.acl, ['tt:user']);
	assert.equal(doc.folderId, timelineFolderId('user-1')); assert.equal(doc.parentId, null); assert.equal(doc.targetId, eventShareId);
	assert.deepEqual(doc.crystal, { name: 'Note', targetId: eventShareId, linkKind: TIMELINE_NOTE_KIND });
	assert.equal(doc.timelineNoteVersion, 1); assert.ok(doc.secure instanceof Binary);
	assert.deepEqual(JSON.parse(fromBin(doc.secure)), result.note); assert.deepEqual(noteFromDoc(doc), result.note);
	assert.equal(doc.storageClass, 'content'); assert.equal(doc.storageAccountingVersion, USER_STORAGE_ACCOUNTING_VERSION);
	assert.ok(Number.isSafeInteger(doc.sizeBytes) && doc.sizeBytes > 0); assert.equal(h.charge(), doc.sizeBytes);
	assert.equal('text' in doc || 'eventId' in doc || 'notes' in doc, false, 'note content lives only in the secure envelope');
	assert.deepEqual(await h.service('user-1', add(1)), result);
	assert.equal(h.rows().length, 1); assert.equal(h.charge(), doc.sizeBytes);
	await rejects(h.service('user-1', add(1, { text: 'Other text' })), 409, /already used for another note/);
	await rejects(h.service('user-1', add(1, { eventId: 'other-thing', thingId: 'other-page' })), 409, /already used/);
	await rejects(h.service('user-1', explain(1)), 409, /already used/);
	assert.equal(h.rows().length, 1); assert.equal(h.charge(), doc.sizeBytes); assert.deepEqual(h.ai, []);
});

test('a note needs its exact event in this account’s history before anything is written', async () => {
	const h = harness();
	await rejects(h.service('user-1', add(1, { eventId: 'missing' })), 404, /not in your history yet/);
	await rejects(h.service('user-1', add(2, { thingId: 'other-page' })), 404, /not in your history yet/);
	await rejects(h.service('other', add(3)), 404, /not in your history yet/);
	await rejects(h.service('user-1', explain(4, { eventId: 'missing' })), 404, /not in your history yet/);
	assert.equal(h.rows().length, 0); assert.equal(h.charge(), 0); assert.deepEqual(h.ai, [], 'Lopu is never asked about a change outside this history');
	await assert.rejects(h.service('user-1', { ...add(5), extra: true } as any), /Invalid Timeline note/);
	await assert.rejects(h.service('user-1', add(6, { text: 'x'.repeat(2001) })), /Invalid Timeline note/);
	assert.equal(h.rows().length, 0);
});

test('an event holds at most eight notes; retries of stored notes still replay once the event is full', async () => {
	const h = harness();
	for (let n = 1; n <= TIMELINE_NOTES_PER_EVENT; n++) assert.equal((await h.service('user-1', add(n))).ok, true);
	const charged = h.charge();
	await rejects(h.service('user-1', add(9)), 413, /already has 8 notes\. Remove one to add another\./);
	await rejects(h.service('user-1', explain(10)), 413, /already has 8 notes/);
	assert.equal(h.rows().length, TIMELINE_NOTES_PER_EVENT); assert.equal(h.charge(), charged); assert.deepEqual(h.ai, [], 'Lopu is not asked about a change that is already full');
	assert.equal((await h.service('user-1', add(3))).ok, true);
	assert.equal((await h.service('user-1', add(11, { eventId: 'other-thing', thingId: 'other-page' }))).ok, true, 'the cap is per event');
	assert.equal(h.rows().length, TIMELINE_NOTES_PER_EVENT + 1);
});

test('removing notes erases text, meters a minimal identity fence and refuses delayed add/explain retries', async () => {
 const h = harness();
 const owner = await h.service('user-1', add(1)), lopu = await h.service('user-1', explain(2));
 assert.ok('note' in owner && 'note' in lopu);
 const before=h.charge();
 assert.deepEqual(await h.service('user-1',remove(3,owner.note.id)),{ok:true,removed:true,noteId:owner.note.id});
 const fence=h.rows().find(row=>row.shareId===timelineNoteThingId('user-1',owner.note.id));
 assert.equal(fence.timelineNoteRemoved,true);assert.ok(h.charge()<before);assert.equal(JSON.stringify(fence).includes('Note 1'),false);
 assert.deepEqual(Object.keys(JSON.parse(fromBin(fence.secure))).sort(),['formatVersion','id','ownerId','removedAt']);
 const charge=h.charge();await h.service('user-1',remove(3,owner.note.id));await h.service('user-1',remove(4,owner.note.id));assert.equal(h.charge(),charge);
 await rejects(h.service('user-1',add(1)),409,/removed/);await rejects(h.service('user-1',explain(1)),409,/removed/);
 assert.deepEqual(h.ai,['saved'],'Removed identities never run inference again');
 await h.service('other',remove(5,lopu.note.id));assert.ok(await h.things.findOne({ownerId:'user-1',shareId:timelineNoteThingId('user-1',lopu.note.id),timelineNoteRemoved:{$ne:true}}));
 await h.service('user-1',remove(6,lopu.note.id));assert.deepEqual(await readTimelineNotes(h.things,'user-1',['saved']),[]);
 assert.equal(h.charge(),h.rows().reduce((sum,row)=>sum+row.sizeBytes,0));
 const unknown=timelineNoteId(uuid(10));await h.service('user-1',remove(11,unknown));await rejects(h.service('user-1',add(10)),409,/removed/);
 const fresh=await h.service('user-1',add(12));assert.ok('note' in fresh,'New identities can still be authored');
});

test('Lopu is asked once per request id, outside the transaction, and the stored explanation replays without a second model call', async () => {
	const h = harness();
	const first = await h.service('user-1', explain(1));
	assert.ok('note' in first);
	assert.deepEqual(first.note, { formatVersion: 1, id: timelineNoteId(uuid(1)), ownerId: 'user-1', eventId: 'saved', thingId: 'page-1', author: 'lopu', text: 'The title changed from Hello to World through the editor.', createdAt: '2026-10-13T09:00:01.000Z' });
	assert.deepEqual(h.ai, ['saved']); assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].storageClass, 'content');
	h.reply('A different answer.');
	assert.deepEqual(await h.service('user-1', explain(1)), first);
	assert.deepEqual(h.ai, ['saved'], 'a retry never asks Lopu again');
	await rejects(h.service('user-1', explain(1, { eventId: 'other-thing', thingId: 'other-page' })), 409, /already used/);
	await rejects(h.service('user-1', add(1, { text: 'The title changed from Hello to World through the editor.' })), 409, /already used/);
	assert.deepEqual(h.ai, ['saved']);
	const second = await h.service('user-1', explain(2));
	assert.ok('note' in second); assert.equal(second.note.text, 'A different answer.'); assert.deepEqual(h.ai, ['saved', 'saved']);
	assert.equal(h.rows().length, 2); assert.equal(h.charge(), h.rows()[0].sizeBytes + h.rows()[1].sizeBytes);
});

test('an unavailable explanation refuses with 503 and stores nothing; the next request may try again', async () => {
	const h = harness(); h.reply(null);
	await rejects(h.service('user-1', explain(1)), 503, /could not explain this change right now/);
	assert.deepEqual(h.ai, ['saved']); assert.equal(h.rows().length, 0); assert.equal(h.charge(), 0);
	h.reply('Second time lucky.');
	const stored = await h.service('user-1', explain(1));
	assert.ok('note' in stored); assert.equal(stored.note.text, 'Second time lucky.'); assert.deepEqual(h.ai, ['saved', 'saved']);
});

test('a custom database stores notes without storage accounting, and removal refunds nothing', async () => {
	const h = harness({ billable: false });
	const result = await h.service('user-1', add(1)); assert.ok('note' in result);
	assert.equal(h.rows()[0].storageClass, undefined); assert.equal(h.rows()[0].sizeBytes, undefined); assert.equal(h.charge(), 0);
	assert.deepEqual(await h.service('user-1', remove(2, result.note.id)), { ok: true, removed: true, noteId: result.note.id });
	assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].timelineNoteRemoved,true); assert.equal(h.charge(), 0);
});

test('page note reads are one bounded owner-scoped batch in createdAt order and refuse envelopes that drifted from their record', async () => {
	const h = harness();
	const later = await h.service('user-1', add(1, { eventId: 'other-thing', thingId: 'other-page' }));
	const earlier = await h.service('user-1', add(2)); const third = await h.service('user-1', add(3));
	assert.ok('note' in later && 'note' in earlier && 'note' in third);
	assert.deepEqual(await readTimelineNotes(h.things, 'user-1', ['saved', 'other-thing', 'saved']), [later.note, earlier.note, third.note]);
	assert.deepEqual(await readTimelineNotes(h.things, 'user-1', ['saved']), [earlier.note, third.note]);
	assert.deepEqual(await readTimelineNotes(h.things, 'user-1', ['missing']), []);
	assert.deepEqual(await readTimelineNotes(h.things, 'user-1', []), []);
	assert.deepEqual(await readTimelineNotes(h.things, 'other', ['saved']), [], 'another account never sees these notes');
	await assert.rejects(readTimelineNotes(h.things, 'user-1', Array.from({ length: 129 }, (_, n) => `event-${n}`)), /Too many/);
	const row = h.rows().find(item => item.shareId === timelineNoteThingId('user-1', third.note.id))!;
	for (const patch of [{ ownerId: 'other' }, { targetId: 'elsewhere' }, { crystal: { name: 'Change' } }, { timelineNoteVersion: 2 }, { thingtime: ['note'] }])
		assert.throws(() => noteFromDoc({ ...row, ...patch }), /Timeline note envelope/);
	row.targetId = timelineEventThingId('user-1', 'other-thing');
	await assert.rejects(readTimelineNotes(h.things, 'user-1', ['saved', 'other-thing']), /does not match its record/);
});

test('every note write touches the Timeline folder inside the transaction so concurrent adds serialize at the cap', async () => {
	const h = harness();
	await h.service('user-1', add(1));
	assert.equal(h.touches.length, 1); assert.equal(h.folder().updatedAt, h.touches[0]);
	await h.service('user-1', add(1));
	assert.equal(h.touches.length, 1, 'an exact replay never re-enters the write path');
	await h.service('user-1', explain(2));
	assert.equal(h.touches.length, 2);
	h.folder().shareId = 'elsewhere';
	await rejects(h.service('user-1', add(3)), 404, /not in your history/);
	assert.equal(h.rows().length, 2);
});


test('failed removal accounting preserves the original note and quota atomically',async()=>{
 const h=harness();const result=await h.service('user-1',add(1));assert.ok('note' in result);const charge=h.charge();
 h.failNextDebit();await assert.rejects(h.service('user-1',remove(2,result.note.id)),/Quota transaction refused/);
 assert.equal(h.charge(),charge);assert.deepEqual(noteFromDoc(h.rows()[0]),result.note);assert.equal(h.rows()[0].timelineNoteRemoved,undefined);
 h.rows()[0].sizeBytes=0;await rejects(h.service('user-1',remove(3,result.note.id)),409,/reconciliation/);
 assert.equal(h.rows()[0].timelineNoteRemoved,undefined);assert.deepEqual(noteFromDoc(h.rows()[0]),result.note);
});
