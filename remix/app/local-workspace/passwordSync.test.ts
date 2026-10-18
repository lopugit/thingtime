import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { LocalPasswordVault, type PasswordVaultTransport, type PasswordVaultRemoteEntry } from './passwordVault';
import { WorkspaceDatabase, WORKSPACE_LIMITS, type WorkspaceLease } from './storage';
import { emptyPasswordEntry } from '../passwords/model';
import { newPasswordFile } from '../passwords/fileCrypto';
import { PASSWORD_FILES, PASSWORD_FILE_COMMANDS, type StoredFile, type PasswordFileCommand } from './passwordFiles';
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
  await f.vault.reconcileFiles({ async page() { return { files: [], nextCursor: null }; } } as any);
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

const readBytes = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());
const fileRows = (db: WorkspaceDatabase) => db.transaction(scope, 'readonly', gate(), tx => tx.list<StoredFile>(PASSWORD_FILES));
const fileCommands = (db: WorkspaceDatabase) => db.transaction(scope, 'readonly', gate(), tx => tx.list<PasswordFileCommand>(PASSWORD_FILE_COMMANDS));
const refuseWrites = (transport: PasswordVaultTransport): PasswordVaultTransport => ({ ...transport, async write() { throw Object.assign(Error('conflict'), { status: 409 }); } });

test('conflict copies re-encrypt files and cyclic source archives with independent identities', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(), archive = command();
  one.entry = { ...one.entry, importArchiveId: archive.id } as typeof one.entry;
  archive.entry = { ...archive.entry, importArchiveId: one.id } as typeof archive.entry;
  await f.vault.save(one); await f.vault.save(archive); await f.vault.synchronize(r.transport);
  const storage = f.vault.fileStorage(), bytes = new Uint8Array([0, 255, 12]);
  const attachment = newPasswordFile('Private attachment.bin', bytes.length);
  const source = { ...newPasswordFile('Source archive member', bytes.length), role: 'source' as const, archivePath: 'files/original.bin' };
  await storage.uploadFile(one.id, attachment, () => new Blob([bytes]).stream());
  await storage.uploadFile(archive.id, source, () => new Blob([bytes]).stream());
  await f.vault.save({ ...command(one.id, 1, 'Device version'), entry: { ...one.entry, title: 'Device version' } });
  await r.transport.write({ ...command(one.id, 1, 'Account version'), operation: 'save' }, new AbortController().signal);
  await f.vault.synchronize(r.transport);
  const result = await f.vault.resolveRefused(one.id, 2, 'copy', r.transport), copyId = result.copiedId!;
  const copy = await f.vault.read(copyId), copyArchiveId = copy.entry.importArchiveId!;
  assert.equal(copy.entry.title, 'Device version'); assert.notEqual(copyArchiveId, archive.id);
  assert.equal((await f.vault.read(copyArchiveId)).entry.importArchiveId, copyId);
  assert.equal((await f.vault.read(one.id)).entry.title, 'Account version');
  assert.equal((await f.vault.read(archive.id)).entry.importArchiveId, one.id, 'original source is unchanged');
  const files = await storage.listFiles([copyId, copyArchiveId]); assert.equal(files.length, 2);
  for (const file of files) {
   const original = file.entryId === copyId ? attachment : source;
   assert.notEqual(file.id, original.token); assert.notEqual(file.metadata.key, original.key); assert.notEqual(file.metadata.nonce, original.nonce);
   assert.equal(file.metadata.name, original.name); assert.equal(file.metadata.role, original.role); assert.equal(file.metadata.archivePath, original.archivePath);
   assert.deepEqual(await readBytes((await storage.openFile(file.entryId!, file.id)).stream), bytes);
  }
  assert.deepEqual(await storage.listFiles([one.id]), []); assert.equal((await storage.listFiles([archive.id])).length, 1);
  assert.equal((await fileCommands(f.db)).length, 3, 'two copies plus untouched source file');
  assert.deepEqual(await f.db.transaction(scope, 'readonly', gate(), tx => tx.list('password-vault-file-staging')), []);
  await f.vault.synchronize(r.transport); assert.equal(r.values.size, 4);
 } finally { await f.close(); }
});

test('vanished remote parents preserve pending file bytes for review and require an explicit cleanup acknowledgement', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(); await f.vault.save(one); await f.vault.synchronize(r.transport);
  const storage = f.vault.fileStorage(), bytes = new Uint8Array([8, 9]), metadata = newPasswordFile('Offline file', 2);
  await storage.uploadFile(one.id, metadata, () => new Blob([bytes]).stream());
  // A failed response can hide a successful start; retain its cleanup identity.
  await f.db.transaction(scope, 'readwrite', gate(), async tx => {
   const id = `${one.id}:${metadata.token}`, item = (await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, id))!;
   await tx.put(PASSWORD_FILE_COMMANDS, id, { ...item, attempts: 1, state: 'frozen' });
  });
  r.values.delete(one.id); await f.vault.reconcile(r.transport);
  assert.equal((await f.vault.syncStatus())[0].status, 404);
  assert.deepEqual(await readBytes((await storage.openFile(one.id, metadata.token)).stream), bytes);
  const result = await f.vault.resolveRefused(one.id, 1, 'copy', r.transport);
  assert.ok(result.copiedId); await assert.rejects(f.vault.read(one.id), /not found/);
  assert.equal((await fileCommands(f.db)).filter(row => row.value.entryId === one.id).length, 1);
  let fileCalls = 0;
  const files = { async page() { return { files: [], nextCursor: null }; }, async download() { throw Error('unexpected'); },
   async upload() { fileCalls++; throw Error('unexpected'); }, async locate() { fileCalls++; throw Error('unexpected'); }, async remove() { fileCalls++; throw Error('unexpected'); } };
  await f.vault.synchronizeFiles(files); assert.equal(fileCalls, 0, 'missing parent is not a cleanup acknowledgement');
  await f.vault.synchronize(r.transport);
  assert.ok(r.calls.some(call => call.id === one.id && call.operation === 'delete'));
  // Only inspect the old child cleanup here; the independent copy can now upload.
  await f.vault.synchronizeFiles(files);
  assert.equal((await fileCommands(f.db)).filter(row => row.value.entryId === one.id).length, 0);
  const copiedFile = (await storage.listFiles([result.copiedId!]))[0];
  assert.deepEqual(await readBytes((await storage.openFile(result.copiedId!, copiedFile.id)).stream), bytes);
 } finally { await f.close(); }
});

for (const choice of ['account', 'copy'] as const) test(`${choice} review refuses concurrent file edits without losing bytes`, async () => {
 const f = await fixture(), r = remote(), started = deferred(), release = deferred();
 try {
  const one = command(); await f.vault.save(one); await f.vault.synchronize(refuseWrites(r.transport));
  const resolving = f.vault.resolveRefused(one.id, 1, choice, { ...r.transport, async read() { started.resolve(); await release.promise; return null; } });
  await started.promise;
  const metadata = newPasswordFile('Newer file', 1), storage = f.vault.fileStorage();
  await storage.uploadFile(one.id, metadata, () => new Blob([new Uint8Array([42])]).stream());
  release.resolve(); await assert.rejects(resolving, /attachments changed/);
  assert.equal((await f.vault.page()).entries.length, 1); assert.equal((await f.vault.syncStatus())[0].state, 'refused');
  assert.deepEqual(await readBytes((await storage.openFile(one.id, metadata.token)).stream), new Uint8Array([42]));
  assert.deepEqual(await f.db.transaction(scope, 'readonly', gate(), tx => tx.list('password-vault-file-staging')), []);
 } finally { release.resolve(); await f.close(); }
});

test('damaged source bytes abort a copy without replacing the conflict or publishing partial entries', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(); await f.vault.save(one);
  const metadata = newPasswordFile('Damaged file', 1), storage = f.vault.fileStorage();
  await storage.uploadFile(one.id, metadata, () => new Blob([new Uint8Array([7])]).stream());
  await storage.uploadFile(one.id, newPasswordFile('Other file', 1), () => new Blob([new Uint8Array([8])]).stream());
  await f.vault.synchronize(refuseWrites(r.transport));
  const rows = await fileRows(f.db), row = rows.at(-1)!.value; assert.ok('generation' in row);
  const generation = row.generation;
  await f.db.transaction(scope, 'readwrite', gate(), tx => tx.deleteBytes(`password-file:${generation}:0`));
  const before = await stored(f.db);
  await assert.rejects(f.vault.resolveRefused(one.id, 1, 'copy', r.transport), /data is missing/);
  assert.deepEqual(await stored(f.db), before); assert.deepEqual(await fileRows(f.db), rows);
  assert.equal((await f.vault.page()).entries.length, 1);
  assert.deepEqual(await f.db.transaction(scope, 'readonly', gate(), tx => tx.list('password-vault-file-staging')), []);
 } finally { await f.close(); }
});

test('unavailable source archive refuses a partial conflict copy', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(); await f.vault.save({ ...one, entry: { ...one.entry, importArchiveId: crypto.randomUUID() } });
  await f.vault.synchronize(refuseWrites(r.transport)); const before = await stored(f.db);
  await assert.rejects(f.vault.resolveRefused(one.id, 1, 'copy', r.transport), /source archive is unavailable/);
  assert.deepEqual(await stored(f.db), before); assert.equal((await f.vault.page()).entries.length, 1);
 } finally { await f.close(); }
});

test('account resolution discards an undispatched deletion but preserves an uncertain file cleanup', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(); await f.vault.save(one); await f.vault.synchronize(r.transport);
  const storage = f.vault.fileStorage(), pending = newPasswordFile('Uncertain upload', 1), clean = newPasswordFile('Account file', 1);
  for (const metadata of [pending, clean]) await storage.uploadFile(one.id, metadata, () => new Blob([new Uint8Array([3])]).stream());
  const pendingId = `${one.id}:${pending.token}`, cleanId = `${one.id}:${clean.token}`;
  await f.db.transaction(scope, 'readwrite', gate(), async tx => {
   const item = (await tx.get<PasswordFileCommand>(PASSWORD_FILE_COMMANDS, pendingId))!;
   await tx.put(PASSWORD_FILE_COMMANDS, pendingId, { ...item, attempts: 1, state: 'frozen' });
   const file = (await tx.get<StoredFile>(PASSWORD_FILES, cleanId))!;
   await tx.put(PASSWORD_FILES, cleanId, { ...file, remoteId: `att_${'a'.repeat(64)}` }); await tx.delete(PASSWORD_FILE_COMMANDS, cleanId);
  });
  await storage.removeFile(one.id, clean.token);
  await f.vault.save(command(one.id, 1, 'Refused edit')); await f.vault.synchronize(refuseWrites(r.transport));
  const before = (await fileCommands(f.db)).find(row => row.id === pendingId)!.value;
  await f.vault.resolveRefused(one.id, 2, 'account', r.transport);
  const commands = await fileCommands(f.db); assert.equal(commands.length, 1);
  assert.equal(commands[0].id, pendingId); assert.equal(commands[0].value.operation, 'delete');
  assert.deepEqual(commands[0].value.encryptedValue, before.encryptedValue); assert.equal(commands[0].value.attempts, 1);
  assert.equal((await fileRows(f.db)).some(row => row.id === cleanId), false, 'next complete account pull can retain the discarded deletion');
  await assert.rejects(storage.openFile(one.id, pending.token), /not found/);
 } finally { await f.close(); }
});
