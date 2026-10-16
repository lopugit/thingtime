import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { LocalTimeline, localTimelineScope, LOCAL_TIMELINE_FOLDER, LOCAL_TIMELINE_OWNER } from './timeline';
import { parseTimelineEntry, parseTimelineEvent } from '../timeline/contract';
import { capturedComponentBindings } from '../timeline/componentBindings';
import { searchLocalLibrary } from './librarySearch';
import { splitTimelineEvent } from '../timeline/records';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, scope = { kind: 'anonymous' } as const;
const page = (thingId: string | null = null, extra = {}) => ({ thingId, before: null, after: null, limit: 40, ...extra });

test('local content and canonical relational history commit together and survive deletion/reload', async () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory), things = new LocalThings(db, scope, lease);
 try {
  const original = await things.create({ thingtime: ['data'], crystal: { name: 'First', secretLookingText: 'caller content' } });
  await things.update({ id: original.id, crystal: { name: 'Second' } });
  await things.remove([original.id]);
  await db.close();
  const reopened = new WorkspaceDatabase(factory), history = new LocalTimeline(reopened, lease, 'https://thingtime.example');
  const result = await history.page(page(original.id));
  assert.deepEqual(result.entries.map(row => row.event.operation), ['delete', 'update', 'create']);
  result.entries.forEach(parseTimelineEntry);
  assert.deepEqual(result.entries[0].event.parentIds, [result.entries[1].event.id]);
  assert.deepEqual(result.entries[1].event.parentIds, [result.entries[2].event.id]);
  assert.deepEqual((result.entries[1].event.after!.value as any).acl, [], 'local history invents no account audience');
  assert.equal((result.entries[1].event.before!.value as any).crystal.name, 'First');
  await reopened.transaction(scope, 'readonly', lease, async tx => {
   const events = await tx.list<any>('timeline-events'), links = await tx.list<any>('timeline-links');
   assert.equal(events.length, 3); assert.equal(links.length, 11);
   assert.ok(events.every(row => !('parentIds' in row.value.event) && !('dependencies' in row.value.event)));
   assert.deepEqual(events.find(row => row.id === result.entries[2].event.id)!.value.event, splitTimelineEvent(result.entries[2].event).event);
   assert.equal((await tx.list('things')).length, 0, 'history is excluded from generic content/export');
  });
  await reopened.close();
 } finally { await db.close(); }
});

test('history errors roll back content, and account writes never enter anonymous history', async () => {
 class RefusingHistory extends WorkspaceDatabase {
  override transaction<T>(...args: Parameters<WorkspaceDatabase['transaction']>): Promise<T> {
   const [partition, mode, guard, run] = args;
   return super.transaction(partition, mode, guard, tx => run({ ...tx, put: async (collection, id, value) => {
    if (collection === 'timeline-events') throw new Error('history quota fixture');
    return tx.put(collection, id, value);
   } })) as Promise<T>;
  }
 }
 const db = new RefusingHistory(new IDBFactory());
 try {
  const things = new LocalThings(db, scope, lease);
  await assert.rejects(things.create({ thingtime: ['data'], crystal: { name: 'Must roll back' } }), /history quota/);
  assert.equal((await things.snapshot()).length, 0);
  const account = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'account', dataPlane: 'home' } as const;
  await new LocalThings(db, account, lease).create({ thingtime: ['data'], crystal: { name: 'Account only' } });
  assert.equal((await new LocalTimeline(db, lease, account.origin).page(page())).entries.length, 0);
  await db.transaction(account, 'readonly', lease, async tx => assert.equal((await tx.list('timeline-events')).length, 0));
 } finally { await db.close(); }
});

test('local draft admission is idempotent, scoped, ancestry-checked and inert', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), history = new LocalTimeline(db, lease, 'https://thingtime.example');
 const event = parseTimelineEvent({ formatVersion: 1, id: 'local-draft', ownerId: LOCAL_TIMELINE_OWNER, thingId: 'local-target', branchId: 'draft-test', parentIds: [],
  operationId: 'operation', actorId: LOCAL_TIMELINE_OWNER, source: 'client', clientId: 'test', occurredAt: '2026-10-16T00:00:00.000Z', mode: 'draft', operation: 'create', label: 'Draft only', before: null,
  after: { adapter: 'definition-source', version: 1, value: { source: 'invalid editable JSON' } }, dependencies: [] });
 try {
  assert.deepEqual(await history.push(event), await history.push(event));
  await assert.rejects(history.push({ ...event, label: 'Changed retry' }), /identity/);
  await assert.rejects(history.push({ ...event, id: 'revision', mode: 'revision' }), /authored local drafts/);
  await assert.rejects(history.push({ ...event, id: 'foreign', ownerId: 'other' }), /authored local drafts/);
  await assert.rejects(history.push({ ...event, id: 'orphan', parentIds: ['missing'] }), /ancestry/);
  assert.throws(() => history.assertScope({ ...localTimelineScope('https://thingtime.example'), dataPlane: 'home' }), /another workspace/);
  assert.throws(() => history.assertScope(localTimelineScope('https://other.example')), /another workspace/);
  await db.transaction(scope, 'readonly', lease, async tx => assert.equal((await tx.list('things')).length, 0));
  const abort = new AbortController(); abort.abort(); await assert.rejects(history.page(page(), abort.signal), /aborted/);
  await db.transaction(scope, 'readwrite', lease, tx => tx.delete('timeline-links', 'local-draft/links/thing/0'));
  await assert.rejects(history.entry(event.id), /incomplete/);
 } finally { await db.close(); }
});

test('paged history preserves ordering and captured components after live edits', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease), history = new LocalTimeline(db, lease, 'https://thingtime.example');
 try {
  const component = await things.create({ thingtime: ['component'], crystal: { name: 'Card', componentKey: 'card', version: 1, render: { tag: 'p', children: 'Original component' } } });
  const blocks = [{ id: 'card', type: 'component', component: 'card' }];
  const webpage = await things.create({ thingtime: ['webpage'], crystal: { name: 'Page', blocks } });
  const version = (await history.page(page(webpage.id))).entries[0];
  await things.update({ id: component.id, crystal: { render: { tag: 'p', children: 'Changed component' } } });
  const captured = await history.componentBindings(version.event.id);
  const bindings = capturedComponentBindings(version.event, captured.entries.map(row => row.event), blocks);
  assert.equal(bindings.components.card?.crystal.render.children, 'Original component');
  for (let n = 0; n < 43; n++) await things.update({ id: webpage.id, crystal: { name: `Page ${n}` } });
  const first = await history.page(page(webpage.id)), second = await history.page(page(webpage.id, { before: first.nextBefore }));
  assert.equal(first.entries.length, 40); assert.equal(second.entries.length, 4); assert.equal(second.nextBefore, null);
  assert.equal(new Set([...first.entries, ...second.entries].map(row => row.event.id)).size, 44);
  const newer = await history.page(page(webpage.id, { after: second.entries[0].receipt.position }));
  assert.ok(newer.entries.every((row, n) => !n || row.receipt.position > newer.entries[n - 1].receipt.position));
  await assert.rejects(history.page(page(null, { before: -1 })), /Invalid/);
  const latest = first.entries[0];
  assert.deepEqual(latest.event.dependencies, first.entries[1].event.dependencies, 'unchanged captures are reused');
  await things.remove([webpage.id]);
  const removed = (await history.page(page(webpage.id))).entries[0];
  assert.deepEqual(removed.event.dependencies, latest.event.dependencies, 'deletion retains exact saved captures');
  assert.equal((await history.componentBindings(removed.event.id)).entries.length, 1);
 } finally { await db.close(); }
});

test('large local revisions stay canonical and paged within the response byte budget', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease), history = new LocalTimeline(db, lease, 'https://thingtime.example');
 try {
  const created = await things.create({ thingtime: ['data'], crystal: { name: 'Large', body: Array.from({ length: 170 }, () => 'x'.repeat(5000)) } });
  for (let n = 0; n < 4; n++) await things.update({ id: created.id, crystal: { name: `Large ${n}` } });
  const first = await history.page(page(created.id));
  assert.equal(first.entries.length, 2); assert.ok(first.nextBefore);
  assert.ok(new TextEncoder().encode(JSON.stringify(first)).length < 4 * 1024 * 1024 + 4096);
  const second = await history.page(page(created.id, { before: first.nextBefore }));
  assert.equal(second.entries.length, 2);
  assert.equal((first.entries[0].event.after!.value as any).crystal.body.join('').length, 850_000);
  const header = await db.transaction(scope, 'readonly', lease, tx => tx.get<any>('timeline-index', first.entries[0].event.id));
  await db.transaction(scope, 'readwrite', lease, tx => tx.put('timeline-index', header.id, { ...header, bytes: -1 }));
  await assert.rejects(history.page(page()), /index is damaged/);
  await db.transaction(scope, 'readwrite', lease, tx => tx.put('timeline-index', header.id, { ...header, bytes: 1 }));
  await assert.rejects(history.entry(header.id), /does not match/);
 } finally { await db.close(); }
});

test('two database connections serialize history ordering and retired leases cannot write', async () => {
 const factory = new IDBFactory(), first = new WorkspaceDatabase(factory), second = new WorkspaceDatabase(factory);
 let current = true;
 const guarded = { assertCurrent() { if (!current) throw new Error('Workspace changed'); }, onInvalidate: () => () => {} };
 const a = new LocalThings(first, scope, guarded), b = new LocalThings(second, scope, guarded);
 try {
  await Promise.all(Array.from({ length: 8 }, (_, n) => (n % 2 ? a : b).create({ thingtime: ['data'], crystal: { name: `Concurrent ${n}` } })));
  const history = new LocalTimeline(first, guarded, 'https://thingtime.example');
  const rows = (await history.page(page())).entries;
  assert.deepEqual(rows.map(row => row.receipt.position), [8, 7, 6, 5, 4, 3, 2, 1]);
  current = false;
  await assert.rejects(a.create({ thingtime: ['data'], crystal: { name: 'Retired' } }), /Workspace changed/);
  await assert.rejects(history.page(page()), /Workspace changed/);
  assert.equal((await new LocalTimeline(second, lease, 'https://thingtime.example').page(page())).entries.length, 8);
 } finally { await first.close(); await second.close(); }
});


test('Timeline is discoverable in the local library but never becomes editable or portable content', async () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory), things = new LocalThings(db, scope, lease);
 try {
  assert.equal((await things.list()).things.length, 0);
  assert.equal(await things.hasReference(LOCAL_TIMELINE_FOLDER), false);
  const row = await things.create({ thingtime: ['data'], crystal: { name: 'Local history source' } });
  const folder = (await things.list({ folder: 'root', thingtime: 'folder' })).things[0];
  assert.equal(folder.id, LOCAL_TIMELINE_FOLDER);
  assert.equal(folder.crystal.name, 'Timeline');
  assert.equal(await things.hasReference(folder.id), true);
  assert.deepEqual(await things.get(folder.id), folder);
  const first = await things.list({ limit: 1 }), second = await things.list({ limit: 1, cursor: first.nextCursor! });
  assert.equal(new Set([...first.things, ...second.things].map(item => item.id)).size, 2);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(searchLocalLibrary(await things.librarySnapshot(), { q: 'Timeline' }).things.map(item => item.id), [folder.id]);
  assert.deepEqual((await things.snapshot()).map(item => item.id), [row.id]);
  const { manifest } = await things.export([row.id]);
  assert.deepEqual(manifest.things.map(item => item.id), [row.id]);
  for (const attempt of [
   () => things.update({ id: folder.id, crystal: { name: 'Renamed' } }),
   () => things.move([folder.id], null), () => things.remove([folder.id], true),
   () => things.remove([row.id, folder.id], true), () => things.export([folder.id]),
   () => things.move([row.id], folder.id),
   () => things.create({ thingtime: ['data'], crystal: {}, folderId: folder.id }),
   () => things.create({ thingtime: ['data'], crystal: {}, targetId: folder.id }),
   () => things.import(manifest, folder.id)
  ]) await assert.rejects(attempt(), (error: any) => error.code === 'MANAGED_KIND');
  assert.equal((await things.snapshot()).length, 1, 'failed mixed operations are atomic');
  assert.deepEqual(await things.get(folder.id), folder);
  const account = new LocalThings(db, { kind: 'account', origin: 'https://thingtime.example', ownerId: 'account', dataPlane: 'home' }, lease);
  assert.equal((await account.librarySnapshot()).length, 0);
  assert.equal(await account.hasReference(folder.id), false);
  await assert.rejects(account.get(folder.id), /not in this workspace/);
  await things.remove([row.id]);
  assert.deepEqual(await things.get(folder.id), folder, 'folder stays after deleting current content');
  await db.close();
  const reopened = new WorkspaceDatabase(factory);
  try { assert.deepEqual(await new LocalThings(reopened, scope, lease).get(folder.id), folder); }
  finally { await reopened.close(); }
 } finally { await db.close(); }
});
