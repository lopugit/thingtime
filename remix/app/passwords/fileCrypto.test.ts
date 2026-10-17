import assert from 'node:assert/strict';
import test from 'node:test';
import { newPasswordFile, encryptPasswordFile, decryptPasswordFile, iterableStream, passwordFileCipherSize, PASSWORD_FILE_FRAME_BYTES } from './fileCrypto';
const collect = async (source: AsyncIterable<Uint8Array>) => new Uint8Array(await new Response(iterableStream(source)).arrayBuffer());
test('encrypted file framing round trips empty, boundary, multipart and binary bytes', async () => {
  for (const size of [0, 1, PASSWORD_FILE_FRAME_BYTES, PASSWORD_FILE_FRAME_BYTES + 33, 9 * PASSWORD_FILE_FRAME_BYTES]) {
    const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251), metadata = newPasswordFile('custom/icon\u0000name.png', size);
    const cipher = await collect(encryptPasswordFile(new Blob([bytes]).stream(), metadata));
    assert.equal(cipher.length, passwordFileCipherSize(size));
    const plain = await collect(decryptPasswordFile(new Blob([cipher]).stream(), metadata)); assert.deepEqual(plain, bytes);
  }
});
test('ciphertext corruption, truncation, wrong key, wrong size and frame reordering fail authentication', async () => {
  const metadata = newPasswordFile('secret', PASSWORD_FILE_FRAME_BYTES + 20), cipher = await collect(encryptPasswordFile(new Blob([new Uint8Array(metadata.size)]).stream(), metadata));
  const changed = cipher.slice(); changed[2] ^= 1;
  for (const bytes of [changed, cipher.slice(0, -1), new Uint8Array(), new Uint8Array([...cipher.slice(-36), ...cipher.slice(0, -36)])]) await assert.rejects(collect(decryptPasswordFile(new Blob([bytes]).stream(), metadata)));
  for (const wrong of [{ ...metadata, key: newPasswordFile('x', 0).key }, { ...metadata, size: metadata.size - 1 }, { ...metadata, token: crypto.randomUUID() }]) await assert.rejects(collect(decryptPasswordFile(new Blob([cipher]).stream(), wrong)));
});
test('cancelling encryption stops reading source bytes', async () => {
  let cancelled = false; const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(PASSWORD_FILE_FRAME_BYTES)); }, cancel() { cancelled = true; } });
  const generator = encryptPasswordFile(stream, newPasswordFile('file', PASSWORD_FILE_FRAME_BYTES * 3), abort.signal);
  await generator.next(); abort.abort(); await assert.rejects(generator.next()); assert.equal(cancelled, true);
});
