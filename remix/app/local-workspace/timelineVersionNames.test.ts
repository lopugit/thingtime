import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { LocalTimeline, LOCAL_TIMELINE_OWNER } from './timeline';
import { parseTimelineVersionNameCommand, parseTimelineVersionNameResult, timelineVersionNameEventId, type TimelineVersionNameCommand } from '../timeline/versionNames';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, scope = { kind: 'anonymous' } as const;
const page = { thingId: null, before: null, after: null, limit: 40 };
async function fixture(db: WorkspaceDatabase) {
 const things = new LocalThings(db, scope, lease), history = new LocalTimeline(db, lease, 'https://thingtime.example');
 const thing = await things.create({ thingtime: ['data'], crystal: { name: 'Version names' } });
 const event = (await history.page(page)).entries[0].event;
 const command = (patch: Partial<TimelineVersionNameCommand> = {}): TimelineVersionNameCommand => ({ command: 'name-version', operationId: randomUUID(), eventId: event.id, thingId: thing.id, name: 'Original version', expectedRevision: 0, ...patch });
 return { things, history, thing, event, command };
}

test('canonical names, effects and original retry receipts persist across rename, clear and reopen', async () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory);
 try {
  const { history, event, command } = await fixture(db), first = command();
  const result = parseTimelineVersionNameResult(await history.nameVersion(first), LOCAL_TIMELINE_OWNER, first);
  assert.equal(result.name?.revision, 1);
  assert.equal(result.entry?.event.source, 'api');
  assert.equal(result.entry?.event.operationId, createHash('sha256').update(JSON.stringify(parseTimelineVersionNameCommand(first))).digest('hex'), 'local and server signatures are identical');
  assert.deepEqual(result.entry?.event.dependencies, [{ thingId: event.thingId, eventId: event.id }]);
  const renamedCommand = command({ name: 'A better name', expectedRevision: 1 });
  const renamed = await history.nameVersion(renamedCommand);
  assert.equal(renamed.name?.revision, 2);
  assert.equal(renamed.name?.createdAt, result.name?.createdAt);
  assert.ok(renamed.name!.updatedAt > result.name!.updatedAt);
  assert.deepEqual(await history.nameVersion(first), result, 'an old uncertain retry replays its receipt without changing the latest name');
  assert.deepEqual((await history.entry(event.id)).names, [renamed.name]);
  assert.deepEqual((await history.entry(event.id)).entry.event, event, 'named event remains immutable');
  const clear = command({ name: null, expectedRevision: 2 });
  const removed = parseTimelineVersionNameResult(await history.nameVersion(clear), LOCAL_TIMELINE_OWNER, clear);
  assert.equal(removed.name, null); assert.equal(removed.entry?.event.label, 'Removed version name');
  assert.deepEqual((await history.entry(event.id)).names, []);
  assert.deepEqual(await history.nameVersion(clear), removed);
  await db.close();
  const reopened = new WorkspaceDatabase(factory);
  try {
   const next = new LocalTimeline(reopened, lease, history.origin);
   assert.deepEqual((await next.entry(event.id)).names, []);
   const again = await next.nameVersion(command({ name: 'After clear' }));
   assert.equal(again.name?.revision, 4, 'the cleared revision survives reload');
   await assert.rejects(next.nameVersion(command({ name: 'Stale life', expectedRevision: 2 })), (error: any) => error.status === 409);
   assert.equal((await next.page(page)).entries.filter(row => row.event.mode === 'effect').length, 4);
   await reopened.transaction(scope, 'readonly', lease, async tx => {
    assert.equal((await tx.list('timeline-version-names')).length, 1);
    assert.equal((await tx.list('things')).length, 1);
   });
   await reopened.transaction({ kind: 'account', ownerId: 'account', origin: history.origin, dataPlane: 'home' }, 'readonly', lease, async tx => assert.equal((await tx.list('timeline-version-names')).length, 0));
  } finally { await reopened.close(); }
 } finally { await db.close(); }
});

test('simultaneous naming, changed retries and stale revisions cannot overwrite another tab', async () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory), secondDb = new WorkspaceDatabase(factory);
 try {
  const { history, command, event } = await fixture(db), other = new LocalTimeline(secondDb, lease, history.origin);
  const a = command({ name: 'Tab A' }), b = command({ name: 'Tab B' });
  const results = await Promise.allSettled([history.nameVersion(a), other.nameVersion(b)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(results.some(result => result.status === 'rejected' && result.reason.status === 409));
  const winner = results[0].status === 'fulfilled' ? a : b;
  await assert.rejects(other.nameVersion({ ...winner, name: 'Changed retry' }), /already used/);
  const current = (await history.entry(event.id)).names[0];
  assert.equal(current.name, winner.name);
  const unchanged = await other.nameVersion(command({ name: current.name, expectedRevision: current.revision }));
  assert.equal(unchanged.entry, null);
  assert.equal((await history.page(page)).entries.length, 2, 'the no-op and losing write append no effects');
 } finally { await db.close(); await secondDb.close(); }
});

test('ineligible, malformed, foreign, aborted and retired name commands never write', async () => {
 const db = new WorkspaceDatabase(new IDBFactory());
 try {
  const { history, things, thing, command } = await fixture(db);
  await assert.rejects(history.nameVersion(command({ eventId: 'missing' })), (error: any) => error.status === 404);
  await assert.rejects(history.nameVersion(command({ thingId: 'other' })), (error: any) => error.status === 404);
  for (const name of ['', ' padded', 'x'.repeat(81), 'line\nbreak']) await assert.rejects(history.nameVersion(command({ name })), /Invalid/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(history.nameVersion(command(), controller.signal), /abort/i);
  const retired = new LocalTimeline(db, { ...lease, assertCurrent() { throw new Error('retired'); } }, history.origin);
  await assert.rejects(retired.nameVersion(command()), /retired/);
  const result = await history.nameVersion(command());
  await assert.rejects(history.nameVersion(command({ eventId: result.entry!.event.id })), (error: any) => error.status === 422);
  await things.remove([thing.id]);
  const deletion = (await history.page(page)).entries[0];
  await assert.rejects(history.nameVersion(command({ eventId: deletion.event.id })), (error: any) => error.status === 422);
  assert.equal((await history.page(page)).entries.filter(row => row.event.mode === 'effect').length, 1);
 } finally { await db.close(); }
});

test('failure after appending a name effect rolls back its name, links and ordering', async () => {
 class Refusing extends WorkspaceDatabase {
  refuse = true;
  override transaction<T>(...args: Parameters<WorkspaceDatabase['transaction']>): Promise<T> {
   const [partition, mode, guard, run] = args;
   return super.transaction(partition, mode, guard, tx => run({ ...tx, put: async (collection, id, value) => {
    if (this.refuse && collection === 'timeline-version-names') throw new Error('injected name quota');
    return tx.put(collection, id, value);
   } })) as Promise<T>;
  }
 }
 const db = new Refusing(new IDBFactory());
 try {
  const { history, command, event } = await fixture(db), request = command();
  await assert.rejects(history.nameVersion(request), /name quota/);
  assert.equal((await history.page(page)).entries.length, 1);
  assert.deepEqual((await history.entry(event.id)).names, []);
  await assert.rejects(history.entry(timelineVersionNameEventId(request.operationId)), /not stored/);
  db.refuse = false;
  const retried = await history.nameVersion(request);
  assert.equal(retried.entry?.receipt.position, 2);
  assert.equal(retried.name?.revision, 1);
 } finally { await db.close(); }
});

test('damaged name identity/state fails closed; pages attach names only to selected events', async () => {
 const db = new WorkspaceDatabase(new IDBFactory());
 try {
  const { history, event, command } = await fixture(db), result = await history.nameVersion(command());
  assert.deepEqual((await history.page({ ...page, limit: 1 })).names, [], 'the latest effect does not inherit the target version name');
  assert.deepEqual((await history.page({ ...page, before: result.entry!.receipt.position })).names, [result.name]);
  await db.transaction(scope, 'readwrite', lease, tx => tx.put('timeline-meta', `name-state:${event.id}`, { revision: 0, updatedAt: result.name!.updatedAt }));
  await assert.rejects(history.nameVersion(command({ expectedRevision: 1, name: 'No bypass' })), /metadata is damaged/);
  await db.transaction(scope, 'readwrite', lease, tx => tx.put('timeline-version-names', result.name!.id, { ...result.name, ownerId: 'foreign' }));
  await assert.rejects(history.entry(event.id), /metadata is damaged/);
 } finally { await db.close(); }
});
