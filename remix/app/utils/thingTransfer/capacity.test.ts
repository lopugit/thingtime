import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { collectTransfer, type TransferSource } from './collect';
import { encodeTransferArchiveBlob } from './archive';
import { readTransferFile } from './readFile';

/** Explicit real-byte acceptance without a huge checked-in fixture. Blob
 * composition reuses a 1 MiB source; the archive and receiver retain their
 * actual bytes in Blob storage, never a single aggregate JS byte buffer. */
test('513 MiB of real Blob files collect, export and import with independent exact digests', {
  skip: process.env.TT_TRANSFER_LARGE_BLOB_TEST !== '1', timeout: 180000,
}, async () => {
  const roots = ['root'];
  const thing = { id: 'root', thingtime: ['data'], crystal: { name: 'Large portable files' } };
  const entries = [257, 256].map((mib, index) => {
    const chunk = new Uint8Array(1024 * 1024).fill(index + 7);
    const part = new Blob([chunk]);
    const hash = createHash('sha256');
    for (let n = 0; n < mib; n++) hash.update(chunk);
    return { id: `file-${index}`, name: `large-${index}.bin`, mime: 'application/octet-stream',
      data: new Blob(Array.from({ length: mib }, () => part)), expected: hash.digest('hex') };
  });
  const source: TransferSource<Blob> = {
    read: async () => thing, children: async () => ({ ids: [] }), dependencies: async () => [],
    files: async function* () { yield* entries; },
  };
  const bundle = await collectTransfer(roots, source);
  assert.equal(bundle.manifest.files.reduce((sum, file) => sum + file.bytes, 0), 513 * 1024 * 1024);
  assert.deepEqual(bundle.manifest.files.map(file => file.sha256), entries.map(entry => entry.expected));
  const archive = await encodeTransferArchiveBlob(bundle);
  assert.ok(archive.size > 513 * 1024 * 1024);
  const decoded = await readTransferFile(archive);
  assert.deepEqual(decoded.manifest, bundle.manifest);
  for (const entry of entries) {
    const received = decoded.files.get(entry.id)!;
    assert.equal(received.size, entry.data.size);
    const hash = createHash('sha256');
    const reader = received.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
      }
    } finally { reader.releaseLock(); }
    assert.equal(hash.digest('hex'), entry.expected);
  }
});
