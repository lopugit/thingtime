import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBinaryPlatformSize, binaryBlob, blobChecksum, usesNodeBlobBackend } from './binary';

const processIdentity = { release: { name: 'node' }, versions: { node: '24.18.0' } };
test('Node limit detection checks Blob identity and preserves Chromium/Electron renderers', () => {
  const native = {}, browser = {};
  assert.equal(usesNodeBlobBackend({ Blob: native, process: { ...processIdentity, getBuiltinModule: () => ({ Blob: native }) } }), true);
  assert.equal(usesNodeBlobBackend({ Blob: browser, window: {}, process: { ...processIdentity, getBuiltinModule: () => ({ Blob: native }) } }), false);
  assert.equal(usesNodeBlobBackend({ Blob: browser, window: {}, process: processIdentity }), false);
  assert.equal(usesNodeBlobBackend({ Blob: native, process: processIdentity }), true);
  assert.equal(usesNodeBlobBackend({ Blob: browser, window: {} }), false);
  assert.equal(usesNodeBlobBackend({ Blob: browser, window: {}, process: { versions: { node: '24.18.0' } } }), false);
});

test('Node guard accepts uint32 sizes but rejects the exact 4GiB boundary', () => {
  assert.equal(usesNodeBlobBackend(), true);
  assert.doesNotThrow(() => assertBinaryPlatformSize(0xffffffff));
  assert.throws(() => assertBinaryPlatformSize(0x100000000), /Node.js Blob backend/);
  assert.throws(() => assertBinaryPlatformSize(0x100000001), /Node.js Blob backend/);
});

test('Node binary conversion and hashing refuse unsupported Blob sizes before any read', async () => {
  // Synthetic metadata tests only prove early refusal, never large-byte support.
  const blob = new Blob();
  Object.defineProperty(blob, 'size', { value: 0x100000000 });
  Object.defineProperty(blob, 'slice', { value: () => { throw new Error('must not read unsupported Blob'); } });
  assert.throws(() => binaryBlob(blob), /Node.js Blob backend/);
  await assert.rejects(blobChecksum(blob), /Node.js Blob backend/);
  assert.equal(await blobChecksum(new Blob(['hello'])), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});
