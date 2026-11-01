import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbTimelineBackend } from './indexedDb.ts';
import { TimelineLocalStore } from './localStore.ts';
import { TimelineNoteStore } from './noteStore.ts';
import { TimelineDraftRecorder } from './draftRecorder.ts';
import { eventFixture, entryFixture } from './testFixtures.ts';
import { parseTimelineEvent, timelineScopeKey } from './contract.ts';
import { splitTimelineEvent } from './records.ts';
const scope = { ownerId: 'user-1', apiOrigin: 'https://thingtime.com', dataPlane: 'home' };

test('two IndexedDB connections commit simultaneous writes without losing another tab; reload recovers both', async () => {
 const factory = new IDBFactory(); const a = new IndexedDbTimelineBackend(factory); const b = new IndexedDbTimelineBackend(factory);
 const first = new TimelineLocalStore(scope, a); const second = new TimelineLocalStore(scope, b);
 await Promise.all([first.enqueue(eventFixture('tab-a')), second.enqueue(eventFixture('tab-b'))]);
 await Promise.all([a.close(), b.close()]);
 const reopened = new IndexedDbTimelineBackend(factory);
 assert.deepEqual((await new TimelineLocalStore(scope, reopened).pending()).map(event => event.id).sort(), ['tab-a', 'tab-b']); await reopened.close();
});
test('draft pointers survive acknowledgments and pruning; an old save cannot clear a newer edit', async () => {
 const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend);
 const old = eventFixture('old'); const next = eventFixture('next', { parentIds: [old.id] });
 await store.enqueue(old, { pinDraft: true }); await store.accept([entryFixture(old, 1)]);
 await store.prune(0, 0); assert.equal((await store.draft(old.thingId, old.branchId))?.id, old.id);
 await store.enqueue(next, { pinDraft: true }); await store.accept([entryFixture(next, 2)]);
 await store.releaseDraft(old.id); await store.prune(0, 0);
 assert.equal((await store.draft(next.thingId, next.branchId))?.id, next.id); assert.equal((await store.forThing(next.thingId)).length, 1);
 await store.releaseDraft(next.id); await store.prune(0, 0); assert.equal((await store.forThing(next.thingId)).length, 0); await backend.close();
});
test('failed IndexedDB transaction preserves events; identity conflicts never partially apply', async () => {
 const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend);
 const first = eventFixture('first'); await store.enqueue(first);
 await assert.rejects(store.accept([entryFixture(eventFixture('new')), entryFixture({ ...first, label: 'Forged replacement' })]), /identity/);
 assert.deepEqual((await store.pending()).map(event => event.id), ['first']); await backend.close();
});
test('draft capture retries failed local writes before children with the original payload', async () => {
 const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend);
 const original = store.enqueue.bind(store); let fail = true;
 store.enqueue = async (event, options) => { if (fail) { fail = false; throw new Error('disk full'); } return original(event, options); };
 let sequence = 0;
 const recorder = new TimelineDraftRecorder(store, 'page-1', 'draft-local', 'client-1', null, () => `id-${++sequence}`, () => '2026-09-27T05:00:00.000Z');
 const before = { adapter: 'webpage-draft', version: 1, value: { text: 'Before' } }; const after = { ...before, value: { text: 'After' } };
 await assert.rejects(recorder.capture(before, after, 'Type'), /disk full/); after.value.text = 'Caller changed it';
 await recorder.capture({ ...before, value: { text: 'After' } }, { ...before, value: { text: 'Next' } }, 'Type');
 const events = await store.pending(); assert.equal(events.length, 2); assert.deepEqual(events[1].parentIds, [events[0].id]);
 assert.deepEqual(events[0].after?.value, { text: 'After' }); assert.equal(recorder.hasUnwrittenChanges, false); await backend.close();
});

test('edits before Timeline connects retain their immutable ids and full chain for durable retry', async () => {
 const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend);
 let sequence = 0;
 const recorder = new TimelineDraftRecorder(null, 'page-1', 'draft-local', 'client-1', null, () => `waiting-${++sequence}`, () => '2026-09-27T05:00:00.000Z', scope.ownerId);
 const before = { adapter: 'webpage-draft', version: 1, value: { text: 'Before' } }; const after = { ...before, value: { text: 'First' } };
 await assert.rejects(recorder.capture(before, after, 'Type'), /connecting/);
 after.value.text = 'Caller changed it';
 await assert.rejects(recorder.capture({ ...before, value: { text: 'First' } }, { ...before, value: { text: 'Second' } }, 'Type'), /connecting/);
 recorder.connect(store); await recorder.flush();
 const events = await store.pending(); assert.equal(events.length, 2);
 assert.equal(events[0].id, 'waiting-1'); assert.deepEqual(events[0].after?.value, { text: 'First' });
 assert.deepEqual(events[1].parentIds, [events[0].id]); assert.equal(recorder.hasUnwrittenChanges, false);
 assert.throws(() => recorder.connect(new TimelineLocalStore({ ...scope, dataPlane: 'different' }, backend)), /data source changed/);
 await backend.close();
});

test('an invalid capture cannot later claim a successful flush', async () => {
 const backend = new IndexedDbTimelineBackend(new IDBFactory()); const store = new TimelineLocalStore(scope, backend);
 const recorder = new TimelineDraftRecorder(store, 'page-1', 'draft-local', 'client-1');
 assert.throws(() => recorder.capture({ adapter: 'webpage-draft', version: 1, value: undefined }, null, 'Type'));
 await assert.rejects(recorder.flush()); assert.equal((await store.pending()).length, 0); await backend.close();
});

const openDatabase = (factory: IDBFactory, name: string, version?: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> => new Promise((resolve, reject) => {
 const request = factory.open(name, version); request.onupgradeneeded = () => upgrade?.(request.result);
 request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const rawRows = (db: IDBDatabase, store: string): Promise<any[]> => new Promise((resolve, reject) => {
 const tx = db.transaction(store); const request = tx.objectStore(store).getAll(); tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error);
});

test('IndexedDB stores the exact shared relational records and prunes links atomically with cached events', async () => {
 const factory = new IDBFactory(); const name = 'relational'; const backend = new IndexedDbTimelineBackend(factory, name); const store = new TimelineLocalStore(scope, backend);
 const a = eventFixture('a', { parentIds: ['earlier'], dependencies: [{ thingId: 'component', eventId: 'component-revision' }] });
 const b = eventFixture('b', { dependencies: a.dependencies });
 await store.enqueue(a, { pinDraft: true }); await store.accept([entryFixture(a), entryFixture(b, 2)]);
 const db = await openDatabase(factory, name); const payloads = await rawRows(db, 'events'); const links = await rawRows(db, 'links');
 assert.deepEqual(payloads.find(row => row.event.id === 'a').event, splitTimelineEvent(a).event);
 assert.deepEqual(links.filter(row => row.link.eventId === 'a').map(row => row.link).sort((a, b) => a.id.localeCompare(b.id)), splitTimelineEvent(a).links.sort((a, b) => a.id.localeCompare(b.id)));
 assert.equal(payloads.some(row => 'parentIds' in row.event || 'dependencies' in row.event), false);
 await store.prune(0, 0);
 assert.deepEqual((await rawRows(db, 'events')).map(row => row.event.id), ['a']);
 assert.equal((await rawRows(db, 'links')).every(row => row.link.eventId === 'a'), true);
 await store.releaseDraft('a'); await store.prune(0, 0); assert.equal((await rawRows(db, 'links')).length, 0);
 db.close(); await backend.close();
});

test('a v3 database upgrades pending work to relations without reviving an already released draft', async () => {
 const factory = new IDBFactory(); const name = 'upgrade'; const event = parseTimelineEvent(eventFixture('pending', { parentIds: ['base'] }));
 const key = timelineScopeKey(scope); const old = await openDatabase(factory, name, 3, db => {
  const events = db.createObjectStore('events', { keyPath: ['scope', 'event.id'] }); events.createIndex('scope', 'scope');
  const index = db.createObjectStore('eventIndex', { keyPath: ['scope', 'id'] });
  index.createIndex('scope', 'scope'); index.createIndex('thing', ['scope', 'thingId']); index.createIndex('status', ['scope', 'status']); index.createIndex('draft', ['scope', 'draftKey']);
 });
 const row = { scope: key, event, receipt: null, status: 'pending', accessedAt: 1, bytes: new TextEncoder().encode(JSON.stringify({ event, receipt: null })).byteLength, draftKey: JSON.stringify([event.thingId, event.branchId]) };
 await new Promise<void>((resolve, reject) => {
  const tx = old.transaction(['events', 'eventIndex'], 'readwrite'); tx.objectStore('events').put(row);
  tx.objectStore('eventIndex').put({ ...row, event: undefined, id: event.id, thingId: event.thingId, occurredAt: event.occurredAt, accessedAt: 9, draftKey: null });
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
 }); old.close();
 const backend = new IndexedDbTimelineBackend(factory, name); const store = new TimelineLocalStore(scope, backend);
 assert.deepEqual(await store.pending(), [event]); assert.equal(await store.draft(event.thingId, event.branchId), null);
 const db = await openDatabase(factory, name); assert.equal(db.version, 6); assert.equal((await rawRows(db, 'links')).length, 4);
 assert.equal('parentIds' in (await rawRows(db, 'events'))[0].event, false);
 assert.equal(db.objectStoreNames.contains('notes') && db.objectStoreNames.contains('noteCommands'), true);
 db.close(); await backend.close();
});

test('a v5 database gains the note stores without re-running the relation migration over its rows', async () => {
 const factory = new IDBFactory(); const name = 'notes-upgrade'; const key = timelineScopeKey(scope);
 const command = { scope: key, command: { command: 'create-branch', operationId: '277abf25-b322-4ac0-9707-a59c36e7bcd5', branchId: 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5', thingId: 'page', eventId: 'base', expectedRevision: 0, name: 'Experiment' }, queuedAt: 1 };
 const old = await openDatabase(factory, name, 5, db => {
  const events = db.createObjectStore('events', { keyPath: ['scope', 'event.id'] }); events.createIndex('scope', 'scope');
  const index = db.createObjectStore('eventIndex', { keyPath: ['scope', 'id'] });
  index.createIndex('scope', 'scope'); index.createIndex('thing', ['scope', 'thingId']); index.createIndex('status', ['scope', 'status']); index.createIndex('draft', ['scope', 'draftKey']);
  const links = db.createObjectStore('links', { keyPath: ['scope', 'link.id'] }); links.createIndex('event', ['scope', 'link.eventId']); links.createIndex('target', ['scope', 'link.relation', 'link.targetId']);
  for (const [storeName, path] of [['branches', 'branch.id'], ['branchHeads', 'head.id'], ['branchCommands', 'command.operationId']]) db.createObjectStore(storeName, { keyPath: ['scope', path] }).createIndex('scope', 'scope');
 });
 await new Promise<void>((resolve, reject) => {
  const tx = old.transaction(['events', 'branchCommands'], 'readwrite');
  // A row the v3 migration would reject proves the cursor is skipped for v4+ databases.
  tx.objectStore('events').put({ scope: key, event: { id: 'damaged' }, receipt: null, status: 'pending', accessedAt: 1, bytes: 1 });
  tx.objectStore('branchCommands').put(command); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
 }); old.close();
 const backend = new IndexedDbTimelineBackend(factory, name);
 await new TimelineNoteStore(scope, backend).enqueue({ command: 'remove-note', operationId: '377abf25-b322-4ac0-9707-a59c36e7bcd5', noteId: 'note-477abf25-b322-4ac0-9707-a59c36e7bcd5' });
 assert.deepEqual((await backend.readBranchState(key)).pending, [command]);
 const db = await openDatabase(factory, name); assert.equal(db.version, 6);
 assert.deepEqual((await rawRows(db, 'noteCommands')).map(row => row.command.operationId), ['377abf25-b322-4ac0-9707-a59c36e7bcd5']);
 assert.deepEqual([...db.transaction('notes').objectStore('notes').indexNames].sort(), ['event', 'scope']);
 db.close(); await backend.close();
});

test('note rows survive reload and concurrent tabs as per-record rows; an invalid note write aborts without partial application', async () => {
 const factory = new IDBFactory(); const name = 'notes'; const a = new IndexedDbTimelineBackend(factory, name); const b = new IndexedDbTimelineBackend(factory, name);
 const note = { formatVersion: 1 as const, id: 'note-277abf25-b322-4ac0-9707-a59c36e7bcd5', ownerId: scope.ownerId, eventId: 'base', thingId: 'page', author: 'owner' as const, text: 'Why', createdAt: '2026-09-27T05:02:00.000Z' };
 const removal = { command: 'remove-note' as const, operationId: '377abf25-b322-4ac0-9707-a59c36e7bcd5', noteId: note.id };
 await Promise.all([new TimelineNoteStore(scope, a).accept([note]), new TimelineNoteStore(scope, b).enqueue(removal)]);
 await Promise.all([a.close(), b.close()]);
 const backend = new IndexedDbTimelineBackend(factory, name); const store = new TimelineNoteStore(scope, backend);
 assert.deepEqual((await store.forEvents(['base'])).get('base'), [note]); assert.deepEqual(await store.pending(), [removal]);
 const key = timelineScopeKey(scope);
 await assert.rejects(backend.changeNoteState(key, state => ({ notes: [{ scope: 'forged', note: { ...note, id: 'note-477abf25-b322-4ac0-9707-a59c36e7bcd5' }, accessedAt: 1 }], pending: [] })), /scope changed/);
 await assert.rejects(backend.changeNoteState(key, () => { throw new Error('disk full'); }), /disk full/);
 const db = await openDatabase(factory, name);
 assert.deepEqual((await rawRows(db, 'notes')).map(row => [row.scope, row.note.id]), [[key, note.id]]);
 assert.deepEqual((await rawRows(db, 'noteCommands')).map(row => [row.scope, row.command.operationId]), [[key, removal.operationId]]);
 await store.removed([note.id], removal.operationId);
 assert.equal((await rawRows(db, 'notes')).length + (await rawRows(db, 'noteCommands')).length, 0);
 db.close(); await backend.close();
});

test('a missing local relationship fails closed without deleting the recoverable pending row', async () => {
 const factory = new IDBFactory(); const name = 'missing-link'; const backend = new IndexedDbTimelineBackend(factory, name); const store = new TimelineLocalStore(scope, backend);
 const event = eventFixture('pending'); await store.enqueue(event);
 const db = await openDatabase(factory, name); const links = await rawRows(db, 'links');
 await new Promise<void>((resolve, reject) => {
  const tx = db.transaction('links', 'readwrite'); tx.objectStore('links').delete([links[0].scope, links[0].link.id]); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
 });
 await assert.rejects(store.pending(), /incomplete/);
 assert.equal((await rawRows(db, 'events')).length, 1); assert.equal((await rawRows(db, 'eventIndex')).length, 1);
 db.close(); await backend.close();
});


test('a corrected bounded draft can save after a rejected oversized capture', async () => {
 const saved: any[] = [];
 const recorder = new TimelineDraftRecorder({ scope, enqueue: async (event: any) => { saved.push(event); } } as any, 'page-1', 'draft-fixed', 'client-1');
 const snapshot = (value: unknown) => ({ adapter: 'definition-source', version: 1, value });
 assert.throws(() => recorder.capture(snapshot({ source: '' }), snapshot('x'.repeat(4 * 1024 * 1024)), 'Too large'));
 await assert.rejects(recorder.flush());
 await recorder.capture(snapshot({ source: '' }), snapshot({ source: '{}' }), 'Corrected');
 await recorder.flush(); assert.equal(saved.length, 1); assert.equal(saved[0].label, 'Corrected');
});

test('related views select only matching event headers and retain canonical rows through reload', async () => {
 const factory = new IDBFactory(); const backend = new IndexedDbTimelineBackend(factory);
 const store = new TimelineLocalStore(scope, backend);
 await store.accept([entryFixture(eventFixture('page'), 3), entryFixture(eventFixture('component', { thingId: 'component' }), 2), entryFixture(eventFixture('unrelated', { thingId: 'other' }), 1)]);
 await store.enqueue(eventFixture('draft', { thingId: 'component' }));
 await backend.close();
 const reopened = new IndexedDbTimelineBackend(factory); const current = new TimelineLocalStore(scope, reopened);
 assert.deepEqual((await current.forThings(['page-1', 'component'])).map(row => row.event.id), ['draft', 'page', 'component']);
 await current.prune(0, 0);
 assert.deepEqual((await current.forThings(['page-1', 'component'])).map(row => row.event.id), ['draft']);
 await reopened.close();
});
