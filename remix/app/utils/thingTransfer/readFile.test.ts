import assert from 'node:assert/strict';
import test from 'node:test';
import { readTransferFile, readTransferFiles, MAX_TRANSFER_BATCH } from './readFile';
import { encodeTransferArchive, transferChecksum } from './archive';
import { serializeTransfer, type ThingTransfer } from './format';

const manifest = (): ThingTransfer => ({ format: 'thingtime.transfer', version: 1, roots: ['post'], things: [{ id: 'post', thingtime: ['post'], crystal: { content: 'Portable content' } }], files: [] });

test('reads portable JSON regardless of browser MIME and rejects ordinary JSON', async () => {
  const original = manifest();
  assert.deepEqual((await readTransferFile(new Blob([serializeTransfer(original)], { type: 'application/octet-stream' }))).manifest, original);
  await assert.rejects(readTransferFile(new Blob(['{"title":"not a transfer"}'])), /Unsupported transfer field/);
});

test('detects ZIP bytes and verifies complete attached content', async () => {
  const original = manifest();
  const bytes = new TextEncoder().encode('independent file');
  original.files.push({ id: 'attachment', targetId: 'post', path: 'files/000000', name: 'a.txt', mime: 'text/plain', bytes: bytes.length, sha256: await transferChecksum(bytes) });
  await assert.rejects(readTransferFile(new Blob([serializeTransfer(original)])), /complete Thingtime ZIP/);
  const archive = await encodeTransferArchive({ manifest: original, files: new Map([['attachment', bytes]]) });
  const actual = await readTransferFile(new Blob([Uint8Array.from(archive)], { type: 'text/plain' }));
  assert.deepEqual(actual.manifest, original);
  assert.deepEqual(actual.files.get('attachment'), bytes);
});

test('aborted selection does not publish a stale parsed transfer', async () => {
  const controller = new AbortController();
  const file = new Blob([serializeTransfer(manifest())]);
  const pending = readTransferFile(file, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('multi-file selection keeps overlapping identities and different bytes independent', async () => {
  const originals = [manifest(), manifest()];
  const payloads = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
  const files: File[] = [];
  for (const [index, original] of originals.entries()) {
    original.files = [{ id: 'same-id', targetId: 'post', path: 'files/000000', name: 'same.txt', mime: 'text/plain', bytes: 2, sha256: await transferChecksum(payloads[index]) }];
    const zip = await encodeTransferArchive({ manifest: original, files: new Map([['same-id', payloads[index]]]) });
    files.push(new File([Uint8Array.from(zip)], 'same.zip'));
  }
  const bundles = await readTransferFiles(files);
  assert.equal(bundles.length, 2);
  bundles.forEach((bundle, index) => {
    assert.deepEqual(bundle.manifest, originals[index]);
    assert.deepEqual(bundle.files.get('same-id'), payloads[index]);
  });
});

test('batch selection validates every file before returning and rejects excessive selection', async () => {
  const valid = new File([serializeTransfer(manifest())], 'thing.json');
  await assert.rejects(readTransferFiles([valid, new File(['invalid'], 'bad.json')]), /valid JSON/);
  await assert.rejects(readTransferFiles([]), /Choose/);
  await assert.rejects(readTransferFiles(Array(MAX_TRANSFER_BATCH + 1).fill(valid)), /Choose/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readTransferFiles([valid], controller.signal), { name: 'AbortError' });
});
