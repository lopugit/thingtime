import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { WorkspaceDatabase } from './storage';
const fixture = () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory);
 const scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
 const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 let time = Date.now(); const remote = new Map<string, AccountThing>(), calls: any[] = [];
 const sync = new AccountThingSync(db, scope, lease, () => time);
 const transport: AccountSyncTransport = {
  get: async id => { const row = remote.get(id); if (!row) throw { status: 404 }; return structuredClone(row); },
  write: async operation => {
   calls.push(structuredClone(operation)); const old = remote.get(operation.id);
   if ((operation.method === 'create' && old) || (operation.method === 'update' && (!old || old.updatedAt !== operation.body.expectedUpdatedAt))) throw { status: 409 };
   const row = { ...operation.body, id: operation.id, author: { id: 'owner' }, createdAt: old?.createdAt || new Date(time).toISOString(), updatedAt: new Date(++time).toISOString(), revision: 1 } as AccountThing;
   remote.set(row.id, row); return row;
  },
  remove: async operation => {
   calls.push(structuredClone(operation)); const old = remote.get(operation.id);
   if (!old) throw { status: 404 }; if (old.updatedAt !== operation.body.expectedUpdatedAt) throw { status: 409 };
   remote.delete(operation.id);
  }
 };
 const create = (name = 'Delete fixture', kind = 'data', extra = {}) => sync.things.create({ thingtime: [kind], crystal: { name }, ...extra });
 return { factory, db, scope, lease, sync, remote, calls, transport, create, tick: () => { time += 120_000; } };
};
test('target-linked deletion waits for a conflicting child before removing its parent', async () => {
 const f = fixture(); try {
  const parent = await f.create('Parent'), child = await f.create('Linked child', 'data', { targetId: parent.id });
  await f.sync.sync(f.transport); f.calls.length = 0;
  await f.sync.remove([parent.id]); assert.equal(await f.sync.view(child.id), null);
  const remote = f.remote.get(child.id)!;
  f.remote.set(child.id, { ...remote, updatedAt: new Date(Date.parse(remote.updatedAt) + 1).toISOString() });
  await f.sync.sync(f.transport); await f.sync.sync(f.transport);
  assert.deepEqual(f.calls.map(call => [call.method, call.id]), [['delete', child.id]]);
  assert.equal(f.remote.has(parent.id), true);
  const review = await f.sync.inspectConflict(f.transport, child.id);
  await f.sync.resolveConflict(f.transport, { id: child.id, keep: 'local', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  await f.sync.sync(f.transport);
  assert.deepEqual(f.calls.slice(1).map(call => [call.method, call.id]), [['delete', child.id], ['delete', parent.id]]);
 } finally { await f.db.close(); }
});
test('identity retirement fences a delayed delete acknowledgment', async () => {
 const f = fixture(); let active = true;
 f.lease.assertCurrent = () => { if (!active) throw new Error('Workspace changed'); };
 try {
  const row = await f.create(); await f.sync.sync(f.transport); await f.sync.remove([row.id]);
  let finish!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), held = new Promise<void>(resolve => { finish = resolve; });
  const run = f.sync.sync({ ...f.transport, remove: async operation => { await f.transport.remove!(operation, new AbortController().signal); started(); await held; } });
  await ready; active = false; finish(); await assert.rejects(run, /Workspace changed/);
  active = true;
  assert.equal((await f.sync.status())[0].state, 'syncing'); assert.equal(await f.sync.view(row.id), null);
  f.tick(); await f.sync.sync(f.transport); assert.equal((await f.sync.status())[0].state, 'synced');
 } finally { active = true; await f.db.close(); }
});
test('keeping a linked account version prevents its pending parent deletion from cascading it away', async () => {
 const f = fixture(); try {
  const parent = await f.create('Parent'), child = await f.create('Linked child', 'data', { targetId: parent.id });
  await f.sync.sync(f.transport); await f.sync.remove([parent.id]);
  const remote = f.remote.get(child.id)!;
  f.remote.set(child.id, { ...remote, updatedAt: new Date(Date.parse(remote.updatedAt) + 1).toISOString() });
  await f.sync.sync(f.transport);
  const review = await f.sync.inspectConflict(f.transport, child.id);
  await f.sync.resolveConflict(f.transport, { id: child.id, keep: 'remote', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  await f.sync.sync(f.transport);
  assert.equal(f.remote.has(child.id), true); assert.equal(f.remote.has(parent.id), true);
  const parentStatus = (await f.sync.status()).find(row => row.id === parent.id)!;
  assert.equal(parentStatus.state, 'error'); assert.match(parentStatus.error!, /linked Thing/);
  await f.sync.remove([child.id]); await f.sync.retry(parent.id); await f.sync.sync(f.transport);
  assert.equal(f.remote.has(parent.id), false); assert.equal(f.remote.has(child.id), false);
 } finally { await f.db.close(); }
});
test('never-sent creates delete atomically without remote mutation or orphaned queue', async () => {
 const f = fixture(); try {
  const row = await f.create(); await f.sync.remove([row.id]); await f.sync.sync(f.transport);
  assert.deepEqual(f.calls, []); assert.deepEqual(await f.sync.status(), []); assert.equal(await f.sync.view(row.id), null);
 } finally { await f.db.close(); }
});
test('deletion survives reload, lost responses and stale readback without resurrection', async () => {
 const f = fixture(); let reopened: WorkspaceDatabase | undefined;
 try {
  const row = await f.create(); await f.sync.sync(f.transport); const stale = structuredClone(f.remote.get(row.id)!);
  await f.sync.remove([row.id]); await f.sync.remember(stale); assert.equal(await f.sync.view(row.id), null);
  await f.sync.sync({ ...f.transport, get: async () => { throw new Error('offline'); }, remove: async op => { await f.transport.remove!(op, new AbortController().signal); throw new Error('lost'); } });
  const operation = structuredClone(f.calls.at(-1)); f.tick(); await f.db.close(); reopened = new WorkspaceDatabase(f.factory);
  const resumed = new AccountThingSync(reopened, f.scope, f.lease);
  await resumed.retry(row.id); await resumed.sync(f.transport);
  assert.deepEqual(f.calls.at(-1), operation); assert.equal((await resumed.status())[0].state, 'synced');
  await resumed.remember(stale); assert.equal(await resumed.view(row.id), null); assert.equal(await resumed.isDeleted(row.id), true);
 } finally { await (reopened || f.db).close(); }
});
for (const refused of [false, true]) test(`delete during in-flight create preserves intent (create refused: ${refused})`, async () => {
 const f = fixture(); try {
  const row = await f.create(); let finish!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), held = new Promise<void>(resolve => { finish = resolve; });
  const run = f.sync.sync({ ...f.transport, write: async op => { started(); await held; if (refused) throw { status: 422 }; return f.transport.write(op, new AbortController().signal); } });
  await ready; await f.sync.remove([row.id]); finish(); await run;
  if (refused) { await f.sync.retry(row.id); await f.sync.sync(f.transport); assert.deepEqual(f.calls, []); }
  else assert.deepEqual(f.calls.map(call => call.method), ['create', 'delete']);
  assert.equal(f.remote.has(row.id), false); assert.equal(await f.sync.view(row.id), null); assert.equal((await f.sync.status())[0].state, 'synced');
 } finally { await f.db.close(); }
});
test('folder deletion drains children before removal and preserves nested content', async () => {
 const f = fixture(); try {
  const parent = await f.create('Parent', 'folder'), folder = await f.create('Folder', 'folder', { folderId: parent.id });
  const child = await f.create('Child', 'folder', { folderId: folder.id }), nested = await f.create('Nested', 'data', { folderId: child.id });
  await f.sync.sync(f.transport); f.calls.length = 0;
  await f.sync.remove([folder.id]); assert.equal((await f.sync.view(child.id))!.folderId, parent.id); assert.equal((await f.sync.view(nested.id))!.folderId, child.id);
  await f.sync.sync(f.transport); assert.deepEqual(f.calls.map(call => [call.method, call.id]), [['update', child.id], ['delete', folder.id]]);
  assert.equal(f.remote.get(child.id)!.folderId, parent.id); assert.equal(f.remote.has(nested.id), true);
 } finally { await f.db.close(); }
});
test('delete conflicts require review; keep-account restores and keep-local deletes only the reviewed version', async () => {
 const f = fixture(); try {
  const row = await f.create(); await f.sync.sync(f.transport); await f.sync.remove([row.id]);
  const changed = { ...f.remote.get(row.id)!, crystal: { name: 'Changed elsewhere' }, updatedAt: new Date(Date.now() + 10_000).toISOString() }; f.remote.set(row.id, changed);
  await f.sync.sync(f.transport); assert.equal((await f.sync.status())[0].state, 'conflict'); assert.equal(await f.sync.view(row.id), null);
  let review = await f.sync.inspectConflict(f.transport, row.id); assert.equal(review.deleted, true);
  await f.sync.resolveConflict(f.transport, { id: row.id, keep: 'remote', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  assert.equal((await f.sync.view(row.id))!.crystal.name, 'Changed elsewhere'); assert.equal(await f.sync.isDeleted(row.id), false);
  await f.sync.remove([row.id]); f.remote.set(row.id, { ...changed, updatedAt: new Date(Date.now() + 20_000).toISOString() }); await f.sync.sync(f.transport);
  review = await f.sync.inspectConflict(f.transport, row.id);
  await f.sync.resolveConflict(f.transport, { id: row.id, keep: 'local', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  await f.sync.sync(f.transport); assert.equal(f.remote.has(row.id), false); assert.equal(await f.sync.view(row.id), null);
  assert.equal(f.calls.at(-1).body.expectedUpdatedAt, review.remote.updatedAt);
 } finally { await f.db.close(); }
});
test('delete batches roll back on missing content and stale editor deletion is refused', async () => {
 const f = fixture(); try {
  const row = await f.create(); await f.sync.sync(f.transport);
  await assert.rejects(f.sync.remove([row.id, 'missing']), /Open this Thing/); assert.ok(await f.sync.view(row.id));
  await f.sync.things.update({ id: row.id, crystal: { name: 'Newer' } });
  await assert.rejects(f.sync.remove([row.id], row.updatedAt), /changed/); assert.ok(await f.sync.view(row.id));
 } finally { await f.db.close(); }
});
test('delete claims serialize across tabs and permission refusals never become successful readback', async () => {
 const f = fixture(), secondDb = new WorkspaceDatabase(f.factory), second = new AccountThingSync(secondDb, f.scope, f.lease);
 try {
  const row = await f.create(); await f.sync.sync(f.transport); await f.sync.remove([row.id]); f.calls.length = 0;
  let reads = 0;
  await f.sync.sync({ ...f.transport, remove: async () => { throw { status: 403 }; }, get: async () => { reads++; throw { status: 404 }; } });
  assert.equal(reads, 0); assert.equal((await f.sync.status())[0].state, 'error'); assert.equal(f.remote.has(row.id), true);
  await f.sync.retry(row.id); await Promise.all([f.sync.sync(f.transport), second.sync(f.transport)]);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'delete');
 } finally { await f.db.close(); await secondDb.close(); }
});
test('a deletion conflict can safely check again after another device already deleted it', async () => {
 const f = fixture(); try {
  const row = await f.create(); await f.sync.sync(f.transport); await f.sync.remove([row.id]);
  f.remote.set(row.id, { ...f.remote.get(row.id)!, updatedAt: new Date(Date.now() + 50_000).toISOString() });
  await f.sync.sync(f.transport); assert.equal((await f.sync.status())[0].state, 'conflict');
  f.remote.delete(row.id); await f.sync.retry(row.id); await f.sync.sync(f.transport);
  assert.equal((await f.sync.status())[0].state, 'synced');
 } finally { await f.db.close(); }
});
test('large cached deletion keeps one bounded recovery copy and releases it after acknowledgement', async () => {
 const f = fixture(); try {
  const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Large', parts: Array.from({ length: 120 }, () => 'x'.repeat(5000)) } }); await f.sync.sync(f.transport);
  await f.sync.remove([row.id]); assert.equal(await f.sync.view(row.id), null);
  await f.sync.sync(f.transport);
  const retained = await f.db.transaction(f.scope, 'readonly', f.lease, tx => tx.get('thing-deletions', row.id));
  assert.equal(retained, undefined); assert.equal(await f.sync.isDeleted(row.id), true);
 } finally { await f.db.close(); }
});
