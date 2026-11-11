'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { unzipSync } = createRequire(path.resolve(__dirname, '../remix/package.json'))('fflate');
const { inventoryDirectory } = require('./inventory.cjs');

test('native release archive uses canonical ZIP layout and independently decoded bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-release-zip-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const payload = path.join(root, 'payload'); await fs.mkdir(payload);
  await fs.writeFile(path.join(payload, 'index.html'), '<p>native fixture</p>'); await fs.writeFile(path.join(payload, 'large.bin'), Buffer.alloc(2 * 1024 * 1024 + 13, 19));
  const descriptor = { version: '1.0.0', channel: 'stable', sequence: 1, target: { platform: 'darwin', arch: 'arm64' }, runtime: { id: 'fixture', nativeAbi: 'fixture', minShellVersion: '1.0.0', maxShellVersion: '1.0.0' }, entrypoints: { renderer: 'index.html' }, files: await inventoryDirectory(payload) };
  const { writeReleaseArchive } = await import('./archive.mjs');
  const { planStoredZip } = await import('../remix/app/utils/thingTransfer/storedZipCore.mjs');
  const first = path.join(root, 'one.zip'), second = path.join(root, 'two.zip');
  assert.deepEqual(await writeReleaseArchive(payload, descriptor, first), await writeReleaseArchive(payload, descriptor, second));
  const bytes = await fs.readFile(first), decoded = unzipSync(bytes), plan = planStoredZip(descriptor.files);
  assert.equal(bytes.length, plan.size);
  for (const file of plan.files) {
    const start = file.offset + file.localSize, content = bytes.subarray(start, start + file.bytes);
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256);
    assert.deepEqual(Buffer.from(decoded[file.path]), content);
  }
  await fs.writeFile(path.join(payload, 'index.html'), 'changed');
  await assert.rejects(writeReleaseArchive(payload, descriptor, path.join(root, 'bad.zip')), /inventory mismatch/);
});
