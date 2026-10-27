import test from 'node:test';
import assert from 'node:assert/strict';
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from 'fflate';
import { decodeTransferArchive as decodeBytes, decodeTransferArchiveBlob, encodeTransferArchiveBlob, encodeTransferArchive, transferChecksum, type TransferBundle } from './archive';
import { TRANSFER_FORMAT, TRANSFER_LIMITS, serializeTransfer } from './format';

const fixture = async (): Promise<TransferBundle> => {
  const bytes = new TextEncoder().encode('An actual file 🥰\n');
  return {
    manifest: { format: TRANSFER_FORMAT, version: 1, roots: ['root'], things: [{ id: 'root', thingtime: ['post'], crystal: { text: 'Hello' } }],
      files: [{ id: 'photo', targetId: 'root', path: 'files/000000', name: 'hello.txt', mime: 'text/plain', bytes: bytes.length, sha256: await transferChecksum(bytes) }] },
    files: new Map([['photo', bytes]])
  };
};

for (const format of ['bytes', 'blob'] as const) {
const decodeTransferArchive = async (input: Uint8Array, signal?: AbortSignal): Promise<TransferBundle> => {
  if (format === 'bytes') return decodeBytes(input, signal);
  const bundle = await decodeTransferArchiveBlob(new Blob([Uint8Array.from(input)]), signal);
  return { manifest: bundle.manifest, files: new Map(await Promise.all([...bundle.files].map(async ([id, blob]) => [id, new Uint8Array(await blob.arrayBuffer())] as const))) };
};
const testCase = (name: string, run: () => Promise<void>) => test(`${format}: ${name}`, run);

testCase('ZIP round trip preserves actual bytes, Unicode filenames and manifest', async () => {
  const bundle = await fixture();
  bundle.manifest.files[0].name = 'hello 🥰.txt';
  assert.deepEqual(await decodeTransferArchive(await encodeTransferArchive(bundle)), bundle);
});

testCase('imports deflated files when a ZIP tool reordered the manifest last', async () => {
  const bundle = await fixture();
  const bytes = zipSync({ 'files/000000': bundle.files.get('photo')!, 'thingtime.json': new TextEncoder().encode(serializeTransfer(bundle.manifest)) }, { level: 6 });
  assert.deepEqual(await decodeTransferArchive(bytes), bundle);
});

testCase('refuses missing and tampered bytes before creating an archive', async () => {
  const bundle = await fixture();
  bundle.files.set('photo', new Uint8Array(bundle.manifest.files[0].bytes));
  await assert.rejects(encodeTransferArchive(bundle), /checksum/);
  bundle.files.clear();
  await assert.rejects(encodeTransferArchive(bundle), /missing/);
});

testCase('refuses undeclared paths, missing files and zip-slip entries', async () => {
  const bundle = await fixture();
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
  await assert.rejects(decodeTransferArchive(zipSync({ 'thingtime.json': manifest })), /incomplete/);
  for (const path of ['../escape', '/tmp/escape', 'files/000001']) {
    await assert.rejects(decodeTransferArchive(zipSync({ 'thingtime.json': manifest, 'files/000000': bundle.files.get('photo')!, [path]: new Uint8Array() })));
  }
});

testCase('checks actual inflated size and digest, not just a valid manifest', async () => {
  const bundle = await fixture();
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
  await assert.rejects(decodeTransferArchive(zipSync({ 'thingtime.json': manifest, 'files/000000': new Uint8Array(100000) })), /size|limit/);
  await assert.rejects(decodeTransferArchive(zipSync({ 'thingtime.json': manifest, 'files/000000': new Uint8Array(bundle.manifest.files[0].bytes) })), /checksum/);
});

testCase('cancellation stops processing without returning a partial bundle', async () => {
  const bundle = await fixture();
  const signal = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(encodeTransferArchive(bundle, signal), /cancelled/);
  await assert.rejects(decodeTransferArchive(await encodeTransferArchive(bundle), signal), /cancelled/);
});

testCase('zero-file manifests do not hide undeclared archive entries', async () => {
  const bundle = await fixture();
  bundle.manifest.files = [];
  const archive = zipSync({ 'thingtime.json': new TextEncoder().encode(serializeTransfer(bundle.manifest)), 'files/000000': new Uint8Array() });
  await assert.rejects(decodeTransferArchive(archive), /undeclared/);
});

testCase('forged ZIP size headers cannot bypass the streaming output limit', async () => {
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

}


test('large Blob manifests pass the former aggregate ceiling and still require exact actual bytes', async () => {
  const bundle = await fixture();
  bundle.manifest.files[0].bytes = TRANSFER_LIMITS.fileBytes + 1;
  const archive = zipSync({ 'thingtime.json': new TextEncoder().encode(serializeTransfer(bundle.manifest)), 'files/000000': new Uint8Array() });
  await assert.rejects(decodeTransferArchiveBlob(new Blob([Uint8Array.from(archive)])), /wrong size/);
  await assert.rejects(decodeTransferArchiveBlob(new Blob([Uint8Array.from(archive)]), undefined, { maxFileBytes: TRANSFER_LIMITS.fileBytes }), /too large/);
  await assert.rejects(decodeBytes(archive), /too large/);
  await assert.rejects(encodeTransferArchive(bundle), /too large/);
});

test('ZIP64 preflight honors consumer budgets before reading huge files', async () => {
  const bundle = await fixture();
  bundle.manifest.files[0].bytes = 0x100000001;
  const data = new Blob();
  Object.defineProperty(data, 'size', { value: bundle.manifest.files[0].bytes });
  Object.defineProperty(data, 'slice', { value: () => { throw new Error('must not read huge file'); } });
  const large = { manifest: bundle.manifest, files: new Map([['photo', data]]) };
  await assert.rejects(encodeTransferArchiveBlob(large, undefined, { maxArchiveBytes: 0x100000001 }), /consumer byte budget/);
});

test('stored payload ZIP signatures cannot terminate known-length entries', async () => {
  const bundle = await fixture();
  const bytes = new Uint8Array(256 * 1024 + 64);
  const signatures = [0x08074b50, 0x04034b50, 0x02014b50, 0x06064b50, 0x06054b50];
  for (const offset of [0, 4093, 256 * 1024 - 3]) {
    signatures.forEach((signature, index) => new DataView(bytes.buffer).setUint32(offset + index * 4, signature, true));
  }
  bundle.files.set('photo', bytes);
  bundle.manifest.files[0].bytes = bytes.length;
  bundle.manifest.files[0].sha256 = await transferChecksum(bytes);
  const archive = await encodeTransferArchiveBlob(bundle);
  const header = new DataView(await archive.slice(0, 30).arrayBuffer());
  assert.equal(header.getUint16(6, true) & 8, 0);
  const decoded = await decodeTransferArchiveBlob(archive);
  assert.deepEqual(new Uint8Array(await decoded.files.get('photo')!.arrayBuffer()), bytes);
});

test('consumer archive budgets reject before reading and Blob processing remains cancellable beyond the old cap', async () => {
  const bundle = await fixture();
  const archive = await encodeTransferArchive(bundle);
  await assert.rejects(decodeTransferArchiveBlob(new Blob([Uint8Array.from(archive)]), undefined, { maxArchiveBytes: archive.byteLength - 1 }), /consumer byte budget/);
  await assert.rejects(encodeTransferArchiveBlob(bundle, undefined, { maxArchiveBytes: 1 }), /consumer byte budget/);
  const controller = new AbortController();
  const large = new Blob();
  Object.defineProperty(large, 'size', { value: TRANSFER_LIMITS.fileBytes + 32 * 1024 * 1024 });
  Object.defineProperty(large, 'slice', { value: (start: number, end: number) => {
    assert.equal(start, 0); assert.ok(end <= 256 * 1024);
    controller.abort(new Error('cancelled bounded slice'));
    return new Blob([Uint8Array.from(archive)]);
  } });
  await assert.rejects(decodeTransferArchiveBlob(large, controller.signal), /cancelled bounded slice/);
  for (const size of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const malformed = new Blob(); Object.defineProperty(malformed, 'size', { value: size });
    await assert.rejects(decodeTransferArchiveBlob(malformed), /Invalid archive size/);
  }
});

test('truncated large-file payloads cannot publish a partial Blob bundle', async () => {
  const bundle = await fixture();
  bundle.manifest.files[0].bytes = TRANSFER_LIMITS.fileBytes + 1;
  const archive = zipSync({ 'thingtime.json': new TextEncoder().encode(serializeTransfer(bundle.manifest)), 'files/000000': new Uint8Array([1, 2, 3]) }, { level: 0 });
  const path = new TextEncoder().encode('files/000000');
  let offset = 0;
  for (let index = 0; index < archive.length - path.length; index++) {
    if (path.every((byte, part) => archive[index + part] === byte)) { offset = index + path.length + 1; break; }
  }
  assert.ok(offset > 0);
  await assert.rejects(decodeTransferArchiveBlob(new Blob([Uint8Array.from(archive.subarray(0, offset))])), /incomplete|unexpected EOF|invalid zip data/i);
});


for (const level of [0, 6] as const) for (const manifestFirst of [true, false]) {
  test(`manifest discovery discards skipped ${level ? 'deflated' : 'stored'} bytes with manifest ${manifestFirst ? 'first' : 'last'}`, async context => {
    const bundle = await fixture();
    // Large enough for many input pushes. A deterministic varying pattern
    // exercises stored and deflated entry framing without huge allocations.
    const bytes = new Uint8Array(8 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >>> 8)) & 255;
    bundle.files.set('photo', bytes);
    bundle.manifest.files[0].bytes = bytes.byteLength;
    bundle.manifest.files[0].sha256 = await transferChecksum(bytes);
    const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
    const entries = manifestFirst ? { 'thingtime.json': manifest, 'files/000000': bytes } : { 'files/000000': bytes, 'thingtime.json': manifest };
    const archive = zipSync(entries, { level });
    const original = Unzip.prototype.push;
    let maxRetained = 0, parserCount = 0;
    const state: { firstParser?: Unzip; activeParser?: Unzip; firstPassDecoderBytes: number } = { firstPassDecoderBytes: 0 };
    const parsers = new Set<Unzip>();
    context.mock.method(Unzip.prototype, 'push', function(this: Unzip, chunk: Uint8Array, final?: boolean) {
      state.firstParser ||= this;
      parsers.add(this); parserCount = parsers.size;
      const previous = state.activeParser;
      state.activeParser = this;
      try { original.call(this, chunk, final); } finally { state.activeParser = previous; }
      // Dependency-boundary regression: fflate's private pending-entry arrays
      // must never retain an unstarted entry's compressed input between pushes.
      const retained = (this as unknown as { k: Uint8Array[][] }).k.reduce((sum, chunks) => sum + chunks.reduce((total, data) => total + data.byteLength, 0), 0);
      maxRetained = Math.max(maxRetained, retained);
    });
    for (const Decoder of [UnzipPassThrough, UnzipInflate]) {
      const push = Decoder.prototype.push;
      context.mock.method(Decoder.prototype, 'push', function(this: UnzipPassThrough | UnzipInflate, chunk: Uint8Array, final: boolean) {
        if (state.activeParser === state.firstParser) state.firstPassDecoderBytes += chunk.byteLength;
        push.call(this, chunk, final);
      });
    }
    try {
      const decoded = await decodeTransferArchiveBlob(new Blob([Uint8Array.from(archive)]));
      assert.deepEqual(decoded.manifest, bundle.manifest);
      assert.equal(decoded.files.get('photo')!.size, bytes.byteLength);
      assert.equal(parserCount, 2);
      assert.equal(maxRetained, 0, 'manifest discovery must start a sink instead of buffering skipped input');
      assert.ok(state.firstPassDecoderBytes > 0 && state.firstPassDecoderBytes <= manifest.byteLength, 'only manifest input may reach a real decoder during discovery');
    } finally { context.mock.restoreAll(); }
  });
}

test('Node refuses unsupported ZIP64 Blob offsets before payload reads while consumer budgets retain priority', async () => {
  const bundle = await fixture();
  const blob = new Blob();
  Object.defineProperty(blob, 'size', { value: 0x100000000 });
  Object.defineProperty(blob, 'slice', { value: () => { throw new Error('must not read unsupported Blob'); } });
  bundle.manifest.files[0].bytes = blob.size;
  const large = { manifest: bundle.manifest, files: new Map([['photo', blob]]) };
  await assert.rejects(encodeTransferArchiveBlob(large), /Node.js Blob backend/);
  await assert.rejects(decodeTransferArchiveBlob(blob), /Node.js Blob backend/);
  await assert.rejects(decodeTransferArchiveBlob(blob, undefined, { maxArchiveBytes: 100 }), /consumer byte budget/);
  await assert.rejects(encodeTransferArchiveBlob(large, undefined, { maxArchiveBytes: 100 }), /consumer byte budget/);
});

test('Node rejects oversized declared output before inflating a small input', async context => {
  const bundle = await fixture();
  bundle.manifest.files[0].bytes = 0x100000000;
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
  const archive = zipSync({ 'thingtime.json': [manifest, { level: 0 }], 'files/000000': new Uint8Array(1024) });
  let inflaterCalls = 0;
  context.mock.method(UnzipInflate.prototype, 'push', () => { inflaterCalls++; throw new Error('must not inflate unsupported output'); });
  await assert.rejects(decodeTransferArchiveBlob(new Blob([Uint8Array.from(archive)])), /Node.js Blob backend/);
  assert.equal(inflaterCalls, 0);
});
