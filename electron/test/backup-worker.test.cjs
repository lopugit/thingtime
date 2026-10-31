const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '../..');
const remixRequire = createRequire(join(root, 'remix/package.json'));
const { build } = createRequire(remixRequire.resolve('tsx'))('esbuild');
let engine, workerPath, scratch;
const scope = { apiOrigin: 'https://backup.invalid', ownerId: 'synthetic-owner', dataPlane: 'home' };
const access = { scope, authorize: async () => {} };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
test.before(async () => {
 scratch = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'thingtime-worker-test-')));
 workerPath = join(scratch, 'worker.cjs');
 const { buildBackupWorker } = await import(pathToFileURL(join(root, 'electron/scripts/build-backup-worker.mjs')));
 await buildBackupWorker(workerPath);
 const outfile = join(scratch, 'fixture.cjs');
 await build({ stdin: { contents: `export * from './remix/app/api/utils/backups/portableBackup'; export * from './remix/app/api/utils/backups/localBackupStore'; export * from './remix/app/backups/manifest'; export * from './remix/app/fileSync/contentFingerprint';`, resolveDir: root }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
 engine = require(outfile);
});
test.after(async () => { await fs.rm(scratch, { recursive: true, force: true }); });
async function fixture() {
 const directory = await fs.mkdtemp(join(scratch, 'case-'));
 const sourceDirectory = join(directory, 'source'), destinationDirectory = join(directory, 'destination');
 const source = await engine.openLocalBackupStore(sourceDirectory);
 await fs.mkdir(destinationDirectory, { mode: 0o700 });
 const snapshotId = randomUUID();
 const header = { format: engine.BACKUP_FORMAT, snapshotId, scope,
 boundary: { kind: 'point-in-time', token: 'synthetic', startedAt: '2026-10-18T00:00:00.000Z', completedAt: '2026-10-18T00:00:00.000Z' }, coverage: { selectionId: 'fixture', description: 'Synthetic private local worker test' } };
 const bytes = Buffer.alloc(engine.BACKUP_CHUNK_BYTES + 37, 7); bytes[bytes.length - 1] = 9;
 const fingerprint = await engine.fingerprintSource({ size: bytes.length, check() {}, read: async (offset, length) => bytes.subarray(offset, offset + length) });
 const item = { ordinal: 0, thingId: 'a-file', revision: 'v1', snapshot: { adapter: 'fixture', version: 1, value: { label: 'private-label', parentId: 'original-parent' } }, content: { size: bytes.length, fingerprint } };
 async function* items() { yield item; yield { ordinal: 1, thingId: 'b-folder', revision: 'v1', snapshot: { adapter: 'fixture', version: 1, value: { label: 'private-folder' } }, content: null }; }
 await engine.prepareBackup(source, header, items(), access);
 await engine.captureBackup(source, snapshotId, { read: async (_item, offset, length) => bytes.subarray(offset, offset + length) }, access, { rangePageItems: 1 });
 const seal = await engine.sealBackup(source, snapshotId, access);
 const identity = async path => { const stat = await fs.lstat(path, { bigint: true }); return { dev: String(stat.dev), ino: String(stat.ino) }; };
 const data = { protocol: 1, jobId: randomUUID(), sourceDirectory, destinationDirectory, snapshotId, scope, sourceIdentity: await identity(sourceDirectory), destinationIdentity: await identity(destinationDirectory), manifestHash: seal.manifestHash };
 return { directory, source, data, bytes, item, seal, firstHash: hash(bytes.subarray(0, engine.BACKUP_CHUNK_BYTES)) };
}
function run(data, action = async () => {}) {
 const worker = new Worker(workerPath, { workerData: data });
 const messages = [];
 let operations = Promise.resolve();
 const done = new Promise((resolveDone, reject) => {
  worker.on('message', m => {
   messages.push(m);
   operations = operations.then(async () => {
    const handled = await action(m, worker);
    if (m.type === 'authorize' && handled !== false) worker.postMessage({ type: 'authorization', id: m.id, allowed: true });
   }).catch(reject);
  });
  worker.on('error', reject);
  worker.on('exit', async code => { await operations; if (code !== 0) reject(Error('Worker exited ' + code)); else resolveDone(messages); });
 });
 return { worker, messages, done };
}
const terminal = messages => messages.findLast(m => ['paused', 'complete'].includes(m.type));
function noLeak(messages, f) {
 const text = JSON.stringify(messages);
 for (const secret of [f.directory, 'private-label', 'private-folder', 'original-parent', 'synthetic-owner', 'backup.invalid']) assert.equal(text.includes(secret), false, secret);
 for (const m of messages) assert.ok(['authorize', 'progress', 'complete', 'paused'].includes(m.type));
}
test('bundled worker copies canonical metadata and every byte with bounded decimal progress', async () => {
 const f = await fixture();
 const messages = await run(f.data).done;
 assert.equal(terminal(messages).type, 'complete');
 assert.equal(terminal(messages).manifestHash, f.seal.manifestHash);
 const destination = await engine.openLocalBackupStore(f.data.destinationDirectory, { create: false });
 assert.deepEqual(await engine.verifySealedBackup(destination, f.data.snapshotId, access), f.seal);
 const entry = await engine.openBackupItem(destination, f.data.snapshotId, 'a-file', access);
 assert.deepEqual(entry.item, f.item);
 const chunks = []; for await (const chunk of entry.ranges) chunks.push(chunk);
 assert.deepEqual(Buffer.concat(chunks), f.bytes);
 assert.ok(messages.some(m => m.progress?.phase === 'verifying'));
 for (const m of messages.filter(m => m.type === 'progress')) for (const key of ['copiedBytes', 'reusedBytes', 'totalBytes']) assert.match(m.progress[key], /^(0|[1-9][0-9]*)$/);
 noLeak(messages, f);
});
test('hard worker termination resumes retained chunks without reading them from source', async () => {
 const f = await fixture();
 const first = run(f.data, async (m, worker) => {
  if (m.progress?.phase === 'copying' && BigInt(m.progress.copiedBytes) > 0n) { await worker.terminate(); return false; }
 });
 await assert.rejects(first.done, /Worker exited/);
 // Removing the copied source chunk makes a source reread impossible. The
 // destination still independently verifies its retained bytes before sealing.
 await fs.unlink(join(f.data.sourceDirectory, 'chunks', f.firstHash));
 const messages = await run(f.data).done;
 assert.equal(terminal(messages).type, 'complete');
 assert.equal(terminal(messages).reusedBytes, String(engine.BACKUP_CHUNK_BYTES));
 assert.equal(terminal(messages).copiedBytes, '37');
 noLeak(messages, f);
});
test('missing and corrupt retained source bytes refuse success without leaking details', async () => {
 for (const corrupt of [false, true]) {
  const f = await fixture(), path = join(f.data.sourceDirectory, 'chunks', f.firstHash);
  if (corrupt) await fs.writeFile(path, Buffer.from('corrupt'), { mode: 0o600 }); else await fs.unlink(path);
  const messages = await run(f.data).done;
  assert.deepEqual(terminal(messages), { type: 'paused', code: 'COPY_FAILED' });
  await assert.rejects(fs.stat(join(f.data.destinationDirectory, 'snapshots', f.data.snapshotId, 'complete.json')));
  noLeak(messages, f);
 }
});
test('directory replacement, missing destination, changed seal and unsafe inputs fail closed', async () => {
 for (const mutation of ['replace', 'missing', 'hash', 'scope', 'symlink', 'identity']) {
  const f = await fixture();
  if (mutation === 'replace') { await fs.rename(f.data.destinationDirectory, f.data.destinationDirectory + '-old'); await fs.mkdir(f.data.destinationDirectory, { mode: 0o700 }); }
  if (mutation === 'missing') await fs.rmdir(f.data.destinationDirectory);
  if (mutation === 'hash') f.data.manifestHash = '0'.repeat(64);
  if (mutation === 'scope') f.data.scope = { ...scope, ownerId: 'wrong-owner' };
  if (mutation === 'symlink') { await fs.rename(f.data.destinationDirectory, f.data.destinationDirectory + '-old'); await fs.symlink(f.data.destinationDirectory + '-old', f.data.destinationDirectory); }
  if (mutation === 'identity') f.data.sourceIdentity.ino = '0';
  const messages = await run(f.data).done;
  assert.deepEqual(terminal(messages), { type: 'paused', code: 'COPY_FAILED' }, mutation);
  if (mutation === 'missing') await assert.rejects(fs.stat(f.data.destinationDirectory));
  noLeak(messages, f);
 }
});
test('parent revocation and cancellation interrupt; replacing destination during authorization is detected', async () => {
 for (const mode of ['deny', 'cancel', 'replace']) {
  const f = await fixture(); let count = 0;
  const messages = await run(f.data, async (m, worker) => {
   if (m.type !== 'authorize' || ++count !== 3) return;
   if (mode === 'replace') { await fs.rename(f.data.destinationDirectory, f.data.destinationDirectory + '-old'); await fs.mkdir(f.data.destinationDirectory, { mode: 0o700 }); return; }
   worker.postMessage(mode === 'cancel' ? { type: 'cancel' } : { type: 'authorization', id: m.id, allowed: false }); return false;
  }).done;
  assert.deepEqual(terminal(messages), { type: 'paused', code: mode === 'replace' ? 'COPY_FAILED' : 'INTERRUPTED' });
  noLeak(messages, f);
 }
});
test('corrupt destination chunk and malformed worker protocol cannot produce completion', async () => {
 const f = await fixture();
 await fs.mkdir(join(f.data.destinationDirectory, 'chunks'), { mode: 0o700 });
 await fs.writeFile(join(f.data.destinationDirectory, 'chunks', f.firstHash), Buffer.from('bad retained bytes'), { mode: 0o600 });
 const messages = await run(f.data).done;
 assert.deepEqual(terminal(messages), { type: 'paused', code: 'COPY_FAILED' });
 noLeak(messages, f);
 for (const data of [{ ...f.data, protocol: 2 }, { ...f.data, jobId: '' }, { ...f.data, unknown: true }, { ...f.data, scope: { ...scope, dataPlane: 'other' } }]) {
  const refused = await run(data).done;
  assert.deepEqual(refused, [{ type: 'paused', code: 'COPY_FAILED' }]);
 }
});
test('unanswered authorization expires after 30 seconds with generic interrupted output', { timeout: 35000 }, async () => {
 const f = await fixture(), started = Date.now();
 const messages = await run(f.data, async () => false).done;
 assert.ok(Date.now() - started >= 29000);
 assert.deepEqual(messages.map(m => m.type), ['authorize', 'paused']);
 assert.deepEqual(terminal(messages), { type: 'paused', code: 'INTERRUPTED' });
 noLeak(messages, f);
});
