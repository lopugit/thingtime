// Versioned, independently authenticated frames keep encryption memory bounded.
// The per-file key and nonce prefix are encrypted by the account vault server-side.
export const PASSWORD_FILE_FRAME_BYTES = 1024 * 1024;
export type PasswordFile = { version: 1; token: string; name: string; size: number; key: string; nonce: string; archivePath?: string; role?: 'attachment' | 'source' | 'icon' | 'document' };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const passwordFileCipherSize = (size: number) => size + 16 * Math.max(1, Math.ceil(size / PASSWORD_FILE_FRAME_BYTES));
export function newPasswordFile(name: string, size: number): PasswordFile {
  return { version: 1, token: crypto.randomUUID(), name, size, key: encode(crypto.getRandomValues(new Uint8Array(32))), nonce: encode(crypto.getRandomValues(new Uint8Array(8))) };
}
export function validatePasswordFile(input: unknown): PasswordFile {
  const f = input as PasswordFile;
  if (!f || f.version !== 1 || typeof f.name !== 'string' || !Number.isSafeInteger(f.size) || f.size < 0 || !Number.isSafeInteger(passwordFileCipherSize(f.size)) ||
    typeof f.token !== 'string' || !/^[a-f\d-]{36}$/i.test(f.token) || typeof f.key !== 'string' || !/^[A-Za-z\d+/]{43}=$/.test(f.key) || typeof f.nonce !== 'string' || !/^[A-Za-z\d+/]{11}=$/.test(f.nonce) ||
    (f.archivePath !== undefined && typeof f.archivePath !== 'string') || (f.role !== undefined && !['attachment', 'source', 'icon', 'document'].includes(f.role))) throw new Error('Invalid encrypted file metadata.');
  return { version: 1, token: f.token, name: f.name, size: f.size, key: f.key, nonce: f.nonce, ...(f.archivePath === undefined ? {} : { archivePath: f.archivePath }), ...(f.role ? { role: f.role } : {}) };
}
function params(file: PasswordFile, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff) throw new Error('File exceeds the encryption format capacity.');
  const iv = new Uint8Array(12); iv.set(decode(file.nonce)); new DataView(iv.buffer).setUint32(8, index);
  return { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(JSON.stringify([1, file.token, file.size, index])) };
}
async function* chunks(stream: ReadableStream<Uint8Array>, size: number, signal?: AbortSignal) {
  const reader = stream.getReader(); let buffer = new Uint8Array(size), used = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try { while (true) {
    signal?.throwIfAborted(); const { value, done } = await reader.read(); signal?.throwIfAborted(); if (done) break;
    for (let offset = 0; offset < value.length;) {
      const take = Math.min(size - used, value.length - offset); buffer.set(value.subarray(offset, offset + take), used); offset += take; used += take;
      if (used === size) { yield buffer; buffer = new Uint8Array(size); used = 0; }
    }
  } if (used) yield buffer.subarray(0, used); }
  finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function* encryptPasswordFile(stream: ReadableStream<Uint8Array>, metadata: PasswordFile, signal?: AbortSignal) {
  const file = validatePasswordFile(metadata), key = await crypto.subtle.importKey('raw', decode(file.key), 'AES-GCM', false, ['encrypt']);
  let index = 0, read = 0;
  for await (const bytes of chunks(stream, PASSWORD_FILE_FRAME_BYTES, signal)) { read += bytes.length; if (read > file.size) throw new Error('File size changed.'); yield new Uint8Array(await crypto.subtle.encrypt(params(file, index++), key, bytes as BufferSource)); }
  if (read !== file.size) throw new Error('File is incomplete.');
  if (!index) yield new Uint8Array(await crypto.subtle.encrypt(params(file, 0), key, new Uint8Array()));
}
export async function* decryptPasswordFile(stream: ReadableStream<Uint8Array>, metadata: PasswordFile, signal?: AbortSignal) {
  const file = validatePasswordFile(metadata), key = await crypto.subtle.importKey('raw', decode(file.key), 'AES-GCM', false, ['decrypt']);
  let index = 0, read = 0;
  for await (const bytes of chunks(stream, PASSWORD_FILE_FRAME_BYTES + 16, signal)) {
    const plain = new Uint8Array(await crypto.subtle.decrypt(params(file, index++), key, bytes as BufferSource)); read += plain.length;
    if (read > file.size) throw new Error('File integrity check failed.'); yield plain;
  }
  if (!index || read !== file.size) throw new Error('File is incomplete.');
}
export function iterableStream(source: AsyncIterable<Uint8Array>, strategy?: QueuingStrategy<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream({ async pull(controller) { try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); } catch (error) { controller.error(error); } }, async cancel() { await iterator.return?.(); } }, strategy);
}
export const passwordFileParts = (stream: ReadableStream<Uint8Array>, size: number, signal?: AbortSignal) => chunks(stream, size, signal);
