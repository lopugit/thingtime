import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { decodeTransferArchive, encodeTransferArchive, transferChecksum, type TransferBundle } from './archive';
import { TRANSFER_FORMAT, serializeTransfer } from './format';

const fixture = async (): Promise<TransferBundle> => {
  const bytes = new TextEncoder().encode('An actual file 🥰\n');
  return {
    manifest: { format: TRANSFER_FORMAT, version: 1, roots: ['root'], things: [{ id: 'root', thingtime: ['post'], crystal: { text: 'Hello' } }],
      files: [{ id: 'photo', targetId: 'root', path: 'files/000000', name: 'hello.txt', mime: 'text/plain', bytes: bytes.length, sha256: await transferChecksum(bytes) }] },
    files: new Map([['photo', bytes]])
  };
};

test('ZIP round trip preserves actual bytes, Unicode filenames and manifest', async () => {
  const bundle = await fixture();
  bundle.manifest.files[0].name = 'hello 🥰.txt';
  assert.deepEqual(await decodeTransferArchive(await encodeTransferArchive(bundle)), bundle);
});

test('imports deflated files when a ZIP tool reordered the manifest last', async () => {
  const bundle = await fixture();
  const bytes = zipSync({ 'files/000000': bundle.files.get('photo')!, 'thingtime.json': new TextEncoder().encode(serializeTransfer(bundle.manifest)) }, { level: 6 });
  assert.deepEqual(await decodeTransferArchive(bytes), bundle);
});

test('refuses missing and tampered bytes before creating an archive', async () => {
  const bundle = await fixture();
  bundle.files.set('photo', new Uint8Array(bundle.manifest.files[0].bytes));
  await assert.rejects(encodeTransferArchive(bundle), /checksum/);
  bundle.files.clear();
  await assert.rejects(encodeTransferArchive(bundle), /missing/);
});

test('refuses undeclared paths, missing files and zip-slip entries', async () => {
  const bundle = await fixture();
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
  await assert.rejects(decodeTransferArchive(zipSync({ 'thingtime.json': manifest })), /incomplete/);
  for (const path of ['../escape', '/tmp/escape', 'files/000001']) {
    await assert.rejects(decodeTransferArchive(zipSync({ 'thingtime.json': manifest, 'files/000000': bundle.files.get('photo')!, [path]: new Uint8Array() })));
  }
});

test('checks actual inflated size and digest, not just a valid manifest', async () => {
  const bundle = await fixture();
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
  await assert.rejects(decodeTransferArchive(zipSync({ 'thingtime.json': manifest, 'files/000000': new Uint8Array(100000) })), /size|limit/);
  await assert.rejects(decodeTransferArchive(zipSync({ 'thingtime.json': manifest, 'files/000000': new Uint8Array(bundle.manifest.files[0].bytes) })), /checksum/);
});

test('cancellation stops processing without returning a partial bundle', async () => {
  const bundle = await fixture();
  const signal = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(encodeTransferArchive(bundle, signal), /cancelled/);
  await assert.rejects(decodeTransferArchive(await encodeTransferArchive(bundle), signal), /cancelled/);
});

test('zero-file manifests do not hide undeclared archive entries', async () => {
  const bundle = await fixture();
  bundle.manifest.files = [];
  const archive = zipSync({ 'thingtime.json': new TextEncoder().encode(serializeTransfer(bundle.manifest)), 'files/000000': new Uint8Array() });
  await assert.rejects(decodeTransferArchive(archive), /undeclared/);
});

test('forged ZIP size headers cannot bypass the streaming output limit', async () => {
  const bundle = await fixture();
  const archive = zipSync({ 'thingtime.json': new TextEncoder().encode(serializeTransfer(bundle.manifest)), 'files/000000': new Uint8Array(100000) }, { level: 9 });
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let offset = 0; offset + 46 < archive.length; offset++) {
    const signature = view.getUint32(offset, true);
    const header = signature === 0x04034b50 ? 30 : signature === 0x02014b50 ? 46 : 0;
    if (header && new TextDecoder().decode(archive.subarray(offset + header, offset + header + 12)) === 'files/000000') {
      view.setUint32(offset + (header === 30 ? 22 : 24), bundle.manifest.files[0].bytes, true);
    }
  }
  await assert.rejects(decodeTransferArchive(archive), /expands beyond/);
});
