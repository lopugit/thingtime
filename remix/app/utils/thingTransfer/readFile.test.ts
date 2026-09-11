import assert from 'node:assert/strict';
import test from 'node:test';
import { readTransferFile } from './readFile';
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
