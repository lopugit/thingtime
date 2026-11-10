import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb.ts';
import { TimelineNoteStore, TIMELINE_NOTE_CACHE_LIMIT, TIMELINE_NOTE_PENDING_LIMIT, historyNoteViews } from './noteStore.ts';
import { TimelineLocalStore } from './localStore.ts';
import { TimelineSync, TimelineNoteCommandRefusal } from './sync.ts';
import { parseTimelineNoteCommand, timelineNoteId, type TimelineNote, type TimelineNoteCommand } from './notes.ts';
import { entryFixture, eventFixture } from './testFixtures.ts';

const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.com', dataPlane: 'home' };
const operationId = '277abf25-b322-4ac0-9707-a59c36e7bcd5';
const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-b322-4ac0-9707-a59c36e7bcd5`;
type Authored = Exclude<TimelineNoteCommand, { command: 'remove-note' }>;
const add = (eventId = 'base', id = operationId, text = 'Why this changed') => parseTimelineNoteCommand({ command: 'add-note', operationId: id, eventId, thingId: 'page', text }) as Extract<Authored, { command: 'add-note' }>;
const explain = (eventId = 'base', id = operationId) => parseTimelineNoteCommand({ command: 'explain-change', operationId: id, eventId, thingId: 'page' }) as Extract<Authored, { command: 'explain-change' }>;
const remove = (noteId: string, id = uuid(9)) => parseTimelineNoteCommand({ command: 'remove-note', operationId: id, noteId });
const noteFor = (command: Authored, overrides: Partial<TimelineNote> = {}): TimelineNote => ({
	formatVersion: 1, id: timelineNoteId(command.operationId), ownerId: scope.ownerId, eventId: command.eventId, thingId: command.thingId,
	author: command.command === 'add-note' ? 'owner' : 'lopu', text: command.command === 'add-note' ? command.text : 'Lopu renamed the page.', createdAt: '2026-09-27T05:02:00.000Z', ...overrides
});
const cached = async (store: TimelineNoteStore, eventId: string) => ((await store.forEvents([eventId])).get(eventId) ?? []).map(note => note.id);

test('note commands survive reload and concurrent tabs without changing immutable request identities', async () => {
	const factory = new IDBFactory(); const a = new IndexedDbTimelineBackend(factory); const b = new IndexedDbTimelineBackend(factory);
	await Promise.all([new TimelineNoteStore(scope, a).enqueue(add()), new TimelineNoteStore(scope, b).enqueue(add('base', uuid(2)))]);
	await Promise.all([a.close(), b.close()]);
	const backend = new IndexedDbTimelineBackend(factory); const reopened = new TimelineNoteStore(scope, backend);
	assert.equal((await reopened.pending()).length, 2);
	await reopened.enqueue(add()); assert.equal((await reopened.pending()).length, 2);
	await assert.rejects(reopened.enqueue(add('base', operationId, 'Changed retry')), /identity/);
	await assert.rejects(reopened.enqueue({ ...add(), text: ' padded ' }), /Invalid/);
	assert.equal((await reopened.queued()).find(row => row.command.operationId === operationId)?.command.command, 'add-note');
	for (const other of [{ ...scope, ownerId: 'other' }, { ...scope, apiOrigin: 'https://other.test' }, { ...scope, dataPlane: 'custom' }]) {
		assert.deepEqual(await new TimelineNoteStore(other, backend).pending(), []);
	}
	await backend.close();
});

test('the pending queue is bounded; reconnecting drains it before more notes are accepted locally', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineNoteStore(scope, backend);
	for (let n = 0; n < TIMELINE_NOTE_PENDING_LIMIT; n++) await store.enqueue(add('base', uuid(n + 1)));
	await assert.rejects(store.enqueue(add('base', uuid(1000))), /Too many note commands/);
	assert.equal((await store.pending()).length, TIMELINE_NOTE_PENDING_LIMIT);
	await backend.close();
});

test('acknowledging a queued command requires its exact note and clears only that command', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineNoteStore(scope, backend);
	const command = add(); const later = add('base', uuid(2), 'Second');
	await store.enqueue(command); await store.enqueue(later);
	await assert.rejects(store.accept([noteFor(command, { text: 'Forged' })], { operationId }), /different note command/);
	await assert.rejects(store.accept([noteFor(command, { eventId: 'other' })], { operationId }), /different note command/);
	await assert.rejects(store.accept([noteFor(command, { author: 'lopu' })], { operationId }), /different note command/);
	await assert.rejects(store.accept([noteFor(command), noteFor(later)], { operationId }), /different note command/);
	await assert.rejects(store.accept([noteFor(command, { ownerId: 'other' })]), /scope/);
	assert.equal((await store.pending()).length, 2); assert.deepEqual(await cached(store, 'base'), []);
	await store.accept([noteFor(command)], { operationId });
	assert.deepEqual((await store.pending()).map(row => row.operationId), [uuid(2)]); assert.deepEqual(await cached(store, 'base'), [timelineNoteId(operationId)]);
	await store.accept([noteFor(command)], { operationId });
	await assert.rejects(store.accept([noteFor(command, { createdAt: '2026-09-27T05:03:00.000Z' })]), /identity/);
	await store.accept([noteFor(later)]);
	assert.deepEqual((await store.pending()).map(row => row.operationId), [uuid(2)]);
	assert.deepEqual(await cached(store, 'base'), [timelineNoteId(uuid(2)), timelineNoteId(operationId)]);
	assert.deepEqual(await cached(new TimelineNoteStore({ ...scope, ownerId: 'other' }, backend), 'base'), []);
	await backend.close();
});

test('an authoritative read replaces the cached notes of its events and leaves other events alone', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineNoteStore(scope, backend);
	const [first, second, other] = [add('base', uuid(1)), add('base', uuid(2)), add('other', uuid(3))];
	await store.accept([noteFor(first), noteFor(second), noteFor(other)]);
	await store.accept([noteFor(first)], { events: ['base'] });
	assert.deepEqual(await cached(store, 'base'), [timelineNoteId(uuid(1))]); assert.deepEqual(await cached(store, 'other'), [timelineNoteId(uuid(3))]);
	await store.accept([noteFor(second)], { events: ['other'] });
	assert.deepEqual(await cached(store, 'base'), [timelineNoteId(uuid(1)), timelineNoteId(uuid(2))]); assert.deepEqual(await cached(store, 'other'), []);
	assert.deepEqual([...(await store.forEvents(['base', 'other', 'missing'])).keys()], ['base']);
	await backend.close();
});

test('the note cache evicts the least recently accepted notes at its limit', async () => {
	let clock = 0; const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineNoteStore(scope, backend, () => ++clock);
	const notes = Array.from({ length: TIMELINE_NOTE_CACHE_LIMIT }, (_, n) => noteFor(add(`event-${n % 64}`, uuid(n + 1))));
	await assert.rejects(store.accept(notes.slice(0, 321)), /scope/);
	for (let n = 0; n < notes.length; n += 320) await store.accept(notes.slice(n, n + 320));
	await store.accept([notes[0]]);
	await store.accept([noteFor(add('event-99', uuid(5000)))]);
	const kept = [...(await store.forEvents(notes.map(note => note.eventId).concat('event-99'))).values()].flat();
	assert.equal(kept.length, TIMELINE_NOTE_CACHE_LIMIT);
	assert.equal(kept.some(note => note.id === notes[0].id), true); assert.equal(kept.some(note => note.id === notes[1].id), false);
	assert.equal(kept.some(note => note.id === timelineNoteId(uuid(5000))), true);
	await backend.close();
});

test('a definitive refusal can be retried or dismissed, while an uncertain command cannot be dismissed', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineNoteStore(scope, backend);
	await store.enqueue(add());
	await assert.rejects(store.dismissRejected(operationId), /check its result/);
	await assert.rejects(store.reject(operationId, 500, 'Server error'), /uncertain/);
	await store.reject(operationId, 413, 'x'.repeat(600));
	assert.deepEqual(await store.pending(), []); assert.equal((await store.queued())[0].failure?.message.length, 512);
	await store.retryRejected(operationId); assert.deepEqual(await store.pending(), [add()]);
	await store.reject(operationId, 404, 'Sync it first'); await store.dismissRejected(operationId);
	assert.deepEqual(await store.queued(), []);
	await backend.close();
});

test('removal acknowledgments drop cached notes with their command; clearing the cache keeps queued work', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineNoteStore(scope, backend);
	const [first, second] = [add('base', uuid(1)), add('base', uuid(2))];
	await store.accept([noteFor(first), noteFor(second)]);
	const removal = remove(timelineNoteId(uuid(1))); await store.enqueue(removal);
	await assert.rejects(store.removed([timelineNoteId(uuid(2))], removal.operationId), /different note command/);
	await assert.rejects(store.accept([noteFor(first)], { operationId: removal.operationId }), /different note command/);
	await store.removed([timelineNoteId(uuid(1))], removal.operationId);
	assert.deepEqual(await cached(store, 'base'), [timelineNoteId(uuid(2))]); assert.deepEqual(await store.pending(), []);
	await store.removed([timelineNoteId(uuid(7))]);
	await store.enqueue(add('base', uuid(3))); await store.clearCache();
	assert.deepEqual(await cached(store, 'base'), []); assert.deepEqual(await store.pending(), [add('base', uuid(3))]);
	await backend.close();
});

test('history note views combine accepted, removing and pending notes per loaded event without duplicating an acknowledged note', () => {
	const rows = [{ event: { id: 'base' } }, { event: { id: 'next' } }];
	const accepted = noteFor(add('base', uuid(1)), { createdAt: '2026-09-27T05:05:00.000Z' });
	const synced = noteFor(add('next', uuid(4)));
	const stored = new Map([['base', [accepted]], ['next', [synced]], ['unloaded', [noteFor(add('unloaded', uuid(5)))]]]);
	const queued = [
		{ command: remove(accepted.id), failure: { status: 404, message: 'Gone' }, queuedAt: 1 },
		{ command: add('base', uuid(2), 'Waiting'), failure: null, queuedAt: Date.parse('2026-09-27T05:04:00.000Z') },
		{ command: explain('base', uuid(3)), failure: { status: 409, message: 'Busy' }, queuedAt: Date.parse('2026-09-27T05:06:00.000Z') },
		{ command: add('next', uuid(4)), failure: null, queuedAt: 2 },
		{ command: add('elsewhere', uuid(6)), failure: null, queuedAt: 3 }
	] as const;
	const views = historyNoteViews(scope.ownerId, rows, stored, queued.map(row => ({ ...row })));
	assert.deepEqual([...views.keys()], ['base', 'next']);
	assert.deepEqual(views.get('base')!.map(view => [view.note.id, view.status, view.failure?.status ?? null, view.note.author, view.note.text]), [
		[timelineNoteId(uuid(2)), 'pending', null, 'owner', 'Waiting'], [accepted.id, 'removing', 404, 'owner', 'Why this changed'], [timelineNoteId(uuid(3)), 'pending', 409, 'lopu', 'Asking Lopu…']
	]);
	assert.equal(views.get('base')![0].note.createdAt, '2026-09-27T05:04:00.000Z'); assert.equal(views.get('base')![0].note.ownerId, scope.ownerId);
	assert.deepEqual(views.get('next')!.map(view => [view.note.id, view.status]), [[synced.id, 'accepted']]);
});

test('an offline note waits for its version, then syncs with its exact identity; a lost reply retries one command', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const notes = new TimelineNoteStore(scope, backend);
	const base = eventFixture('base', { thingId: 'page' }); await events.enqueue(base); await notes.enqueue(add());
	const order: string[] = []; let lost = true;
	const sync = new TimelineSync(events, {
		page: async () => { throw new Error('unused'); },
		push: async event => { order.push(event.id); return entryFixture(event); },
		note: async command => { order.push(JSON.stringify(command)); if (lost) { lost = false; throw new Error('Reply lost after commit'); } return { ok: true, note: noteFor(command as any) }; }
	}, undefined, notes);
	await assert.rejects(sync.pushPending(), /Reply lost/);
	assert.deepEqual(await events.pending(), []); assert.deepEqual(await notes.pending(), [add()]); assert.deepEqual(await cached(notes, 'base'), []);
	assert.equal(await sync.pushPending(), 1);
	assert.deepEqual(order, ['base', JSON.stringify(add()), JSON.stringify(add())]);
	assert.deepEqual(await notes.pending(), []); assert.deepEqual(await cached(notes, 'base'), [timelineNoteId(operationId)]);
	await backend.close();
});

test('a note queued during an upload waits for its new local version instead of a false missing-version refusal', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const notes = new TimelineNoteStore(scope, backend);
	await events.enqueue(eventFixture('first', { thingId: 'page' }));
	let started!: () => void; let release!: () => void;
	const uploading = new Promise<void>(resolve => { started = resolve; }); const response = new Promise<void>(resolve => { release = resolve; });
	const order: string[] = [];
	const sync = new TimelineSync(events, {
		page: async () => { throw new Error('unused'); },
		push: async event => { order.push(event.id); if (event.id === 'first') { started(); await response; } return entryFixture(event, order.length); },
		note: async command => { assert.equal(order.at(-1), (command as any).eventId); order.push('note'); return { ok: true, note: noteFor(command as any) }; }
	}, undefined, notes);
	const draining = sync.pushPending(); await uploading;
	await events.enqueue(eventFixture('latest', { thingId: 'page', parentIds: ['first'] })); await notes.enqueue(add('latest'));
	release(); assert.equal(await draining, 1);
	assert.deepEqual(order, ['first']); assert.equal((await notes.queued())[0].failure, undefined);
	assert.equal(await sync.pushPending(), 2); assert.deepEqual(order, ['first', 'latest', 'note']);
	assert.deepEqual(await notes.queued(), []); await backend.close();
});

test('a definitive note refusal is kept with the command while versions and other notes still sync', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const notes = new TimelineNoteStore(scope, backend);
	await events.enqueue(eventFixture('base', { thingId: 'page' })); await notes.enqueue(add()); await notes.enqueue(explain('base', uuid(2)));
	let refuse = true;
	const sync = new TimelineSync(events, {
		page: async () => { throw new Error('unused'); }, push: async event => entryFixture(event),
		note: async command => { if (refuse && (command as any).operationId === operationId) throw { status: 413, error: 'This change already has 8 notes. Remove one to add another.' }; return { ok: true, note: noteFor(command as any) }; }
	}, undefined, notes);
	await assert.rejects(sync.pushPending(), TimelineNoteCommandRefusal);
	assert.deepEqual(await events.pending(), []); assert.deepEqual(await cached(notes, 'base'), [timelineNoteId(uuid(2))]);
	assert.deepEqual((await notes.queued()).map(row => [row.command.operationId, row.failure?.status ?? null]), [[operationId, 413]]);
	assert.deepEqual(await notes.pending(), []);
	await notes.retryRejected(operationId); refuse = false;
	assert.equal(await sync.pushPending(), 1); assert.deepEqual(await notes.queued(), []);
	assert.deepEqual(await cached(notes, 'base'), [timelineNoteId(uuid(2)), timelineNoteId(operationId)]);
	await backend.close();
});

test('a reply naming another note, an uncertain failure or a missing transport keeps the command pending', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const notes = new TimelineNoteStore(scope, backend);
	await notes.enqueue(explain());
	let reply: any = { ok: true, note: noteFor(explain(), { author: 'owner' }) };
	const sync = new TimelineSync(events, { page: async () => { throw new Error('unused'); }, push: async () => { throw new Error('unused'); }, note: async () => reply }, undefined, notes);
	await assert.rejects(sync.pushPending(), /another note/);
	reply = { ok: true, note: noteFor(explain(), { ownerId: 'other' }) }; await assert.rejects(sync.pushPending(), /another note/);
	assert.deepEqual(await notes.pending(), [explain()]); assert.deepEqual(await cached(notes, 'base'), []);
	await assert.rejects(new TimelineSync(events, { page: async () => { throw new Error('unused'); }, push: async () => { throw new Error('unused'); } }, undefined, notes).pushPending(), /does not support note/);
	assert.deepEqual(await notes.pending(), [explain()]);
	await backend.close();
});

test('a removal syncs idempotently and is never blocked by pending versions', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const notes = new TimelineNoteStore(scope, backend);
	const note = noteFor(add()); await notes.accept([note]); await notes.enqueue(remove(note.id));
	await events.enqueue(eventFixture('base', { thingId: 'page' }));
	const calls: string[] = [];
	const sync = new TimelineSync(events, {
		page: async () => { throw new Error('unused'); }, push: async () => { throw new Error('Upload lost'); },
		note: async command => { calls.push((command as any).noteId); return { ok: true, removed: true, noteId: (command as any).noteId }; }
	}, undefined, notes);
	await assert.rejects(sync.pushPending(), /Upload lost/); assert.deepEqual(calls, []);
	const synced = new TimelineSync(events, { page: async () => { throw new Error('unused'); }, push: async event => entryFixture(event), note: async command => { calls.push((command as any).noteId); return { ok: true, removed: true, noteId: 'note-other' }; } }, undefined, notes);
	await assert.rejects(synced.pushPending(), /another note/); assert.deepEqual(calls, [note.id]); assert.deepEqual(await cached(notes, 'base'), [note.id]);
	assert.equal(await sync.pushPending(), 1); assert.deepEqual(await cached(notes, 'base'), []); assert.deepEqual(await notes.queued(), []);
	await backend.close();
});

test('page reads adopt their notes, drop stale cached notes for those events and refuse notes outside the page', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const notes = new TimelineNoteStore(scope, backend);
	const stale = noteFor(add('base', uuid(1))); const other = noteFor(add('other', uuid(2))); const fresh = noteFor(add('base', uuid(3)));
	await notes.accept([stale, other]);
	const base = entryFixture(eventFixture('base', { thingId: 'page', source: 'api', mode: 'revision', clientId: null }), 2);
	let response: any = { entries: [base], nextBefore: null, nextAfter: null, notes: [fresh] };
	const sync = new TimelineSync(events, { page: async () => response, push: async () => { throw new Error('unused'); } }, undefined, notes);
	assert.deepEqual((await sync.page('page')).notes, [fresh]);
	assert.deepEqual(await cached(notes, 'base'), [fresh.id]); assert.deepEqual(await cached(notes, 'other'), [other.id]);
	for (const notesField of [[noteFor(add('foreign', uuid(4)))], [noteFor(add('base', uuid(5), 'Mine'), { ownerId: 'other' })], [fresh, fresh], 'notes', [{ ...fresh, extra: true }]]) {
		response = { ...response, notes: notesField }; await assert.rejects(sync.page('page'), /Invalid Timeline/);
	}
	assert.deepEqual(await cached(notes, 'base'), [fresh.id]);
	response = { entries: [base], nextBefore: null, nextAfter: null }; assert.equal('notes' in await sync.page('page'), false);
	assert.deepEqual(await cached(notes, 'base'), [fresh.id]);
	response = { entries: [base], nextBefore: null, nextAfter: null, notes: [] }; await sync.page('page');
	assert.deepEqual(await cached(notes, 'base'), []); assert.deepEqual(await cached(notes, 'other'), [other.id]);
	await backend.close();
});

test('an exact version read accepts wrapped notes for that event and still accepts a bare entry', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory()); const events = new TimelineLocalStore(scope, backend); const notes = new TimelineNoteStore(scope, backend);
	const entry = entryFixture(eventFixture('base', { thingId: 'page' }), 3); const note = noteFor(add());
	let response: any = { entry, notes: [note] };
	const sync = new TimelineSync(events, { page: async () => { throw new Error('unused'); }, push: async () => { throw new Error('unused'); }, entry: async () => response }, undefined, notes);
	assert.deepEqual(await sync.entry('base'), entry); assert.deepEqual(await cached(notes, 'base'), [note.id]);
	response = entry; assert.deepEqual(await sync.entry('base'), entry); assert.deepEqual(await cached(notes, 'base'), [note.id]);
	response = { entry, notes: [noteFor(add('other'))] }; await assert.rejects(sync.entry('base'), /Invalid Timeline page/);
	response = { entry: entryFixture(eventFixture('different', { thingId: 'page' }), 4), notes: [] }; await assert.rejects(sync.entry('base'), /different version/);
	assert.deepEqual(await cached(notes, 'base'), [note.id]);
	response = { entry, notes: [] }; await sync.entry('base'); assert.deepEqual(await cached(notes, 'base'), []);
	await backend.close();
});
