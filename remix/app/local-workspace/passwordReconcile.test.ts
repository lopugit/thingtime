import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { emptyPasswordEntry } from '../passwords/model';
import { LocalPasswordVault, type PasswordVaultRemoteEntry, type PasswordVaultTransport } from './passwordVault';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';

const scope = { kind: 'account', ownerId: 'fixture', origin: 'https://account.example', dataPlane: 'home' } as const;
const phrase = 'An isolated traversal test passphrase';
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const row = (title: string): PasswordVaultRemoteEntry => ({
 id: crypto.randomUUID(), revision: 1, updatedAt: '2026-10-18T00:00:00.000Z', title, passwordType: 'login',
 entry: { ...emptyPasswordEntry(), title }
});
const transport = (page: PasswordVaultTransport['page']): PasswordVaultTransport => ({
 page, async read() { throw Error('Unexpected read'); }, async write() { throw Error('Unexpected write'); }
});
const snapshot = (entries: PasswordVaultRemoteEntry[]) => transport(async () => ({ entries, nextCursor: null }));
async function fixture(activeLease = lease) {
 const factory = new IDBFactory(), name = crypto.randomUUID();
 const db = new WorkspaceDatabase(factory, name, 1000, IDBKeyRange), peerDb = new WorkspaceDatabase(factory, name, 1000, IDBKeyRange);
 const vault = new LocalPasswordVault(db, scope, activeLease, scope.origin), peer = new LocalPasswordVault(peerDb, scope, activeLease, scope.origin);
 await vault.unlock(phrase, true); await peer.unlock(phrase);
 return { db, vault, peer, close: async () => { vault.dispose(); peer.dispose(); await db.close(); await peerDb.close(); } };
}

test('entry reconciliation completes beyond 200 pages and preserves exact values after reopening', async () => {
 const f = await fixture(), entries = Array.from({ length: 205 }, (_, n) => row(`Page ${n} 🦄`));
 let calls = 0;
 try {
  const result = await f.vault.reconcile(transport(async cursor => {
   const index = cursor === undefined ? 0 : Number(cursor);
   assert.equal(index, calls++);
   return { entries: [entries[index]], nextCursor: index + 1 < entries.length ? String(index + 1) : null };
  }));
  assert.equal(calls, entries.length); assert.equal(result.retained, entries.length);
  await f.db.close();
  for (const entry of entries) assert.deepEqual((await f.vault.read(entry.id)).entry, entry.entry);
  assert.deepEqual(await f.vault.syncStatus(), []);
 } finally { await f.close(); }
});

for (const newerFails of [false, true]) test(`an older pull cannot prune an unchanged entry after a newer pull ${newerFails ? 'fails' : 'confirms it'}`, async () => {
 const f = await fixture(), one = row('Keep the confirmed entry'), started = deferred(), release = deferred();
 try {
  await f.vault.reconcile(snapshot([one]));
  const older = f.vault.reconcile(transport(async () => { started.resolve(); await release.promise; return { entries: [], nextCursor: null }; }));
  await started.promise;
  if (newerFails) {
   await assert.rejects(f.peer.reconcile(transport(async cursor => {
    if (cursor) throw Error('Interrupted newer pull');
    return { entries: [one], nextCursor: 'next' };
   })), /Interrupted newer pull/);
  } else await f.peer.reconcile(snapshot([one]));
  release.resolve(); assert.deepEqual(await older, { retained: 0, superseded: true });
  assert.equal((await f.vault.read(one.id)).revision, 1);
  assert.deepEqual((await f.vault.read(one.id)).entry, one.entry);
  assert.deepEqual(await f.vault.syncStatus(), []);
  // A fresh, complete snapshot can still remove entries actually gone remotely.
  await f.peer.reconcile(snapshot([])); await assert.rejects(f.vault.read(one.id), { code: 'PASSWORD_MISSING' });
 } finally { release.resolve(); await f.close(); }
});

test('a superseded page cannot resurrect an entry omitted by a newer complete pull', async () => {
 const f = await fixture(), stale = row('Stale unseen entry'), started = deferred(), release = deferred();
 try {
  const older = f.vault.reconcile(transport(async () => { started.resolve(); await release.promise; return { entries: [stale], nextCursor: null }; }));
  await started.promise; await f.peer.reconcile(snapshot([])); release.resolve();
  assert.deepEqual(await older, { retained: 0, superseded: true });
  await assert.rejects(f.vault.read(stale.id), { code: 'PASSWORD_MISSING' });
 } finally { release.resolve(); await f.close(); }
});

test('a newer tab also fences cleanup when it starts after the older final page', async context => {
 const f = await fixture(), one = row('Confirmed while old cleanup waits'), started = deferred(), release = deferred();
 try {
  await f.vault.reconcile(snapshot([one]));
  const original = f.db.transaction.bind(f.db); let writes = 0;
  context.mock.method(f.db, 'transaction', async (...args: Parameters<typeof original>) => {
   if (args[1] === 'readwrite' && ++writes === 3) { started.resolve(); await release.promise; }
   return original(...args);
  });
  const older = f.vault.reconcile(snapshot([]));
  await started.promise; await f.peer.reconcile(snapshot([one])); release.resolve();
  assert.deepEqual(await older, { retained: 0, superseded: true });
  assert.deepEqual((await f.vault.read(one.id)).entry, one.entry);
 } finally { release.resolve(); await f.close(); }
});

test('partial traversal retains validated pages but only a complete retry prunes missing entries', async () => {
 const f = await fixture(), old = row('Previously retained'), added = row('First good page');
 try {
  await f.vault.reconcile(snapshot([old]));
  await assert.rejects(f.vault.reconcile(transport(async cursor => {
   if (cursor) throw Error('Offline midway');
   return { entries: [added], nextCursor: 'next' };
  })), /Offline midway/);
  assert.deepEqual((await f.vault.read(old.id)).entry, old.entry);
  assert.deepEqual((await f.vault.read(added.id)).entry, added.entry);
  await f.peer.reconcile(snapshot([added]));
  await assert.rejects(f.vault.read(old.id), { code: 'PASSWORD_MISSING' });
 } finally { await f.close(); }
});

for (const mode of ['abort', 'lock', 'identity'] as const) test(`${mode} during a page stops retention, pruning and further requests`, async () => {
 let active = true; const listeners = new Set<() => void>();
 const activeLease: WorkspaceLease = {
  assertCurrent() { if (!active) throw Error('Account identity retired'); },
  onInvalidate(callback) { listeners.add(callback); return () => listeners.delete(callback); }
 };
 const f = await fixture(activeLease), old = row('Retained before interruption'), late = row('Late response'), controller = new AbortController();
 const started = deferred(), release = deferred(); let calls = 0;
 try {
  await f.vault.reconcile(snapshot([old]));
  const pulling = f.vault.reconcile(transport(async (_cursor, signal) => {
   calls++; started.resolve(); await release.promise; assert.equal(signal.aborted, true);
   return { entries: [late], nextCursor: 'next' };
  }), controller.signal);
  const rejected = assert.rejects(pulling, mode === 'identity' ? /Account identity retired/ : mode === 'lock' ? { code: 'VAULT_LOCKED' } : { name: 'AbortError' });
  await started.promise;
  if (mode === 'identity') { active = false; for (const callback of [...listeners]) callback(); }
  else if (mode === 'lock') f.vault.lock(); else controller.abort();
  release.resolve(); await rejected;
  active = true;
  if (mode !== 'abort') await f.vault.unlock(phrase);
  assert.equal(calls, 1); assert.deepEqual((await f.vault.read(old.id)).entry, old.entry);
  await assert.rejects(f.vault.read(late.id), { code: 'PASSWORD_MISSING' });
 } finally { release.resolve(); await f.close(); }
});

test('a failed baseline transaction releases its operation listener', async context => {
 const listeners = new Set<() => void>();
 const activeLease: WorkspaceLease = { assertCurrent() {}, onInvalidate(callback) { listeners.add(callback); return () => listeners.delete(callback); } };
 const f = await fixture(activeLease), before = listeners.size;
 try {
  context.mock.method(f.db, 'transaction', async () => { throw Error('Storage unavailable'); });
  await assert.rejects(f.vault.reconcile(snapshot([])), /Storage unavailable/);
  assert.equal(listeners.size, before);
 } finally { await f.close(); }
 assert.equal(listeners.size, 0);
});

test('empty continuing pages, cursor cycles, duplicate identities and invalid metadata fail without pruning', async () => {
 const f = await fixture(), old = row('Never prune on protocol failure');
 try {
  await f.vault.reconcile(snapshot([old]));
  const repeated = row('Duplicate');
  for (const mode of ['empty', 'cycle', 'duplicate', 'date', 'null'] as const) {
   let calls = 0;
   await assert.rejects(f.vault.reconcile(transport(async () => {
    calls++;
    assert.ok(calls <= 2, 'protocol failures stop requesting pages');
    if (mode === 'null') return null as any;
    const entries = mode === 'empty' ? [] : [mode === 'duplicate' ? repeated : row('Page')];
    if (mode === 'date') entries[0].updatedAt = 'invalid';
    return { entries, nextCursor: mode === 'cycle' ? 'same' : String(calls) };
   })), { code: 'VAULT_RESPONSE', status: 502 });
   assert.deepEqual((await f.vault.read(old.id)).entry, old.entry);
  }
 } finally { await f.close(); }
});
