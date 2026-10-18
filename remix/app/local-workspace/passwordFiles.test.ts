import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { unzipSync, strFromU8 } from 'fflate';
import { LocalPasswordVault } from './passwordVault';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { newPasswordFile, PASSWORD_FILE_FRAME_BYTES } from '../passwords/fileCrypto';
import { createPasswordBackup } from '../passwords/backup.client';
import { visitPasswordFile } from '../passwords/transfer';
import { importOnePasswordItem } from '../passwords/onePassword';
const scope = { kind: 'anonymous' } as const;
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate() { return () => {}; } };
async function fixture() {
  const db = new WorkspaceDatabase(new IDBFactory(), crypto.randomUUID(), 10_000, IDBKeyRange);
  const vault = new LocalPasswordVault(db, scope, lease, 'https://fixture.example');
  await vault.unlock('Independent fixture passphrase', true);
  const id = crypto.randomUUID();
  const entry = importOnePasswordItem({ uuid: 'source', categoryUuid: '110', overview: { title: 'Private source document' }, details: { passwordHistory: [{ value: 'synthetic old secret' }], documentAttributes: { documentId: 'source-file', fileName: 'private.txt' } } });
  await vault.save({ id, revision: 0, writeId: crypto.randomUUID(), entry });
  return { db, vault, storage: vault.anonymousStorage(), id, entry, async close() { vault.dispose(); await db.close(); } };
}
const read = async (stream: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(stream).arrayBuffer());
const records = (db: WorkspaceDatabase) => db.transaction(scope, 'readonly', lease, async tx => ({ files: await tx.list('password-vault-files'), stages: await tx.list('password-vault-file-staging'), commands: await tx.list('password-vault-commands'), usage: await tx.usage() }));
test('removing a file fences an upload already reading and later retries without retaining its bytes or metadata', async () => {
  const f = await fixture();
  try {
    let source!: ReadableStreamDefaultController<Uint8Array>, reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const metadata = newPasswordFile('removed', 1);
    const pending = f.storage.uploadFile(f.id, metadata, () => new ReadableStream({ start(controller) { source = controller; }, pull() { reading(); } }));
    await started; await f.storage.removeFile(f.id, metadata.token); source.enqueue(new Uint8Array([42])); source.close();
    await assert.rejects(pending, /was removed/);
    await assert.rejects(f.storage.uploadFile(f.id, metadata, () => new Blob([new Uint8Array([42])]).stream()), /was removed/);
    assert.deepEqual(await f.storage.listFiles([f.id]), []); assert.deepEqual((await records(f.db)).stages, []);
    assert.deepEqual((await records(f.db)).files[0].value, { id: metadata.token, entryId: f.id, deleted: true });
  } finally { await f.close(); }
});
test('corrupt or missing frames fail clearly; failed multi-frame input leaves completed files intact', async () => {
  const f = await fixture();
  try {
    const metadata = newPasswordFile('kept', 3);
    await f.storage.uploadFile(f.id, metadata, () => new Blob([new Uint8Array([1, 2, 3])]).stream());
    const before = await records(f.db);
    await assert.rejects(f.storage.uploadFile(f.id, newPasswordFile('partial', PASSWORD_FILE_FRAME_BYTES + 1), () => new Blob([new Uint8Array(PASSWORD_FILE_FRAME_BYTES)]).stream()), /incomplete/);
    assert.deepEqual(await records(f.db), before);
    const row = before.files[0].value as { generation: string }, key = `password-file:${row.generation}:0`;
    await f.db.transaction(scope, 'readwrite', lease, async tx => { const bytes = (await tx.getBytes(key))!; bytes[0] ^= 1; await tx.putBytes(key, bytes); });
    await assert.rejects(read((await f.storage.openFile(f.id, metadata.token)).stream));
    await f.db.transaction(scope, 'readwrite', lease, tx => tx.deleteBytes(key));
    await assert.rejects(read((await f.storage.openFile(f.id, metadata.token)).stream), /data is missing/);
    assert.equal((await records(f.db)).files.length, 1, 'damage does not silently discard metadata');
  } finally { await f.close(); }
});
test('backup uses every local export page, preserves empty files and never asks the account transport', async context => {
  const f = await fixture();
  context.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected account transport'); });
  try {
    for (let index = 0; index < 51; index++) await f.vault.save({ id: crypto.randomUUID(), revision: 0, writeId: crypto.randomUUID(), entry: { ...f.entry, title: `Page fixture ${index}` } });
    const metadata = newPasswordFile('empty.txt', 0);
    await f.storage.uploadFile(f.id, metadata, () => new Blob([]).stream());
    const backup = unzipSync(new Uint8Array(await (await createPasswordBackup(f.storage)).arrayBuffer()));
    const items = JSON.parse(strFromU8(backup['export.data'])).accounts[0].vaults[0].items;
    assert.equal(items.length, 52); assert.equal(new Set(items.map((item: any) => item.details.thingtime.id)).size, 52);
    assert.equal(backup[`files/${metadata.token}___empty.txt`].length, 0);
  } finally { await f.close(); }
});
test('anonymous encrypted file frames survive vault reopen and share the complete native backup/import format without network', async context => {
  const f = await fixture();
  context.mock.method(globalThis, 'fetch', () => { throw new Error('Anonymous archive used the network'); });
  try {
    const bytes = new Uint8Array(PASSWORD_FILE_FRAME_BYTES + 31); bytes.set([255, 1, 42]); bytes[bytes.length - 1] = 99;
    const metadata = { ...newPasswordFile('private.txt', bytes.length), archivePath: 'files/source-file___private.txt', role: 'document' as const };
    const file = await f.storage.uploadFile(f.id, metadata, () => new Blob([bytes]).stream());
    const saved = await records(f.db), serialized = JSON.stringify(saved);
    for (const secret of [metadata.name, metadata.key, metadata.nonce, metadata.archivePath, f.entry.title]) assert.ok(!serialized.includes(secret));
    assert.equal(saved.files.length, 1); assert.deepEqual(saved.stages, []); assert.deepEqual(saved.commands, []);
    f.vault.lock(); await f.vault.unlock('Independent fixture passphrase');
    assert.deepEqual(await read((await f.storage.openFile(f.id, file.id)).stream), bytes);
    const backup = await createPasswordBackup(f.storage);
    const members = unzipSync(new Uint8Array(await backup.arrayBuffer()));
    assert.deepEqual(members[`files/${file.id}___private.txt`], bytes);
    const exported = JSON.parse(strFromU8(members['export.data'])).accounts[0].vaults[0].items[0];
    assert.equal(exported.details.documentAttributes.documentId, file.id);
    assert.equal(JSON.parse(exported.details.thingtime.entry.onePassword).details.passwordHistory[0].value, 'synthetic old secret');
    const restored: unknown[] = [], files: Uint8Array[] = [];
    await visitPasswordFile(new File([backup], 'round-trip.1pux'), { onEntry(entry) { restored.push(entry); }, async onFile(file) { if (file.entryIndex !== undefined) files.push(await read(file.open())); } });
    assert.deepEqual(restored, [f.entry]); assert.deepEqual(files, [bytes]);
  } finally { await f.close(); }
});
test('retries compare bytes, failed and concurrent uploads do not replace a completed file, and deletion refunds stored parts', async () => {
  const f = await fixture();
  try {
    const metadata = newPasswordFile('private.bin', 3), bytes = new Uint8Array([1, 2, 3]);
    const open = () => new Blob([bytes]).stream();
    const results = await Promise.all([f.storage.uploadFile(f.id, metadata, open), f.storage.uploadFile(f.id, metadata, open)]);
    assert.equal(results[0].id, results[1].id); assert.equal((await records(f.db)).files.length, 1);
    await assert.rejects(f.storage.uploadFile(f.id, metadata, () => new Blob([new Uint8Array([9, 8, 7])]).stream()), /different content/);
    await assert.rejects(f.storage.uploadFile(f.id, newPasswordFile('incomplete', 5), open), /incomplete/);
    assert.deepEqual((await records(f.db)).stages, []);
    assert.deepEqual(await read((await f.storage.openFile(f.id, metadata.token)).stream), bytes);
    const usage = (await records(f.db)).usage.bytes; await f.vault.remove(f.id, 1);
    assert.deepEqual((await records(f.db)).files, []); assert.ok((await records(f.db)).usage.bytes < usage);
    await assert.rejects(f.storage.openFile(f.id, metadata.token), /not found/);
  } finally { await f.close(); }
});
test('locking stops a blocked source, cleans only staging parts and prevents later reads from decrypting', async () => {
  const f = await fixture();
  try {
    let reading!: () => void; const started = new Promise<void>(resolve => { reading = resolve; });
    const pending = f.storage.uploadFile(f.id, newPasswordFile('blocked', 10), () => new ReadableStream({ pull() { reading(); return new Promise(() => {}); } }));
    await started; f.vault.lock(); await assert.rejects(pending, /locked|Cancelled|aborted/i);
    assert.deepEqual((await records(f.db)).stages, []);
    await f.vault.unlock('Independent fixture passphrase');
    const metadata = newPasswordFile('test', 1); await f.storage.uploadFile(f.id, metadata, () => new Blob([new Uint8Array([42])]).stream());
    const opened = await f.storage.openFile(f.id, metadata.token); f.vault.lock();
    await assert.rejects(read(opened.stream), /locked/);
    await assert.rejects(createPasswordBackup(f.storage), /Unlock/);
  } finally { await f.close(); }
});
test('a removed parent refuses an in-flight upload and anonymous storage cannot be constructed for an account', async () => {
  const f = await fixture();
  try {
    let source!: ReadableStreamDefaultController<Uint8Array>, reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const pending = f.storage.uploadFile(f.id, newPasswordFile('race', 1), () => new ReadableStream({ start(controller) { source = controller; }, pull() { reading(); } }));
    await started; await f.vault.remove(f.id, 1); source.enqueue(new Uint8Array([1])); source.close();
    await assert.rejects(pending, /not found/); assert.deepEqual((await records(f.db)).stages, []);
    const account = new LocalPasswordVault(f.db, { kind: 'account', origin: 'https://fixture.example', ownerId: 'owner', dataPlane: 'home' }, lease, 'https://fixture.example');
    try { assert.throws(() => account.anonymousStorage(), /anonymous/); } finally { account.dispose(); }
  } finally { await f.close(); }
});
