import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { LocalPasswordVault, type PasswordVaultTransport } from './passwordVault';
import type { PasswordFileTransport } from './passwordFileTransport.client';
import { PASSWORD_FILE_COMMANDS, type PasswordFileCommand } from './passwordFiles';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { emptyPasswordEntry } from '../passwords/model';
import { createPasswordBackup } from '../passwords/backup.client';
import { newPasswordFile } from '../passwords/fileCrypto';

const scope = { kind: 'account', ownerId: 'fixture', origin: 'https://account.example', dataPlane: 'home' } as const;
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
const phrase = 'Independent synthetic fixture unlock';
const remoteId = `att_${'a'.repeat(64)}`;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const read = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());
const entryTransport: PasswordVaultTransport = {
  async write(input) { return input.operation === 'delete' ? {} : { record: { id: input.id, revision: input.revision + 1, updatedAt: new Date().toISOString(), title: input.entry!.title, passwordType: input.entry!.passwordType } }; },
  async read() { return null; }, async page() { return { entries: [], nextCursor: null }; }
};
async function fixture(kind: 'account' | 'anonymous' = 'account') {
  const selected = kind === 'account' ? scope : { kind } as const;
  const db = new WorkspaceDatabase(new IDBFactory(), crypto.randomUUID(), 10_000, IDBKeyRange);
  const vault = new LocalPasswordVault(db, selected, lease, scope.origin);
  await vault.unlock(phrase, true);
  const id = crypto.randomUUID(), metadata = newPasswordFile('Private fixture filename.txt', 3), bytes = new Uint8Array([4, 2, 9]);
  await vault.save({ id, writeId: crypto.randomUUID(), revision: 0, entry: { ...emptyPasswordEntry(), title: 'Synthetic entry' } });
  const storage = vault.fileStorage(), open = () => new Blob([bytes]).stream();
  const commands = () => db.transaction(selected, 'readonly', lease, tx => tx.list<PasswordFileCommand>(PASSWORD_FILE_COMMANDS));
  const calls: string[] = [];
  const transport: PasswordFileTransport = {
    async page() { return { files: [], nextCursor: null }; },
    async locate() { calls.push('locate'); return remoteId; },
    async upload(entryId, supplied, source, started, signal) {
      calls.push('upload'); assert.deepEqual(supplied, metadata); await started(remoteId); signal.throwIfAborted();
      const rows = await commands(); assert.equal(rows[0].value.remoteId, remoteId, 'identity is durable before bytes');
      assert.deepEqual(await read(source()), bytes); return { id: remoteId, entryId, metadata: supplied };
    },
    async download() { throw Error('Unexpected download'); },
    async remove(entryId, fileId) { calls.push('remove'); assert.equal(entryId, id); assert.equal(fileId, remoteId); return { deferred: false }; }
  };
  return { db, vault, id, metadata, bytes, storage, open, commands, calls, transport,
    async save() { return storage.uploadFile(id, metadata, open); },
    async admit() { await vault.synchronize(entryTransport); },
    async close() { vault.dispose(); await db.close(); }
  };
}

test('account file visibility and encrypted intent commit locally; parent admission is a background dependency', async () => {
  const f = await fixture();
  try {
    await f.save(); await f.save();
    assert.deepEqual(await read((await f.storage.openFile(f.id, f.metadata.token)).stream), f.bytes);
    const rows = await f.commands(); assert.equal(rows.length, 1);
    const raw = JSON.stringify(rows);
    for (const secret of [f.metadata.name, f.metadata.key, f.metadata.nonce]) assert.ok(!raw.includes(secret));
    assert.equal((await f.vault.synchronizeFiles(f.transport)).completed, 0); assert.deepEqual(f.calls, []);
    await f.admit(); assert.equal((await f.vault.synchronizeFiles(f.transport)).completed, 1);
    assert.deepEqual(await f.vault.fileSyncStatus(), []);
    await f.storage.removeFile(f.id, f.metadata.token);
    assert.equal((await f.commands())[0].value.remoteId, remoteId);
    await f.vault.synchronizeFiles(f.transport); assert.deepEqual(f.calls, ['upload', 'remove']);
  } finally { await f.close(); }
});

test('anonymous file completion creates no intent and sync cannot call a transport', async () => {
  const f = await fixture('anonymous');
  try {
    await f.save(); assert.deepEqual(await f.commands(), []);
    await assert.rejects(f.vault.synchronizeFiles(f.transport), /never synchronize/); assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});

test('removal before dispatch cancels its intent locally; uncertain starts retain cleanup without bytes', async () => {
  const f = await fixture();
  try {
    await f.save(); await f.storage.removeFile(f.id, f.metadata.token); assert.deepEqual(await f.commands(), []); assert.deepEqual(f.calls, []);
    f.metadata.token = crypto.randomUUID(); await f.save(); await f.admit();
    await f.vault.synchronizeFiles({ ...f.transport, async upload() { throw Error('lost start response'); } });
    await f.storage.removeFile(f.id, f.metadata.token); assert.equal((await f.commands())[0].value.operation, 'delete');
    await assert.rejects(f.storage.openFile(f.id, f.metadata.token), /not found/);
    await f.vault.synchronizeFiles(f.transport, undefined, () => Date.now() + 70_000);
    assert.deepEqual(f.calls, ['locate', 'remove']); assert.deepEqual(await f.commands(), []);
  } finally { await f.close(); }
});

test('two tabs cannot upload one file concurrently; removal before start receipt saves the real id and sends no bytes', async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  const other = new LocalPasswordVault(f.db, scope, lease, scope.origin);
  try {
    await other.unlock(phrase); await f.save(); await f.admit(); let opened = false;
    const pending = f.vault.synchronizeFiles({ ...f.transport, async upload(entryId, metadata, open, saveId) {
      started.resolve(); await release.promise; await saveId(remoteId); opened = true; await read(open()); return { id: remoteId, entryId, metadata };
    } });
    await started.promise; assert.equal((await other.synchronizeFiles(f.transport)).completed, 0);
    await f.storage.removeFile(f.id, f.metadata.token); release.resolve(); await pending;
    assert.equal(opened, false); const row = (await f.commands())[0].value;
    assert.equal(row.operation, 'delete'); assert.equal(row.remoteId, remoteId); assert.equal(row.state, 'pending');
    await f.vault.synchronizeFiles(f.transport); assert.deepEqual(f.calls, ['remove']); assert.deepEqual(await f.commands(), []);
  } finally { release.resolve(); other.dispose(); await f.close(); }
});

test('late successful upload after local deletion cannot resurrect it and deferred deletion stays queued', async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  try {
    await f.save(); await f.admit();
    const pending = f.vault.synchronizeFiles({ ...f.transport, async upload(...args) { const result = await f.transport.upload(...args); started.resolve(); await release.promise; return result; } });
    await started.promise; await f.storage.removeFile(f.id, f.metadata.token); release.resolve();
    assert.equal((await pending).completed, 0); assert.deepEqual(await f.storage.listFiles([f.id]), []);
    assert.equal((await f.commands())[0].value.operation, 'delete');
    await f.vault.synchronizeFiles({ ...f.transport, async remove() { return { deferred: true }; } });
    assert.equal((await f.commands())[0].value.state, 'frozen');
    await f.vault.synchronizeFiles(f.transport, undefined, () => Date.now() + 70_000); assert.deepEqual(await f.commands(), []);
  } finally { release.resolve(); await f.close(); }
});

test('parent removal keeps uncertain child intent until canonical parent deletion acknowledges cleanup', async () => {
  const f = await fixture();
  try {
    await f.save(); await f.admit();
    await f.vault.synchronizeFiles({ ...f.transport, async upload(_id, _metadata, _open, saveId) { await saveId(remoteId); throw Error('uncertain'); } });
    await f.vault.remove(f.id, 1);
    await f.vault.synchronizeFiles(f.transport, undefined, () => Date.now() + 70_000);
    assert.equal((await f.commands()).length, 1); assert.deepEqual(f.calls, []);
    await f.admit(); await f.vault.synchronizeFiles(f.transport, undefined, () => Date.now() + 70_000);
    assert.deepEqual(await f.commands(), []); assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});

test('locking cancels transfer, releases only its claim and preserves the exact encrypted retry', async () => {
  const f = await fixture(), started = deferred(), release = deferred();
  try {
    await f.save(); await f.admit(); const before = (await f.commands())[0].value;
    const pending = f.vault.synchronizeFiles({ ...f.transport, async upload(...args) {
      await args[3](remoteId); started.resolve(); await release.promise; args[4].throwIfAborted(); return f.transport.upload(...args);
    } });
    await started.promise; f.vault.lock(); release.resolve(); await assert.rejects(pending, /locked|abort/i);
    const after = (await f.commands())[0].value;
    assert.deepEqual(after.encryptedValue, before.encryptedValue); assert.equal(after.remoteId, remoteId); assert.equal(after.claim, undefined);
    await f.vault.unlock(phrase); await f.vault.synchronizeFiles(f.transport); assert.deepEqual(await f.commands(), []);
  } finally { release.resolve(); await f.close(); }
});

test('invalid receipts and permission refusal retain local bytes and value-free diagnostic state', async () => {
  const f = await fixture();
  try {
    await f.save(); await f.admit();
    await f.vault.synchronizeFiles({ ...f.transport, async upload(...args) { const result = await f.transport.upload(...args); return { ...result, entryId: crypto.randomUUID() }; } });
    assert.equal((await f.commands())[0].value.status, 502);
    await f.vault.synchronizeFiles({ ...f.transport, async upload() { throw Object.assign(Error('Sensitive server text'), { status: 403 }); } }, undefined, () => Date.now() + 70_000);
    assert.equal((await f.commands())[0].value.state, 'refused');
    assert.ok(!JSON.stringify(await f.commands()).includes('Sensitive server text'));
    assert.deepEqual(await read((await f.storage.openFile(f.id, f.metadata.token)).stream), f.bytes);
  } finally { await f.close(); }
});

test('account file retention survives lock/reopen without producing upload commands and complete pulls remove vanished clean files', async () => {
  const f = await fixture();
  try {
    await f.admit(); let present = true, downloads = 0;
    const transport = { ...f.transport,
      async page() { return { files: present ? [{ id: remoteId, entryId: f.id, metadata: f.metadata }] : [], nextCursor: null }; },
      async download(_entryId: string, _fileId: string, consume: Parameters<PasswordFileTransport['download']>[2], signal: AbortSignal) {
        downloads++; await consume({ metadata: f.metadata, stream: f.open() }, signal);
      }
    };
    assert.equal((await f.vault.reconcileFiles(transport)).retained, 1); assert.deepEqual(await f.commands(), []);
    f.vault.lock(); await f.vault.unlock(phrase);
    assert.deepEqual(await read((await f.storage.openFile(f.id, f.metadata.token)).stream), f.bytes);
    await f.vault.reconcileFiles(transport); assert.equal(downloads, 1);
    present = false; await f.vault.reconcileFiles(transport); assert.deepEqual(await f.storage.listFiles([f.id]), []);
    present = true; await f.vault.reconcileFiles(transport); assert.equal(downloads, 2, 'remote absence is not a permanent user tombstone');
  } finally { await f.close(); }
});

test('partial or invalid account pages cannot erase retained files; pending local removal cannot be restored', async () => {
  const f = await fixture();
  try {
    await f.save(); await f.admit(); await f.vault.synchronizeFiles(f.transport);
    let pages = 0;
    const other = { ...f.metadata, token: crypto.randomUUID() }, otherId = `att_${'b'.repeat(64)}`;
    const partial = { ...f.transport,
      async page() { if (pages++) throw Error('offline midway'); return { files: [{ id: otherId, entryId: f.id, metadata: other }], nextCursor: otherId }; },
      async download(_entryId: string, _fileId: string, consume: Parameters<PasswordFileTransport['download']>[2], signal: AbortSignal) { await consume({ metadata: other, stream: f.open() }, signal); }
    };
    await assert.rejects(f.vault.reconcileFiles(partial), /offline midway/);
    assert.deepEqual(await read((await f.storage.openFile(f.id, f.metadata.token)).stream), f.bytes);
    await assert.rejects(f.vault.reconcileFiles({ ...f.transport, async page() { return { files: [], nextCursor: remoteId }; } }), /cursor/);
    await f.storage.removeFile(f.id, f.metadata.token);
    await f.vault.reconcileFiles({ ...f.transport, async page() { return { files: [{ id: remoteId, entryId: f.id, metadata: f.metadata }], nextCursor: null }; } });
    await assert.rejects(f.storage.openFile(f.id, f.metadata.token), /not found/); assert.equal((await f.commands())[0].value.operation, 'delete');
  } finally { await f.close(); }
});

test('a local entry edit or removal during download prevents stale retention without losing its queued change', async () => {
  for (const remove of [false, true]) {
    const f = await fixture(), started = deferred(), release = deferred();
    try {
      await f.admit();
      const pending = f.vault.reconcileFiles({ ...f.transport,
        async page() { return { files: [{ id: remoteId, entryId: f.id, metadata: f.metadata }], nextCursor: null }; },
        async download(_entryId, _fileId, consume, signal) { started.resolve(); await release.promise; await consume({ metadata: f.metadata, stream: f.open() }, signal); }
      });
      await started.promise;
      if (remove) await f.vault.remove(f.id, 1);
      else await f.vault.save({ id: f.id, revision: 1, writeId: crypto.randomUUID(), entry: { ...emptyPasswordEntry(), title: 'Newer local version' } });
      release.resolve(); assert.equal((await pending).unavailable, 1); assert.equal((await f.vault.syncStatus()).length, 1); assert.deepEqual(await f.commands(), []);
    } finally { release.resolve(); await f.close(); }
  }
});

test('retention rejects foreign parents, changed metadata, and incomplete bytes without exposing a local file', async () => {
  const f = await fixture();
  try {
    await f.admit();
    await assert.rejects(f.vault.reconcileFiles({ ...f.transport, async page() { return { files: [{ id: remoteId, entryId: crypto.randomUUID(), metadata: f.metadata }], nextCursor: null }; } }), /reference/);
    for (const changeMetadata of [false, true]) {
      const result = await f.vault.reconcileFiles({ ...f.transport,
        async page() { return { files: [{ id: remoteId, entryId: f.id, metadata: f.metadata }], nextCursor: null }; },
        async download(_entryId, _fileId, consume, signal) { await consume({ metadata: changeMetadata ? { ...f.metadata, name: 'Changed' } : f.metadata, stream: new Blob([]).stream() }, signal); }
      });
      assert.equal(result.unavailable, 1);
      assert.deepEqual(await f.storage.listFiles([f.id]), [{ id: f.metadata.token, entryId: f.id, metadata: f.metadata, available: false }]); assert.deepEqual(await f.commands(), []);
      await assert.rejects(f.storage.openFile(f.id, f.metadata.token), /not available offline/);
    }
  } finally { await f.close(); }
});

test('an uncertain completion survives reopening with the exact file identity and metadata', async () => {
  const f = await fixture(); let reopened: LocalPasswordVault | undefined;
  try {
    await f.save(); await f.admit();
    await f.vault.synchronizeFiles({ ...f.transport, async upload(...args) { await f.transport.upload(...args); throw Error('lost completed receipt'); } });
    const before = (await f.commands())[0].value;
    f.vault.dispose(); reopened = new LocalPasswordVault(f.db, scope, lease, scope.origin); await reopened.unlock(phrase);
    await reopened.synchronizeFiles(f.transport, undefined, () => Date.now() + 70_000);
    assert.equal(before.remoteId, remoteId); assert.deepEqual(f.calls, ['upload', 'upload']); assert.deepEqual(await f.commands(), []);
  } finally { reopened?.dispose(); await f.close(); }
});

test('a long upload renews its cross-tab claim and parent deletion clears a previously refused child', async context => {
  const f = await fixture(), started = deferred(), release = deferred();
  const other = new LocalPasswordVault(f.db, scope, lease, scope.origin); let now = Date.now();
  try {
    await other.unlock(phrase); await f.save(); await f.admit();
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = f.vault.synchronizeFiles({ ...f.transport, async upload(...args) { started.resolve(); await release.promise; return f.transport.upload(...args); } }, undefined, () => now);
    await started.promise;
    for (let step = 0; step < 4; step++) {
      now += 20_000; context.mock.timers.tick(20_000);
      const row = (await f.commands())[0].value; assert.ok(row.claim!.until > now);
    }
    assert.equal((await other.synchronizeFiles(f.transport, undefined, () => now)).completed, 0);
    release.resolve(); await pending; context.mock.timers.reset();
    f.metadata.token = crypto.randomUUID(); await f.save();
    await f.vault.synchronizeFiles({ ...f.transport, async upload() { throw Object.assign(Error('permission refused'), { status: 403 }); } });
    assert.equal((await f.commands())[0].value.state, 'refused');
    await f.vault.remove(f.id, 1); await f.admit(); await f.vault.synchronizeFiles(f.transport);
    assert.deepEqual(await f.commands(), []);
  } finally { release.resolve(); context.mock.timers.reset(); other.dispose(); await f.close(); }
});


test('remote-only files stay visible across failed downloads and incomplete backups are refused', async () => {
 const f = await fixture();
 try {
  await f.admit(); const id = crypto.randomUUID(), remoteEntry = { id, revision: 1, updatedAt: new Date().toISOString(), title: 'Account-only entry', passwordType: 'login' as const, entry: { ...emptyPasswordEntry(), title: 'Account-only entry' } };
  await f.vault.reconcile({ ...entryTransport, async page() { return { entries: [remoteEntry], nextCursor: null }; } });
  assert.deepEqual(await f.storage.filesStatus!(id), { listed: false, unavailable: 0 });
  await assert.rejects(createPasswordBackup(f.storage), /not available on this device/);
  const other = newPasswordFile('Other good account file', 3), otherId = `att_${'b'.repeat(64)}`;
  let unavailable = true;
  const transport: PasswordFileTransport = { ...f.transport,
   async page() { return { files: [{ id: remoteId, entryId: id, metadata: f.metadata }, { id: otherId, entryId: id, metadata: other }], nextCursor: null }; },
   async download(_entryId, fileId, consume, signal) {
    if (fileId === remoteId && unavailable) throw Error('temporarily offline');
    await consume({ metadata: fileId === remoteId ? f.metadata : other, stream: f.open() }, signal);
   }
  };
  assert.deepEqual(await f.vault.reconcileFiles(transport), { retained: 1, unavailable: 1 });
  assert.deepEqual(await f.storage.filesStatus!(id), { listed: true, unavailable: 1 });
  const rows = await f.storage.listFiles([id]); assert.equal(rows.length, 2); assert.equal(rows.find(row => row.id === f.metadata.token)?.available, false);
  assert.deepEqual(await read((await f.storage.openFile(id, other.token)).stream), f.bytes);
  await assert.rejects(createPasswordBackup(f.storage), /not available on this device/);
  const raw = await f.db.transaction(scope, 'readonly', lease, tx => tx.list('password-vault-file-catalog'));
  assert.ok(!JSON.stringify(raw).includes(f.metadata.name)); assert.ok(!JSON.stringify(raw).includes(f.metadata.key));
  // Local file completion remains independent of an unavailable remote original.
  const local = newPasswordFile('Local during failed pull', 3); await f.storage.uploadFile(id, local, f.open);
  assert.deepEqual(await read((await f.storage.openFile(id, local.token)).stream), f.bytes);
  unavailable = false; assert.equal((await f.vault.reconcileFiles(transport)).retained, 1);
  assert.deepEqual(await f.storage.filesStatus!(id), { listed: true, unavailable: 0 });
  assert.ok((await createPasswordBackup(f.storage)).size > 0);
  assert.equal((await f.commands()).length, 1, 'retained account files create no upload intents');
 } finally { await f.close(); }
});

test('remote-only removals commit offline and complete account absence clears only unchanged metadata', async () => {
 const f = await fixture();
 try {
  await f.admit();
  await f.vault.reconcileFiles({ ...f.transport, async page() { return { files: [{ id: remoteId, entryId: f.id, metadata: f.metadata }], nextCursor: null }; }, async download() { throw Error('offline'); } });
  await f.storage.removeFile(f.id, f.metadata.token);
  assert.deepEqual(await f.storage.listFiles([f.id]), []);
  assert.equal((await f.commands())[0].value.remoteId, remoteId);
  await f.vault.synchronizeFiles(f.transport); assert.deepEqual(f.calls, ['remove']);
  await f.vault.reconcileFiles(f.transport);
  assert.deepEqual(await f.db.transaction(scope, 'readonly', lease, tx => tx.list('password-vault-file-catalog')), []);
 } finally { await f.close(); }
});

test('explicit file retry preserves immutable identity and bytes after permission refusal', async () => {
 const f = await fixture();
 try {
  await f.save(); await f.admit();
  await f.vault.synchronizeFiles({ ...f.transport, async upload() { throw Object.assign(Error('private-upload denied'), { status: 403 }); } });
  const before = (await f.commands())[0].value; assert.equal(before.state, 'refused');
  await f.vault.retryFileSync(before.id); const after = (await f.commands())[0].value;
  assert.deepEqual(after.encryptedValue, before.encryptedValue); assert.equal(after.fileId, before.fileId); assert.equal(after.attempts, before.attempts); assert.equal(after.retryAt, 0);
  assert.equal((await f.vault.synchronizeFiles(f.transport)).completed, 1);
  assert.deepEqual(await read((await f.storage.openFile(f.id, f.metadata.token)).stream), f.bytes);
 } finally { await f.close(); }
});

test('file retention remains independent while an entry conflict waits for review', async () => {
 const f = await fixture();
 try {
  await f.admit(); const id = crypto.randomUUID(), entry = { ...emptyPasswordEntry(), title: 'Remote source for review' };
  const remote = { id, revision: 1, updatedAt: new Date().toISOString(), title: entry.title, passwordType: entry.passwordType, entry };
  const entries: PasswordVaultTransport = { ...entryTransport, async page() { return { entries: [remote], nextCursor: null }; }, async read() { return remote; }, async write() { throw Object.assign(Error('conflict'), { status: 409 }); } };
  await f.vault.reconcile(entries); await f.vault.save({ id, writeId: crypto.randomUUID(), revision: 1, entry: { ...entry, title: 'Local review version' } });
  await f.vault.synchronize(entries);
  await assert.rejects(f.vault.resolveRefused(id, 2, 'copy', entries), /not available on this device/);
  const files: PasswordFileTransport = { ...f.transport,
   async page() { return { files: [{ id: remoteId, entryId: id, metadata: f.metadata }], nextCursor: null }; },
   async download(_parent, _file, consume, signal) { await consume({ metadata: f.metadata, stream: f.open() }, signal); }
  };
  assert.equal((await f.vault.reconcileFiles(files)).retained, 1);
  assert.equal((await f.vault.syncStatus())[0].state, 'refused');
  const result = await f.vault.resolveRefused(id, 2, 'copy', entries);
  const copied = (await f.storage.listFiles([result.copiedId!]))[0]; assert.notEqual(copied.metadata.key, f.metadata.key);
  assert.deepEqual(await read((await f.storage.openFile(result.copiedId!, copied.id)).stream), f.bytes);
 } finally { await f.close(); }
});

test('an older complete traversal cannot erase files confirmed by a newer tab', async () => {
 const f = await fixture(), started = deferred(), release = deferred();
 const other = new LocalPasswordVault(f.db, scope, lease, scope.origin);
 try {
  await f.admit(); await other.unlock(phrase);
  const present: PasswordFileTransport = { ...f.transport,
   async page() { return { files: [{ id: remoteId, entryId: f.id, metadata: f.metadata }], nextCursor: null }; },
   async download(_entryId, _fileId, consume, signal) { await consume({ metadata: f.metadata, stream: f.open() }, signal); }
  };
  await f.vault.reconcileFiles(present);
  const old = f.vault.reconcileFiles({ ...present, async page() { started.resolve(); await release.promise; return { files: [], nextCursor: null }; } });
  await started.promise; await other.reconcileFiles(present); release.resolve(); await old;
  assert.deepEqual(await read((await f.storage.openFile(f.id, f.metadata.token)).stream), f.bytes);
  assert.equal((await f.db.transaction(scope, 'readonly', lease, tx => tx.list('password-vault-file-catalog'))).length, 1);
 } finally { release.resolve(); other.dispose(); await f.close(); }
});
