import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { LocalTimeline, LOCAL_TIMELINE_OWNER } from './timeline';
import { parseTimelineNoteResult, parseTimelineNoteRemoval } from '../timeline/notes';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, scope = { kind: 'anonymous' } as const;
const page = { thingId: null, before: null, after: null, limit: 40 };
async function fixture(db: WorkspaceDatabase) {
 const thing = await new LocalThings(db, scope, lease).create({ thingtime: ['data'], crystal: { name: 'Local notes' } });
 const history = new LocalTimeline(db, lease, 'https://thingtime.example');
 const event = (await history.page(page)).entries[0].event;
 const add = () => ({ command: 'add-note' as const, operationId: randomUUID(), eventId: event.id, thingId: thing.id, text: 'Why this changed.\nA plain text note.' });
 return { history, event, add };
}

test('canonical notes survive reopen, batch with their events, and do not modify content or events', async () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory);
 const { history, event, add } = await fixture(db), command = add();
 try {
  const original = (await history.entry(event.id)).entry;
  const result = parseTimelineNoteResult(await history.note(command), LOCAL_TIMELINE_OWNER, command);
  assert.deepEqual(await history.note(command), result, 'uncertain retries reuse their original note');
  assert.deepEqual((await history.entry(event.id)).entry, original);
  await assert.rejects(history.note({ ...command, text: 'Changed request' }), /already used/);
  await db.close();
  const reopened = new WorkspaceDatabase(factory);
  try {
   const loaded = await new LocalTimeline(reopened, lease, history.origin).page(page);
   assert.equal(loaded.notes.length, 1);
   assert.equal(loaded.notes[0].text, command.text);
   assert.equal(loaded.notes[0].author, 'owner');
   await reopened.transaction(scope, 'readonly', lease, async tx => {
    assert.equal((await tx.list('timeline-notes')).length, 1);
    assert.equal((await tx.list('things')).length, 1);
    assert.equal((await tx.list('timeline-events')).length, 1);
   });
   await reopened.transaction({ kind: 'account', ownerId: 'other', origin: history.origin, dataPlane: 'home' }, 'readonly', lease, async tx => assert.equal((await tx.list('timeline-notes')).length, 0));
  } finally { await reopened.close(); }
 } finally { await db.close(); }
});

test('two tabs enforce the shared note cap atomically and removal cannot be undone by a delayed retry', async () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory), other = new WorkspaceDatabase(factory);
 try {
  const { history, add, event } = await fixture(db), second = new LocalTimeline(other, lease, history.origin);
  const commands = Array.from({ length: 10 }, add);
  const results = await Promise.allSettled(commands.map((command, n) => (n % 2 ? second : history).note(command)));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 8);
  assert.ok(results.filter(row => row.status === 'rejected').every(row => row.status === 'rejected' && row.reason.status === 413));
  assert.equal((await history.entry(event.id)).notes.length, 8);
  const first = results.findIndex(row => row.status === 'fulfilled'), noteId = `note-${commands[first].operationId}`;
  const remove = { command: 'remove-note' as const, operationId: randomUUID(), noteId };
  parseTimelineNoteResult(await history.note(remove), LOCAL_TIMELINE_OWNER, remove);
  assert.deepEqual(await second.note(remove), { ok: true, removed: true, noteId });
  await assert.rejects(second.note(commands[first]), /was removed/);
  await history.note(add());
  assert.equal((await history.entry(event.id)).notes.length, 8);
  const neverAdded = add();
  await history.note({ ...remove, operationId: randomUUID(), noteId: `note-${neverAdded.operationId}` });
  await assert.rejects(second.note(neverAdded), /was removed/);
 } finally { await db.close(); await other.close(); }
});

test('invalid targets, invalid text, cancelled scopes and provider explanations fail without a note write', async () => {
 const db = new WorkspaceDatabase(new IDBFactory());
 try {
  const { history, add, event } = await fixture(db);
  await assert.rejects(history.note({ ...add(), thingId: 'other' }), /not in your local History/);
  await assert.rejects(history.note({ ...add(), eventId: 'missing' }), /not in your local History/);
  for (const text of ['', 'x'.repeat(2001), '\u0000bad', ' padded ']) await assert.rejects(history.note({ ...add(), text }), /Invalid/);
  await assert.rejects(history.note({ command: 'explain-change', operationId: randomUUID(), eventId: event.id, thingId: event.thingId }), /inference service/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(history.note(add(), cancelled.signal), /aborted/);
  const retired = new LocalTimeline(db, { ...lease, assertCurrent() { throw new Error('retired'); } }, history.origin);
  await assert.rejects(retired.note(add()), /retired/);
  assert.deepEqual((await history.entry(event.id)).notes, []);
 } finally { await db.close(); }
});

test('failed deletion marker rolls back note deletion and quota together', async () => {
 class Refusing extends WorkspaceDatabase {
  refuse = false;
  override transaction<T>(...args: Parameters<WorkspaceDatabase['transaction']>): Promise<T> {
   const [partition, mode, guard, run] = args;
   return super.transaction(partition, mode, guard, tx => run({ ...tx, put: async (collection, id, value) => {
    if (this.refuse && id.startsWith('removed-note:')) throw new Error('injected quota refusal');
    return tx.put(collection, id, value);
   } })) as Promise<T>;
  }
 }
 const db = new Refusing(new IDBFactory());
 try {
  const { history, add, event } = await fixture(db), command = add(); await history.note(command);
  db.refuse = true;
  await assert.rejects(history.note({ command: 'remove-note', operationId: randomUUID(), noteId: `note-${command.operationId}` }), /quota refusal/);
  assert.equal((await history.entry(event.id)).notes.length, 1);
  assert.deepEqual(await history.note(command), { ok: true, note: (await history.entry(event.id)).notes[0] });
 } finally { await db.close(); }
});

test('corrupt note ownership and event linkage fail explicitly', async () => {
 const db = new WorkspaceDatabase(new IDBFactory());
 try {
  const { history, add, event } = await fixture(db), result = await history.note(add());
  assert.ok('note' in result); if (!('note' in result)) return;
  await db.transaction(scope, 'readwrite', lease, tx => tx.put('timeline-notes', result.note.id, { ...result.note, ownerId: 'other' }));
  await assert.rejects(history.page(page), /identity is damaged/);
  await db.transaction(scope, 'readwrite', lease, tx => tx.put('timeline-notes', result.note.id, { ...result.note, thingId: 'other' }));
  await assert.rejects(history.entry(event.id), /target is damaged/);
 } finally { await db.close(); }
});

test('page byte limits include multibyte notes and return notes only for the selected events', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease), history = new LocalTimeline(db, lease, 'https://thingtime.example');
 try {
  const thing = await things.create({ thingtime: ['data'], crystal: { name: 'Large', body: Array.from({ length: 207 }, () => 'x'.repeat(5000)) } });
  await things.update({ id: thing.id, crystal: { name: 'Large two' } });
  await things.update({ id: thing.id, crystal: { name: 'Large three' } });
  const initial = await history.page(page);
  assert.equal(initial.entries.length, 2);
  for (const { event } of initial.entries) for (let n = 0; n < 8; n++) await history.note({ command: 'add-note', operationId: randomUUID(), eventId: event.id, thingId: thing.id, text: '終'.repeat(2000) });
  const first = await history.page(page);
  assert.equal(first.entries.length, 1);
  assert.equal(first.notes.length, 8);
  assert.ok(first.notes.every(note => note.eventId === first.entries[0].event.id));
  assert.ok(new TextEncoder().encode(JSON.stringify(first)).length <= 4 * 1024 * 1024 + 4096);
  const next = await history.page({ ...page, before: first.nextBefore });
  assert.equal(next.notes.length, 8);
  assert.ok(next.notes.every(note => note.eventId === initial.entries[1].event.id));
 } finally { await db.close(); }
});

test('legacy removal markers upgrade to the shared payload-free record without reusing removed identities',async()=>{
 const db=new WorkspaceDatabase(new IDBFactory());try{
  const {history,add}=await fixture(db),command=add(),id='note-'+command.operationId,key='removed-note:'+id;
  await db.transaction(scope,'readwrite',lease,tx=>tx.put('timeline-meta',key,true));
  await assert.rejects(history.note(command),/removed/);
  await history.note({command:'remove-note',operationId:randomUUID(),noteId:id});
  await db.transaction(scope,'readonly',lease,async tx=>{const record=parseTimelineNoteRemoval(await tx.get('timeline-meta',key));assert.equal(record.id,id);assert.equal(record.ownerId,LOCAL_TIMELINE_OWNER);assert.deepEqual(Object.keys(record).sort(),['formatVersion','id','ownerId','removedAt']);});
  await db.transaction(scope,'readwrite',lease,tx=>tx.put('timeline-meta',key,false));
  await assert.rejects(history.note(command),/Invalid Timeline note removal/);
 }finally{await db.close();}
});
