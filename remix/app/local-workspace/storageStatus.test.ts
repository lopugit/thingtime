import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, workspaceScopeKey, type WorkspaceLease, type WorkspaceScope } from './storage';
import { storageProtection } from './storagePersistence';
import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from './storageStatus.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';

const anonymous = { kind: 'anonymous' } as const;
const account = { kind: 'account', origin: 'https://storage.example', ownerId: 'owner', dataPlane: 'home' } as const;
const guard = () => {
 let active = true; const listeners = new Set<() => void>();
 const lease: WorkspaceLease = { assertCurrent() { if (!active) throw new Error('Workspace changed'); }, onInvalidate(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
 return { lease, invalidate() { active = false; for (const fn of listeners) fn(); }, listeners };
};
const fixture = () => { const factory = new IDBFactory(); return { factory, db: new WorkspaceDatabase(factory, 'usage-test', 10_000, IDBKeyRange), ...guard() }; };
const read = (db: WorkspaceDatabase, scope: WorkspaceScope, lease: WorkspaceLease) => db.transaction(scope, 'readonly', lease, tx => tx.usage());
async function ledger(factory: IDBFactory, value: unknown) {
 const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = factory.open('usage-test', 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
 try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('usage', 'readwrite'); if (value === null) tx.objectStore('usage').delete(workspaceScopeKey(anonymous)); else tx.objectStore('usage').put(value); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); }
 finally { db.close(); }
}

test('device usage counts exact logical bytes and records in only the selected partition', async () => {
 const h = fixture();
 try {
  assert.deepEqual(await read(h.db, anonymous, h.lease), { bytes: 0, records: 0 });
  const value = { text: 'Local 🦄' }, bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  await h.db.transaction(anonymous, 'readwrite', h.lease, async tx => { await tx.put('things', 'one', value); await tx.putBytes('file', new Uint8Array(12)); });
  for (const scope of [account, { ...account, ownerId: 'other' }, { ...account, origin: 'https://other.example' }, { ...account, dataPlane: 'other' }])
   await h.db.transaction(scope, 'readwrite', h.lease, tx => tx.put('drafts', 'private', { text: 'Account only' }));
  assert.deepEqual(await read(h.db, anonymous, h.lease), { bytes: bytes + 12, records: 2 });
  const accountUsage = await read(h.db, account, h.lease);
  assert.equal(accountUsage.records, 1); assert.equal('scope' in accountUsage, false);
  await assert.rejects(h.db.transaction(anonymous, 'readwrite', h.lease, async tx => { await tx.put('things', 'rollback', value); throw new Error('rollback'); }));
  assert.deepEqual(await read(h.db, anonymous, h.lease), { bytes: bytes + 12, records: 2 });
  await h.db.transaction(anonymous, 'readwrite', h.lease, async tx => { await tx.delete('things', 'one'); await tx.deleteBytes('file'); });
  assert.deepEqual(await read(h.db, anonymous, h.lease), { bytes: 0, records: 0 });
  await h.db.transaction(anonymous, 'readwrite', h.lease, tx => tx.putBytes('empty', new Uint8Array()));
  assert.deepEqual(await read(h.db, anonymous, h.lease), { bytes: 0, records: 1 }, 'zero-byte files are valid');
  assert.deepEqual(await read(h.db, account, h.lease), accountUsage);
 } finally { await h.db.close(); }
});

test('account usage includes delegated Character bytes only for this principal, origin and plane', async () => {
 const h = fixture(), actor = { ...account, ownerId: 'actor', delegatedBy: account.ownerId };
 const included = [account, actor, { ...actor, ownerId: 'actor-two' }];
 const excluded = [anonymous, { ...account, ownerId: 'actor' }, { ...account, ownerId: 'other' }, { ...actor, delegatedBy: 'other' }, { ...actor, origin: 'https://other.example' }, { ...actor, dataPlane: 'other' }];
 try {
  for (const [index, scope] of [...included, ...excluded].entries())
   await h.db.transaction(scope, 'readwrite', h.lease, async tx => { await tx.put('drafts', 'same-id', { text: 'Private draft' }); await tx.putBlob('file', new Blob([new Uint8Array(index + 1)])); });
  const expected = { bytes: 0, records: 0 };
  for (const scope of included) { const usage = await read(h.db, scope, h.lease); expected.bytes += usage.bytes; expected.records += usage.records; }
  assert.deepEqual(await h.db.accountUsage(account, h.lease), expected);
  assert.deepEqual(await h.db.accountUsage({ ...account, ownerId: 'actor' }, h.lease), await read(h.db, { ...account, ownerId: 'actor' }, h.lease));
  await assert.rejects(h.db.accountUsage(actor, h.lease), /signed-in account/);
  await assert.rejects(h.db.accountUsage(anonymous as any, h.lease), /signed-in account/);
  h.invalidate(); await assert.rejects(h.db.accountUsage(account, h.lease), /Workspace changed/);
 } finally { await h.db.close(); }
});

test('account totals refuse missing and orphaned Character ledgers without changing saved content', async () => {
 const h = fixture(), actor = { ...account, ownerId: 'actor', delegatedBy: account.ownerId }, key = workspaceScopeKey(actor);
 try {
  await h.db.transaction(actor, 'readwrite', h.lease, tx => tx.put('drafts', 'one', { text: 'Retain me' }));
  const usage = await read(h.db, actor, h.lease);
  const native = await new Promise<IDBDatabase>((resolve, reject) => { const req = h.factory.open('usage-test'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const edit = (run: (tx: IDBTransaction) => void) => new Promise<void>((resolve, reject) => { const tx = native.transaction(['records','usage'], 'readwrite'); run(tx); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  try {
   await edit(tx => tx.objectStore('usage').delete(key));
   await assert.rejects(h.db.accountUsage(account, h.lease), (error: any) => error.code === 'LOCAL_ACCOUNTING_UNAVAILABLE');
   assert.deepEqual(await h.db.transaction(actor, 'readonly', h.lease, tx => tx.get('drafts','one')), { text: 'Retain me' });
   await edit(tx => { tx.objectStore('usage').put({ scope:key, ...usage }); tx.objectStore('records').delete([key,'drafts','one']); });
   await assert.rejects(h.db.accountUsage(account, h.lease), (error: any) => error.code === 'LOCAL_ACCOUNTING_UNAVAILABLE');
   await edit(tx => tx.objectStore('usage').put({ scope:key, bytes:0, records:0 }));
   assert.deepEqual(await h.db.accountUsage(account, h.lease), { bytes:0, records:0 });
  } finally { native.close(); }
 } finally { await h.db.close(); }
});

test('account usage traverses every retained Character and stops when the root identity retires', async () => {
 const h = fixture();
 try {
  for (let i = 0; i < 257; i++)
   await h.db.transaction({ ...account, ownerId:`actor-${i}`, delegatedBy:account.ownerId }, 'readwrite', h.lease, tx => tx.putBytes('file', new Uint8Array(1)));
  assert.deepEqual(await h.db.accountUsage(account, h.lease), { bytes:257, records:257 });
  let checks = 0;
  await assert.rejects(h.db.accountUsage(account, { ...h.lease, assertCurrent() { if (++checks === 20) h.invalidate(); h.lease.assertCurrent(); } }), /Workspace changed/);
  assert.deepEqual(await h.db.accountUsage(account, guard().lease), { bytes:257, records:257 }, 'Cancelled accounting does not mutate content');
 } finally { await h.db.close(); }
});

test('missing or damaged usage is unavailable, never an empty successful meter; content stays intact', async () => {
 const h = fixture(), value = { text: 'Retain me' }, bytes = new TextEncoder().encode(JSON.stringify(value)).length;
 try {
  await h.db.transaction(anonymous, 'readwrite', h.lease, tx => tx.put('things', 'one', value));
  const valid = { scope: workspaceScopeKey(anonymous), records: 1, bytes };
  for (const damaged of [null, { ...valid, records: 0 }, { ...valid, bytes: -1 }, { ...valid, bytes: NaN }, { ...valid, bytes: '0' }, { ...valid, bytes: Infinity }]) {
   await ledger(h.factory, damaged);
   await assert.rejects(read(h.db, anonymous, h.lease), (error: any) => error.code === 'LOCAL_ACCOUNTING_UNAVAILABLE');
   assert.deepEqual(await h.db.transaction(anonymous, 'readonly', h.lease, tx => tx.get('things', 'one')), value);
  }
  await ledger(h.factory, valid); assert.deepEqual(await read(h.db, anonymous, h.lease), { bytes, records: 1 });
  h.invalidate(); await assert.rejects(read(h.db, anonymous, h.lease), /Workspace changed/);
 } finally { await h.db.close(); }
});

test('storage protection is read-only until requested and reports denial, unsupported, timeout and failures', async () => {
 const h = guard(); let writes = 0;
 const manager = { persisted: async () => false, persist: async () => { writes++; return false; } };
 assert.equal(await storageProtection(manager, h.lease), 'best-effort'); assert.equal(writes, 0);
 assert.equal(await storageProtection(manager, h.lease, true), 'best-effort'); assert.equal(writes, 1);
 assert.equal(await storageProtection({ ...manager, persist: async () => true }, h.lease, true), 'persistent');
 assert.equal(await storageProtection({ ...manager, persisted: async () => true }, h.lease, true), 'persistent'); assert.equal(writes, 1);
 assert.equal(await storageProtection(undefined, h.lease), 'unsupported');
 assert.equal(await storageProtection({ persisted: async () => false }, h.lease), 'unsupported');
 await assert.rejects(storageProtection({ ...manager, persisted: async () => { throw new Error('storage disabled'); } }, h.lease), /storage disabled/);
 await assert.rejects(storageProtection({ ...manager, persisted: async () => 'unknown' as any }, h.lease, true), /did not report/); assert.equal(writes, 1);
 await assert.rejects(storageProtection({ ...manager, persisted: () => new Promise<boolean>(() => {}) }, h.lease, false, 10), (error: any) => error.code === 'LOCAL_PERSISTENCE_TIMEOUT');
 let complete!: (value: boolean) => void;
 const late = storageProtection({ ...manager, persisted: () => new Promise<boolean>(resolve => { complete = resolve; }) }, h.lease, true, 10);
 await assert.rejects(late, (error: any) => error.code === 'LOCAL_PERSISTENCE_TIMEOUT');
 complete(false); await new Promise(resolve => setTimeout(resolve, 0));
 assert.equal(writes, 1, 'a timed-out check cannot start a delayed protection request');
 assert.equal(h.listeners.size, 0);
});

test('retiring a workspace cancels a pending persistence check and cannot request protection later', async () => {
 const h = guard(); let complete!: (value: boolean) => void, writes = 0;
 const pending = storageProtection({ persisted: () => new Promise<boolean>(resolve => { complete = resolve; }), persist: async () => { writes++; return true; } }, h.lease, true);
 h.invalidate(); await assert.rejects(pending, /Workspace changed/);
 complete(false); await new Promise(resolve => setTimeout(resolve, 0));
 assert.equal(writes, 0); assert.equal(h.listeners.size, 0);
});

test('storage settings clear identity immediately and read offline account scope without remote confirmation', async () => {
 const original = { indexedDB: globalThis.indexedDB, IDBKeyRange: globalThis.IDBKeyRange, fetch: globalThis.fetch };
 Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange, fetch: async () => { throw new Error('No network permitted'); } });
 let changes = 0; const off = subscribeWorkspaceStorage(() => changes++);
 try {
  bindLocalWorkspace(true, rootIdentity.read().generation);
  const local = workspaceStorageBinding()!;
  await workspaceDatabase().transaction(anonymous, 'readwrite', local.lease, tx => tx.put('things', 'one', { text: 'Anonymous' }));
  assert.equal((await local.read()).records, 1);
  const factory = globalThis.indexedDB;
  Object.assign(globalThis, { indexedDB: undefined });
  await assert.rejects(local.read(), /Browser storage is unavailable/);
  Object.assign(globalThis, { indexedDB: factory });
  rootIdentity.changed(); assert.equal(workspaceStorageIdentity(), ''); await assert.rejects(local.read(), /Workspace changed/);
  const generation = rootIdentity.read().generation; rootIdentity.confirm(generation); bindLocalWorkspace(false, generation, account, false);
  const offline = workspaceStorageBinding()!; assert.equal(offline.scope.kind, 'account'); assert.notEqual(offline.identity, local.identity);
  assert.deepEqual(await offline.read(), { bytes: 0, records: 0 });
  await workspaceDatabase().transaction(account, 'readwrite', offline.lease, tx => tx.put('things', 'one', { text: 'Account' }));
  assert.equal((await offline.read()).records, 1);
  await workspaceDatabase().transaction({ ...account, ownerId:'actor', delegatedBy:account.ownerId }, 'readwrite', offline.lease, tx => tx.put('drafts', 'one', { text:'Character' }));
  assert.equal((await offline.read()).records, 2, 'Settings includes the same principal’s delegated draft storage while offline');
  bindLocalWorkspace(true, generation); assert.equal((await workspaceStorageBinding()!.read()).records, 1);
  await assert.rejects(offline.read(), /Account workspace changed/); assert.ok(changes >= 4);
 } finally { off(); await workspaceDatabase().close(); bindLocalWorkspace(false, rootIdentity.read().generation); Object.assign(globalThis, original); }
});
