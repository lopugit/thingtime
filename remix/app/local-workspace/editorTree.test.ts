import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { decodeThingtime, stringifyThingtimeForStorage } from '../Providers/thingtimeSerialization';
import { LocalEditorTree, legacyEditorTreeKey } from './editorTree';
import { WorkspaceDatabase, WORKSPACE_LIMITS, type WorkspaceScope, type WorkspaceLease } from './storage';

const account = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
function guard() {
 let active = true; const listeners = new Set<() => void>();
 const lease: WorkspaceLease = { assertCurrent() { if (!active) throw Error('Workspace retired'); }, onInvalidate(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
 return { lease, retire() { active = false; for (const fn of listeners) fn(); } };
}
const createDb = () => new WorkspaceDatabase(new IDBFactory(), 'editor-tree-test', 10_000, IDBKeyRange);
const encoded = (text: string) => stringifyThingtimeForStorage({ Notes: text });

test('native trees use independent account, origin, plane and anonymous partitions with canonical values', async () => {
 const db = createDb(), { lease } = guard();
 const scopes: WorkspaceScope[] = [{ kind: 'anonymous' }, account, { ...account, ownerId: 'other' }, { ...account, origin: 'https://other.example' }, { ...account, dataPlane: 'other' }];
 try {
  const stores = scopes.map(scope => new LocalEditorTree(db, scope, lease));
  assert.equal(new Set(stores.map(store => store.key)).size, scopes.length);
  for (const [index, store] of stores.entries()) {
   const value: any = { text: `Workspace ${index} 🦄`, date: new Date('2026-10-17T00:00:00Z') }; value.self = value;
   await store.setItem(store.key, stringifyThingtimeForStorage(value));
  }
  for (const [index, store] of stores.entries()) {
   const value = decodeThingtime((await store.getItem(store.key))!).value;
   assert.equal(value.text, `Workspace ${index} 🦄`); assert.equal(value.self, value); assert.equal(value.date.toISOString(), '2026-10-17T00:00:00.000Z');
   assert.equal((await db.transaction(scopes[index], 'readonly', lease, tx => tx.usage())).records, 2);
  }
  await assert.rejects(stores[0].getItem(stores[1].key), /workspace changed/);
 } finally { await db.close(); }
});

test('only the anonymous legacy tree resumes automatically; account review retains the exact original key', async () => {
 const db = createDb(), { lease } = guard();
 const originals = new Map<string, unknown>([['thingtime', encoded('Anonymous earlier tree')], ['thingtime:account:owner', encoded('Earlier account tree')]]), reads: string[] = [];
 const legacy = { getItem: async (key: string) => { reads.push(key); return originals.get(key) ?? null; }, keys: async () => [...originals.keys()] };
 try {
  const anonymous = new LocalEditorTree(db, { kind: 'anonymous' }, lease, legacy);
  assert.equal(decodeThingtime((await anonymous.getItem(anonymous.key))!).value.Notes, 'Anonymous earlier tree');
  await anonymous.setItem(anonymous.key, encoded('Newer anonymous edit'));
  assert.equal(decodeThingtime((await anonymous.getItem(anonymous.key))!).value.Notes, 'Newer anonymous edit');
  assert.deepEqual(reads, ['thingtime']);
  const owner = new LocalEditorTree(db, account, lease, legacy);
  assert.equal(await owner.getItem(owner.key), null); assert.deepEqual(reads, ['thingtime']);
  assert.equal(await owner.hasLegacyAccountTree(), true); assert.deepEqual(reads, ['thingtime']);
  assert.equal((await owner.reviewLegacyAccountTree()).value.Notes, 'Earlier account tree');
  assert.deepEqual(reads, ['thingtime', legacyEditorTreeKey(account)]);
  assert.equal(await owner.getItem(owner.key), null, 'review is read-only');
  assert.equal(originals.get('thingtime'), encoded('Anonymous earlier tree'));
  assert.equal(originals.get('thingtime:account:owner'), encoded('Earlier account tree'));
 } finally { await db.close(); }
});

test('a delayed legacy read cannot adopt another generation or replace a concurrently created tree', async () => {
 const db = createDb(), gate = guard(); let release!: (value: unknown) => void;
 const legacy = { getItem: () => new Promise(resolve => { release = resolve; }), keys: async () => ['thingtime'] };
 try {
  const store = new LocalEditorTree(db, { kind: 'anonymous' }, gate.lease, legacy);
  const reading = store.getItem(store.key);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await store.setItem(store.key, encoded('Another tab already wrote this tree'));
  release(encoded('Old device tree'));
  assert.equal(decodeThingtime((await reading)!).value.Notes, 'Another tab already wrote this tree');
  const owner = new LocalEditorTree(db, account, gate.lease, legacy);
  const reviewing = owner.reviewLegacyAccountTree(); gate.retire(); release(encoded('Old account tree'));
  await assert.rejects(reviewing, /Workspace retired/);
  const fresh = new LocalEditorTree(db, account, guard().lease);
  assert.equal(await fresh.getItem(fresh.key), null);
 } finally { await db.close(); }
});

test('oversized or damaged trees never replace a valid snapshot or silently hydrate blank data', async () => {
 const db = createDb(), { lease } = guard(), store = new LocalEditorTree(db, account, lease);
 try {
  await store.setItem(store.key, encoded('Keep this tree'));
  await assert.rejects(store.setItem(store.key, encoded('x'.repeat(WORKSPACE_LIMITS.binaryBytes))), /too large|16 MiB/);
  await assert.rejects(store.setItem(store.key, 'invalid'), /JSON/);
  assert.equal(decodeThingtime((await store.getItem(store.key))!).value.Notes, 'Keep this tree');
  await db.transaction(account, 'readwrite', lease, tx => tx.putBytes('editor-tree:root:v1', new TextEncoder().encode(encoded('Tampered tree'))));
  await assert.rejects(store.getItem(store.key), /incomplete|damaged/);
  assert.ok(await db.transaction(account, 'readonly', lease, tx => tx.getBytes('editor-tree:root:v1')));
 } finally { await db.close(); }
});

test('identity invalidation between tree bytes and metadata aborts both writes atomically', async () => {
 const db = createDb(), gate = guard(), store = new LocalEditorTree(db, account, gate.lease);
 try {
  await store.setItem(store.key, encoded('Original'));
  const transact = db.transaction.bind(db);
  db.transaction = ((scope: any, mode: any, lease: any, run: any) => transact(scope, mode, lease, tx => run({ ...tx,
   put: async (...args: Parameters<typeof tx.put>) => { gate.retire(); return tx.put(...args); }
  }))) as typeof db.transaction;
  await assert.rejects(store.setItem(store.key, encoded('Must roll back')), /retired|cancelled/);
  db.transaction = transact;
  const fresh = new LocalEditorTree(db, account, guard().lease);
  assert.equal(decodeThingtime((await fresh.getItem(fresh.key))!).value.Notes, 'Original');
 } finally { await db.close(); }
});

test('workspace quota refusal preserves the previous tree and its usage for a later retry', async () => {
 const db = createDb(), { lease } = guard(), store = new LocalEditorTree(db, account, lease);
 try {
  await store.setItem(store.key, encoded('Original tree'));
  const usage = await db.transaction(account, 'readonly', lease, tx => tx.usage());
  await db.transaction(account, 'readwrite', lease, async tx => {
   for (let index = 0; index < 3; index++) await tx.putBytes(`fixture-${index}`, new Uint8Array(WORKSPACE_LIMITS.binaryBytes));
   await tx.putBytes('fixture-final', new Uint8Array(WORKSPACE_LIMITS.binaryBytes - usage.bytes));
  });
  assert.equal((await db.transaction(account, 'readonly', lease, tx => tx.usage())).bytes, WORKSPACE_LIMITS.bytes);
  await assert.rejects(store.setItem(store.key, encoded('A larger replacement tree')), /workspace is full/);
  assert.equal(decodeThingtime((await store.getItem(store.key))!).value.Notes, 'Original tree');
  assert.equal((await db.transaction(account, 'readonly', lease, tx => tx.usage())).bytes, WORKSPACE_LIMITS.bytes);
  await db.transaction(account, 'readwrite', lease, tx => tx.deleteBytes('fixture-final'));
  await store.setItem(store.key, encoded('A larger replacement tree'));
  assert.equal(decodeThingtime((await store.getItem(store.key))!).value.Notes, 'A larger replacement tree');
 } finally { await db.close(); }
});
