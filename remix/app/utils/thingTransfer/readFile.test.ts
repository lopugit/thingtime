import assert from 'node:assert/strict';
import test from 'node:test';
import { readTransferFile, readTransferFiles } from './readFile';
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
  assert.deepEqual(new Uint8Array(await actual.files.get('attachment')!.arrayBuffer()), bytes);
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
  for (const [index, bundle] of bundles.entries()) {
    assert.deepEqual(bundle.manifest, originals[index]);
    assert.deepEqual(new Uint8Array(await bundle.files.get('same-id')!.arrayBuffer()), payloads[index]);
  }
});

test('batch selection validates every file before returning and honors cancellation', async () => {
  const valid = new File([serializeTransfer(manifest())], 'thing.json');
  await assert.rejects(readTransferFiles([valid, new File(['invalid'], 'bad.json')]), /valid JSON/);
  await assert.rejects(readTransferFiles([]), /Choose/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readTransferFiles([valid], controller.signal), { name: 'AbortError' });
});

test('more than twelve transfer files remain independent', async () => {
  const files = Array.from({ length: 20 }, (_, index) => {
    const value = manifest(); value.things[0].crystal.content = `Independent item ${index}`;
    return new File([serializeTransfer(value)], `item-${index}.json`);
  });
  const bundles = await readTransferFiles(files);
  assert.equal(bundles.length, files.length);
  assert.deepEqual(bundles.map(bundle => bundle.manifest.things[0].crystal.content), files.map((_, index) => `Independent item ${index}`));
  assert.ok(bundles.every(bundle => bundle.manifest.roots[0] === 'post'));
  bundles[0].manifest.things[0].crystal.content = 'Edited first item';
  assert.equal(bundles[1].manifest.things[0].crystal.content, 'Independent item 1');
});

test('separate transfers do not consume one combined Thing budget', async () => {
  const original = manifest();
  original.things = Array.from({ length: 600 }, (_, index) => ({ id: `post-${index}`, thingtime: ['post'], crystal: { content: `Independent ${index}` } }));
  original.roots = original.things.map(row => row.id);
  const file = new File([serializeTransfer(original)], 'many-things.json');
  const bundles = await readTransferFiles([file, file]);
  assert.equal(bundles.reduce((sum, bundle) => sum + bundle.manifest.things.length, 0), 1200);
  assert.deepEqual(bundles[0].manifest, original);
  assert.deepEqual(bundles[1].manifest, original);
  bundles[0].manifest.things[599].crystal.content = 'Changed first transfer';
  assert.equal(bundles[1].manifest.things[599].crystal.content, 'Independent 599');
});

test('an oversized individual transfer is still refused inside a batch', async () => {
  const valid = new File([serializeTransfer(manifest())], 'valid.json');
  const oversized = manifest();
  oversized.things = Array.from({ length: 1001 }, (_, index) => ({ id: `post-${index}`, thingtime: ['post'], crystal: { content: 'Invalid single transfer' } }));
  oversized.roots = ['post-0'];
  await assert.rejects(readTransferFiles([valid, new File([JSON.stringify(oversized)], 'oversized.json')]), /Invalid number of Things/);
});
