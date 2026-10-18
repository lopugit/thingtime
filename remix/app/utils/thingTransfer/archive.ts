import { Unzip, UnzipInflate, Zip, ZipPassThrough, zip } from 'fflate';
import { parseTransfer, serializeTransfer, TRANSFER_LIMITS, TransferFormatError, type ThingTransfer } from './format';
import { binaryBlob, binarySize, blobChecksum, type TransferBinary } from './binary';

export const TRANSFER_MANIFEST_PATH = 'thingtime.json';
export const MAX_ARCHIVE_BYTES = TRANSFER_LIMITS.manifestBytes + TRANSFER_LIMITS.fileBytes + 1024 * 1024;
export type TransferBundle<T extends TransferBinary = Uint8Array> = { manifest: ThingTransfer; files: Map<string, T>;
  /** Optional in-process availability fence, excluded from every serialized format. */
  assertCurrent?: (signal?: AbortSignal) => Promise<void> };

export const transferChecksum = async (bytes: TransferBinary, signal?: AbortSignal): Promise<string> => {
  signal?.throwIfAborted();
  if (bytes instanceof Blob) return blobChecksum(bytes, () => signal?.throwIfAborted());
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  signal?.throwIfAborted();
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const fail = (message: string): never => { throw new TransferFormatError(message); };
const abort = (signal?: AbortSignal) => { signal?.throwIfAborted(); };

/** Validate actual bytes, not the ZIP headers' untrusted size claims. */
export const verifyTransferFiles = async (bundle: TransferBundle<TransferBinary>, signal?: AbortSignal): Promise<void> => {
  if (bundle.files.size !== bundle.manifest.files.length) fail('The transfer has missing or unexpected files');
  for (const file of bundle.manifest.files) {
    abort(signal);
    const data = bundle.files.get(file.id);
    if (!data || binarySize(data) !== file.bytes) fail('A transferred file has the wrong size');
    if (await transferChecksum(data!, signal) !== file.sha256) fail('A transferred file failed its checksum');
  }
  abort(signal);
};

export const encodeTransferArchive = async (bundle: TransferBundle, signal?: AbortSignal): Promise<Uint8Array> => {
  if (typeof bundle.assertCurrent === 'function') await bundle.assertCurrent(signal);
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
  await verifyTransferFiles(bundle, signal);
  const entries: Record<string, Uint8Array> = { [TRANSFER_MANIFEST_PATH]: manifest };
  for (const file of bundle.manifest.files) entries[file.path] = bundle.files.get(file.id)!;
  // Files are commonly already-compressed media. Store them without another
  // compression pass; the resulting ZIP is readable by ordinary ZIP tools.
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    abort(signal);
    let cancel: (() => void) | undefined;
    const stopped = () => { cancel?.(); reject(signal?.reason || new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', stopped, { once: true });
    cancel = zip(entries, { level: 0 }, (error, bytes) => {
      signal?.removeEventListener('abort', stopped);
      if (error) reject(error);
      else if (bytes.byteLength > MAX_ARCHIVE_BYTES) reject(new TransferFormatError('Transfer archive is too large'));
      else resolve(bytes);
    });
  });
  if (typeof bundle.assertCurrent === 'function') await bundle.assertCurrent(signal);
  return archive;
};

/** Downloadable archive without joining files or the ZIP into one JS buffer. */
export const encodeTransferArchiveBlob = async (bundle: TransferBundle<TransferBinary>, signal?: AbortSignal): Promise<Blob> => {
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
  const metadata = parseTransfer(new TextDecoder().decode(manifest));
  if (bundle.files.size !== metadata.files.length) fail('The transfer has missing or unexpected files');
  // Freeze caller-owned arrays and map membership before the first async read.
  const files = new Map([...bundle.files].map(([id, data]) => [id, binaryBlob(data)]));
  const assertCurrent = bundle.assertCurrent;
  await assertCurrent?.(signal);
  await verifyTransferFiles({ manifest: metadata, files }, signal);
  const parts: Blob[] = [];
  let size = 0, complete = false;
  let failure: Error | undefined;
  const zip = new Zip((error, data, final) => {
    if (failure) return;
    if (error) { failure = error; return; }
    size += data.byteLength;
    if (size > MAX_ARCHIVE_BYTES) { failure = new TransferFormatError('Transfer archive is too large'); return; }
    parts.push(new Blob([Uint8Array.from(data)]));
    complete = final;
  });
  try {
    const entries: [string, TransferBinary][] = [[TRANSFER_MANIFEST_PATH, manifest],
      ...metadata.files.map((file): [string, TransferBinary] => [file.path, files.get(file.id)!])];
    for (const [path, data] of entries) {
      abort(signal);
      const file = new ZipPassThrough(path);
      zip.add(file);
      const length = binarySize(data);
      if (!length) file.push(new Uint8Array(), true);
      for (let offset = 0; offset < length; offset += 256 * 1024) {
        abort(signal);
        const chunk = data instanceof Blob ? new Uint8Array(await data.slice(offset, offset + 256 * 1024).arrayBuffer())
          : data.subarray(offset, offset + 256 * 1024);
        abort(signal);
        file.push(chunk, offset + chunk.byteLength >= length);
        if (failure) throw failure;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    abort(signal); zip.end();
    if (failure) throw failure;
    if (!complete) fail('The archive is incomplete');
    await assertCurrent?.(signal);
    abort(signal);
    return new Blob(parts, { type: 'application/zip' });
  } finally { zip.terminate(); }
};

/** Two passes allow a re-zipped archive to put its manifest anywhere.
 * Pass one reads only the manifest; pass two inflates only declared files.
 * No archive filename is ever passed to the filesystem or used as a URL.
 */
const readEntries = async <T extends TransferBinary>(
  archive: TransferBinary, limits: Map<string, number>, collect: { chunk: (data: Uint8Array) => T; join: (chunks: T[], size: number) => T },
  signal?: AbortSignal, exact = false
): Promise<Map<string, T>> => {
  const result = new Map<string, T>();
  const seen = new Set<string>();
  let failure: Error | undefined;
  const active = new Set<{ terminate: () => void }>();
  const unzip = new Unzip((file) => {
    if (failure) return;
    if (seen.has(file.name) || seen.size >= TRANSFER_LIMITS.files + 1 ||
      (file.name !== TRANSFER_MANIFEST_PATH && !/^files\/[0-9]{6}$/.test(file.name))) {
      failure = new TransferFormatError('Duplicate, unsafe, or excessive archive entries'); return;
    }
    seen.add(file.name);
    const cap = limits.get(file.name);
    if (cap === undefined) return;
    if (file.originalSize !== undefined && file.originalSize > cap) {
      failure = new TransferFormatError('An archive entry exceeds its declared size'); return;
    }
    let size = 0;
    const chunks: T[] = [];
    active.add(file);
    file.ondata = (error, data, final) => {
      if (failure) return;
      if (error) { failure = error; return; }
      size += data.byteLength;
      if (size > cap) { failure = new TransferFormatError('An archive entry expands beyond its limit'); file.terminate(); return; }
      chunks.push(collect.chunk(data));
      if (final) {
        result.set(file.name, collect.join(chunks, size));
        active.delete(file);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    // Small compressed chunks bound each inflater output allocation, including
    // malicious files whose local/central-directory size fields are false.
    for (let offset = 0; offset < binarySize(archive); offset += 256 * 1024) {
      abort(signal);
      const block = archive instanceof Blob
        ? new Uint8Array(await archive.slice(offset, offset + 256 * 1024).arrayBuffer())
        : archive.subarray(offset, offset + 256 * 1024);
      abort(signal);
      for (let part = 0; part < block.byteLength; part += 4096) {
        unzip.push(block.subarray(part, part + 4096), offset + part + 4096 >= binarySize(archive));
        if (failure) throw failure;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (active.size || [...limits.keys()].some((path) => !result.has(path))) fail('The archive is incomplete');
    // During pass two every entry must be declared. Pass one's single limit
    // deliberately admits yet-unread files so ordering is immaterial.
    if (exact && [...seen].some((path) => !limits.has(path))) fail('The archive contains undeclared files');
    return result;
  } finally { for (const file of active) file.terminate(); }
};

const joinBytes = (chunks: Uint8Array[], size: number): Uint8Array => {
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined;
};
const byteCollector = { chunk: (data: Uint8Array) => data, join: joinBytes };
const blobCollector = {
  // Move each inflater result out of JS buffers before reading another block.
  chunk: (data: Uint8Array) => new Blob([Uint8Array.from(data)]),
  join: (chunks: Blob[]) => new Blob(chunks),
};

export const decodeTransferArchive = async (archive: Uint8Array, signal?: AbortSignal): Promise<TransferBundle> => {
  abort(signal);
  if (!archive.byteLength || archive.byteLength > MAX_ARCHIVE_BYTES) fail('Invalid archive size');
  const first = await readEntries(archive, new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes]]), byteCollector, signal);
  const manifest = parseTransfer(new TextDecoder('utf-8', { fatal: true }).decode(first.get(TRANSFER_MANIFEST_PATH)));
  const limits = new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes as number], ...manifest.files.map((file): [string, number] => [file.path, file.bytes])]);
  const entries = await readEntries(archive, limits, byteCollector, signal, true);
  const bundle = { manifest, files: new Map(manifest.files.map((file) => [file.id, entries.get(file.path)!])) };
  await verifyTransferFiles(bundle, signal);
  return bundle;
};

/** Native file selection keeps the archive and decoded files as immutable
 * Blobs. Only the bounded manifest and processing chunks enter JS buffers. */
export const decodeTransferArchiveBlob = async (archive: Blob, signal?: AbortSignal): Promise<TransferBundle<Blob>> => {
  abort(signal);
  if (!archive.size || archive.size > MAX_ARCHIVE_BYTES) fail('Invalid archive size');
  const first = await readEntries(archive, new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes]]), byteCollector, signal);
  const manifest = parseTransfer(new TextDecoder('utf-8', { fatal: true }).decode(first.get(TRANSFER_MANIFEST_PATH)));
  const limits = new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes as number], ...manifest.files.map((file): [string, number] => [file.path, file.bytes])]);
  const entries = await readEntries(archive, limits, blobCollector, signal, true);
  const bundle = { manifest, files: new Map(manifest.files.map(file => [file.id, entries.get(file.path)!])) };
  await verifyTransferFiles(bundle, signal);
  return bundle;
};
