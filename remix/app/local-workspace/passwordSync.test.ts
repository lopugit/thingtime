import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { LocalPasswordVault, type PasswordVaultTransport, type PasswordVaultRemoteEntry } from './passwordVault';
import { WorkspaceDatabase, WORKSPACE_LIMITS, type WorkspaceLease } from './storage';
import { emptyPasswordEntry } from '../passwords/model';
const scope = { kind: 'account', ownerId: 'owner', origin: 'https://account.example', dataPlane: 'home' } as const;
const phrase = 'A separate encrypted fixture passphrase';
const entry = (title = 'Device credential') => ({ ...emptyPasswordEntry(), title, fields: [{ id: 'password', label: 'Password', type: 'password' as const, value: ' synthetic private credential ' }] });
const command = (id = crypto.randomUUID(), revision = 0, title?: string) => ({ id, revision, writeId: crypto.randomUUID(), entry: entry(title) });
const gate = (): WorkspaceLease => ({ assertCurrent() {}, onInvalidate: () => () => {} });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
async function fixture() {
 const db = new WorkspaceDatabase(new IDBFactory(), crypto.randomUUID(), 10_000, IDBKeyRange), vault = new LocalPasswordVault(db, scope, gate(), scope.origin);
 await vault.unlock(phrase, true); return { db, vault, close: async () => { vault.dispose(); await db.close(); } };
}
function remote() {
 const values = new Map<string, PasswordVaultRemoteEntry>(), writes = new Map<string, { body: string; result: PasswordVaultRemoteEntry }>(), calls: any[] = [];
 const transport: PasswordVaultTransport = {
  async write(input) {
   calls.push(structuredClone(input)); const previous = values.get(input.id), key = `${input.id}:${input.writeId}`;
   if (input.operation === 'save') {
    const retry = writes.get(key); if (retry) { assert.equal(JSON.stringify(input), retry.body); return { record: retry.result }; }
    if ((previous?.revision ?? 0) !== input.revision) throw Object.assign(Error('Conflict: do not persist server text'), { status: 409 });
    const result = { id: input.id, revision: input.revision + 1, updatedAt: new Date().toISOString(), title: input.entry!.title, passwordType: input.entry!.passwordType, entry: input.entry! };
    values.set(input.id, result); writes.set(key, { body: JSON.stringify(input), result }); return { record: result };
   }
   if (previous && previous.revision !== input.revision) throw Object.assign(Error('conflict'), { status: 409 });
   values.delete(input.id); return {};
  },
  async page() { return { entries: [...values.values()], nextCursor: null }; },
  async read(id) { return values.get(id) ?? null; }
 };
 return { transport, values, calls };
}
const stored = (db: WorkspaceDatabase) => db.transaction(scope, 'readonly', gate(), tx => tx.list('password-vault-commands'));

test('account edits commit encrypted intents independently and replay in revision order', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(); await f.vault.save(one); await f.vault.save(command(one.id, 1, 'Second device version'));
  assert.equal(r.calls.length, 0); assert.equal((await f.vault.syncStatus()).length, 2);
  assert.equal((await f.vault.synchronize(r.transport)).completed, 2);
  assert.deepEqual(r.calls.map(x => x.revision), [0, 1]); assert.equal(r.values.get(one.id)?.entry.title, 'Second device version');
  assert.equal((await f.vault.read(one.id)).revision, 2); assert.deepEqual(await f.vault.syncStatus(), []);
  await f.vault.remove(one.id, 2); await f.vault.synchronize(r.transport); assert.equal(r.calls.at(-1).revision, 2); assert.equal(r.values.size, 0);
  const other = command(); await r.transport.write({ ...other, operation: 'save' }, new AbortController().signal); await f.vault.reconcile(r.transport);
  assert.equal((await f.vault.read(other.id)).entry.title, other.entry.title);
  r.values.delete(other.id); await f.vault.reconcile(r.transport); await assert.rejects(f.vault.read(other.id), /not found/);
 } finally { await f.close(); }
});
test('lost receipts survive reopening and newer local edits without changing the frozen payload', async () => {
 const f = await fixture(), r = remote(); let reopened: LocalPasswordVault | undefined; let now = Date.now();
 try {
  const one = command(); await f.vault.save(one); let lost = true;
  const transport = { ...r.transport, write: async (...args: Parameters<PasswordVaultTransport['write']>) => { const result = await r.transport.write(...args); if (lost) { lost = false; throw Error('lost response'); } return result; } };
  await f.vault.synchronize(transport, undefined, () => now); await f.vault.save(command(one.id, 1, 'Later local edit'));
  const raw = JSON.stringify(await stored(f.db)); assert.ok(!raw.includes(one.entry.title)); assert.ok(!raw.includes(one.entry.fields[0].value));
  f.vault.dispose(); reopened = new LocalPasswordVault(f.db, scope, gate(), scope.origin); await reopened.unlock(phrase); now += 70_000;
  assert.equal((await reopened.synchronize(transport, undefined, () => now)).completed, 2);
  assert.deepEqual(r.calls[1], r.calls[0]); assert.equal(r.calls[2].revision, 1); assert.equal(r.values.get(one.id)?.entry.title, 'Later local edit');
 } finally { reopened?.dispose(); await f.close(); }
});
test('two tabs claim one command and prevent later revisions overtaking it', async () => {
 const f = await fixture(), r = remote(), two = new LocalPasswordVault(f.db, scope, gate(), scope.origin), started = deferred(), release = deferred();
 try {
  await two.unlock(phrase); const one = command(); await f.vault.save(one); await f.vault.save(command(one.id, 1, 'Second'));
  const transport = { ...r.transport, write: async (...args: Parameters<PasswordVaultTransport['write']>) => { started.resolve(); await release.promise; return r.transport.write(...args); } };
  const pending = f.vault.synchronize(transport); await started.promise;
  assert.equal((await two.synchronize(r.transport)).completed, 0); assert.equal(r.calls.length, 0);
  release.resolve(); assert.equal((await pending).completed, 2); assert.deepEqual(r.calls.map(x => x.revision), [0,1]);
 } finally { release.resolve(); two.dispose(); await f.close(); }
});
test('reviewed conflict copies preserve both account and device versions atomically', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(); await r.transport.write({ ...one, operation: 'save' }, new AbortController().signal); await f.vault.reconcile(r.transport);
  await f.vault.save(command(one.id, 1, 'Keep my device edit'));
  await r.transport.write({ ...command(one.id, 1, 'Other device edit'), operation: 'save' }, new AbortController().signal);
  await f.vault.synchronize(r.transport); const status = await f.vault.syncStatus(); assert.equal(status[0].state, 'refused'); assert.equal(status[0].status, 409);
  assert.ok(!JSON.stringify(await stored(f.db)).includes('do not persist'));
  await f.vault.reconcile(r.transport); assert.equal((await f.vault.read(one.id)).entry.title, 'Keep my device edit');
  const resolution = await f.vault.resolveRefused(one.id, 2, 'copy', r.transport); assert.ok(resolution.copiedId);
  assert.equal((await f.vault.read(one.id)).entry.title, 'Other device edit'); assert.equal((await f.vault.read(resolution.copiedId!)).entry.title, 'Keep my device edit');
  await f.vault.synchronize(r.transport); assert.equal(r.values.size, 2); assert.equal(r.values.get(one.id)?.entry.title, 'Other device edit');
 } finally { await f.close(); }
});
test('review cannot discard a newer local edit or an uncertain command', async () => {
 const f = await fixture(), r = remote(), started = deferred(), release = deferred();
 try {
  const one = command(); await f.vault.save(one); await f.vault.synchronize({ ...r.transport, write: async () => { throw Error('uncertain'); } });
  await assert.rejects(f.vault.resolveRefused(one.id, 1, 'account', r.transport), /changed/);
  await f.vault.synchronize({ ...r.transport, write: async () => { throw Object.assign(Error('conflict'), { status: 409 }); } }, undefined, () => Date.now() + 70_000);
  const resolving = f.vault.resolveRefused(one.id, 1, 'account', { ...r.transport, read: async id => { started.resolve(); await release.promise; return r.transport.read(id, new AbortController().signal); } });
  await started.promise; await f.vault.save(command(one.id, 1, 'Newer still')); release.resolve();
  await assert.rejects(resolving, /changed/); assert.equal((await f.vault.read(one.id)).entry.title, 'Newer still'); assert.equal((await f.vault.syncStatus()).length, 2);
 } finally { release.resolve(); await f.close(); }
});
test('locking during upload retains its retry and rejects late receipt adoption', async () => {
 const f = await fixture(), r = remote(), started = deferred(), release = deferred();
 try {
  const one = command(); await f.vault.save(one);
  const pending = f.vault.synchronize({ ...r.transport, write: async (...args: Parameters<PasswordVaultTransport['write']>) => { const result = await r.transport.write(...args); started.resolve(); await release.promise; return result; } });
  await started.promise; f.vault.lock(); release.resolve(); await assert.rejects(pending, /locked/); assert.equal((await f.vault.syncStatus()).length, 1);
  await f.vault.unlock(phrase); await f.vault.synchronize(r.transport, undefined, () => Date.now() + 70_000); assert.deepEqual(r.calls[1], r.calls[0]); assert.deepEqual(await f.vault.syncStatus(), []);
 } finally { release.resolve(); await f.close(); }
});
test('failed pages retain entries and pulls cannot overwrite concurrent local edits', async () => {
 const f = await fixture(), r = remote(), started = deferred(), release = deferred();
 try {
  const one = command(); await r.transport.write({ ...one, operation: 'save' }, new AbortController().signal); await f.vault.reconcile(r.transport);
  const pulling = f.vault.reconcile({ ...r.transport, page: async () => { started.resolve(); await release.promise; return { entries: [], nextCursor: null }; } });
  await started.promise; await f.vault.save(command(one.id, 1, 'Edit during pull')); release.resolve(); await pulling;
  assert.equal((await f.vault.read(one.id)).entry.title, 'Edit during pull');
  let page = 0; await assert.rejects(f.vault.reconcile({ ...r.transport, page: async () => { if (page++) throw Error('offline'); return { entries: [], nextCursor: 'next' }; } }), /offline/);
  assert.equal((await f.vault.read(one.id)).entry.title, 'Edit during pull');
  await assert.rejects(f.vault.reconcile({ ...r.transport, page: async () => ({ entries: [], nextCursor: 'loop' }) }), /invalid password page/);
 } finally { release.resolve(); await f.close(); }
});
test('anonymous vaults refuse account sync before transport access', async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), crypto.randomUUID(), 10_000, IDBKeyRange), vault = new LocalPasswordVault(db, { kind: 'anonymous' }, gate(), scope.origin), r = remote();
 try {
  await vault.unlock(phrase, true); await vault.save(command());
  await assert.rejects(vault.synchronize(r.transport), /never synchronize/); await assert.rejects(vault.reconcile(r.transport), /never synchronize/);
  await assert.rejects(vault.resolveRefused(crypto.randomUUID(), 1, 'account', r.transport), /never synchronize/);
  assert.equal(r.calls.length, 0); assert.deepEqual(await vault.syncStatus(), []);
 } finally { vault.dispose(); await db.close(); }
});


test('background sync does not extend idle unlock and aborts its request on timeout', async context => {
 const f = await fixture(), r = remote(), started = deferred(), release = deferred();
 try {
  await f.vault.save(command()); context.mock.timers.enable({ apis: ['setTimeout'] }); f.vault.touch(); context.mock.timers.tick(299_999);
  const pending = f.vault.synchronize({ ...r.transport, write: async (_command, signal) => { started.resolve(); await release.promise; assert.equal(signal.aborted, true); return {}; } });
  await started.promise; context.mock.timers.tick(1); assert.equal(f.vault.isUnlocked(), false); release.resolve(); await assert.rejects(pending, /locked/); assert.equal((await f.vault.syncStatus()).length, 1);
 } finally { release.resolve(); context.mock.timers.reset(); await f.close(); }
});
test('quota failure rolls reviewed replacement and independent copy back together', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(); await f.vault.save(one); await f.vault.synchronize({ ...r.transport, write: async () => { throw Object.assign(Error('conflict'), { status: 409 }); } });
  const before = await stored(f.db), usage = await f.db.transaction(scope, 'readonly', gate(), tx => tx.usage());
  await f.db.transaction(scope, 'readwrite', gate(), async tx => { for (let i = 0; i < 3; i++) await tx.putBytes(`fill-${i}`, new Uint8Array(WORKSPACE_LIMITS.binaryBytes)); await tx.putBytes('fill-final', new Uint8Array(WORKSPACE_LIMITS.binaryBytes - usage.bytes)); });
  await assert.rejects(f.vault.resolveRefused(one.id, 1, 'copy', r.transport), /workspace is full/);
  assert.deepEqual(await stored(f.db), before); assert.equal((await f.vault.read(one.id)).entry.title, one.entry.title); assert.equal((await f.vault.page()).entries.length, 1);
 } finally { await f.close(); }
});

for (const kind of ['anonymous', 'account'] as const) {
 test(`${kind} background title and list reads preserve idle expiry while user activity renews it`, async context => {
  const db = new WorkspaceDatabase(new IDBFactory(), crypto.randomUUID(), 10_000, IDBKeyRange);
  const vault = new LocalPasswordVault(db, kind === 'account' ? scope : { kind }, gate(), scope.origin);
  try {
   await vault.unlock(phrase, true); const one = command(); await vault.save(one);
   context.mock.timers.enable({ apis: ['setTimeout'] }); vault.touch();
   context.mock.timers.tick(200_000); vault.touch();
   context.mock.timers.tick(100_000); assert.equal(vault.isUnlocked(), true, 'user activity renews unlock');
   context.mock.timers.tick(199_999);
   await vault.read(one.id); await vault.request(); await vault.request({ operation: 'export' });
   context.mock.timers.tick(1); assert.equal(vault.isUnlocked(), false, 'background reads do not renew unlock');
   await assert.rejects(vault.request(), /Unlock/);
  } finally { context.mock.timers.reset(); vault.dispose(); await db.close(); }
 });
}
