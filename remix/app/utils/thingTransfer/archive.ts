import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough, type UnzipDecoder, type UnzipDecoderConstructor } from 'fflate';
import { parseTransfer, serializeTransfer, TRANSFER_LIMITS, TransferFormatError, type ThingTransfer, type TransferValidationOptions } from './format';
import { binaryBlob, binarySize, blobChecksum, type TransferBinary } from './binary';

export const TRANSFER_MANIFEST_PATH = 'thingtime.json';
/** Buffered compatibility budget. Blob paths use explicit consumer budgets. */
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
export type TransferArchiveOptions = TransferValidationOptions & { maxArchiveBytes?: number };
const archiveByteLimit = (options: TransferArchiveOptions): number => {
  const limit = options.maxArchiveBytes === undefined ? Number.MAX_SAFE_INTEGER : options.maxArchiveBytes;
  if (!Number.isSafeInteger(limit) || limit < 0) fail('Invalid transfer archive byte budget');
  return limit;
};
const checkArchiveSize = (size: number, options: TransferArchiveOptions) => {
  if (!Number.isSafeInteger(size) || size <= 0) fail('Invalid archive size');
  if (size > archiveByteLimit(options)) fail('Transfer archive exceeds the consumer byte budget');
};
// fflate's encoder writes 32-bit sizes and offsets, not ZIP64 records. Account
// for every local header, data descriptor, central record and the ZIP footer
// before reading files, so a large Blob cannot produce a wrapped/corrupt ZIP.
const zip32Size = (manifest: ThingTransfer, manifestBytes: number): number => {
  const entries = [{ path: TRANSFER_MANIFEST_PATH, bytes: manifestBytes }, ...manifest.files];
  let localBytes = 0, directoryBytes = 0;
  const requireZip64 = () => fail('This archive requires ZIP64; the current ZIP encoder supports only ZIP32 sizes and offsets');
  if (entries.length >= 0xffff) requireZip64();
  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.path).byteLength;
    if (entry.bytes >= 0xffffffff || localBytes >= 0xffffffff) requireZip64();
    localBytes += 30 + nameBytes + entry.bytes + 16;
    directoryBytes += 46 + nameBytes;
  }
  // The footer stores directory start and length independently as uint32.
  if (localBytes >= 0xffffffff || directoryBytes >= 0xffffffff) requireZip64();
  return localBytes + directoryBytes + 22;
};

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

/** Buffered compatibility for clipboard and byte-oriented consumers. Native
 * downloads call encodeTransferArchiveBlob directly. */
export const encodeTransferArchive = async (bundle: TransferBundle<TransferBinary>, signal?: AbortSignal): Promise<Uint8Array> => {
  const assertCurrent = bundle.assertCurrent;
  const blob = await encodeTransferArchiveBlob(bundle, signal, { maxFileBytes: TRANSFER_LIMITS.fileBytes, maxArchiveBytes: MAX_ARCHIVE_BYTES });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  abort(signal);
  await assertCurrent?.(signal);
  return bytes;
};

/** Downloadable archive without joining files or the ZIP into one JS buffer. */
export const encodeTransferArchiveBlob = async (bundle: TransferBundle<TransferBinary>, signal?: AbortSignal, options: TransferArchiveOptions = {}): Promise<Blob> => {
  abort(signal);
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest, options));
  const metadata = parseTransfer(new TextDecoder().decode(manifest), options);
  const expectedSize = zip32Size(metadata, manifest.byteLength);
  checkArchiveSize(expectedSize, options);
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
    if (size > expectedSize) { failure = new TransferFormatError('Transfer archive exceeds its expected size'); return; }
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
    if (!complete || size !== expectedSize) fail('The archive is incomplete');
    await assertCurrent?.(signal);
    abort(signal);
    return new Blob(parts, { type: 'application/zip' });
  } finally { zip.terminate(); }
};

/** Starting every entry is essential: fflate buffers all compressed input for
 * entries that have not started. A filename-aware sink consumes skipped input
 * without retaining or inflating it while the manifest is being located. */
const selectiveDecoder = (Decoder: UnzipDecoderConstructor, required: ReadonlyMap<string, number>): UnzipDecoderConstructor => class implements UnzipDecoder {
  static compression = Decoder.compression;
  ondata!: UnzipDecoder['ondata'];
  private decoder?: UnzipDecoder;
  private stopped = false;
  constructor(filename: string, size?: number, originalSize?: number) {
    if (required.has(filename)) this.decoder = new Decoder(filename, size, originalSize);
  }
  push(data: Uint8Array, final: boolean) {
    if (this.stopped) return;
    if (this.decoder) {
      this.decoder.ondata = this.ondata;
      this.decoder.push(data, final);
    } else if (final) this.ondata(null, new Uint8Array(), true);
  }
  terminate() { this.stopped = true; this.decoder?.terminate?.(); }
};

/** Two passes allow a re-zipped archive to put its manifest anywhere.
 * Pass one reads only the manifest; pass two inflates only declared files.
 * No archive filename is ever passed to the filesystem or used as a URL.
 */
const readEntries = async <T extends TransferBinary>(
  archive: TransferBinary, limits: Map<string, number>, collect: { chunk: (data: Uint8Array) => T; join: (chunks: T[], size: number) => T; chunkBytes?: number },
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
    if (file.compression !== 0 && file.compression !== 8) {
      failure = new TransferFormatError('Unsupported archive compression'); return;
    }
    const cap = limits.get(file.name);
    if (cap === undefined) {
      active.add(file);
      file.ondata = (error, _data, final) => {
        if (error) failure = error;
        if (final) active.delete(file);
      };
      file.start();
      return;
    }
    if (file.originalSize !== undefined && (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || file.originalSize > cap)) {
      failure = new TransferFormatError('An archive entry exceeds its declared size'); return;
    }
    let size = 0;
    const chunks: T[] = [];
    let pending: Uint8Array | undefined, pendingBytes = 0;
    active.add(file);
    file.ondata = (error, data, final) => {
      if (failure) return;
      if (error) { failure = error; return; }
      if (data.byteLength > cap - size) { failure = new TransferFormatError('An archive entry expands beyond its limit'); file.terminate(); return; }
      size += data.byteLength;
      if (collect.chunkBytes) {
        // Keep the inflater's small input budget without creating a browser
        // Blob handle for every 4 KiB callback. One bounded buffer per entry
        // coalesces results before handing them to the browser's Blob store.
        for (let offset = 0; offset < data.byteLength;) {
          pending ||= new Uint8Array(Math.min(cap, collect.chunkBytes));
          const length = Math.min(pending.byteLength - pendingBytes, data.byteLength - offset);
          pending.set(data.subarray(offset, offset + length), pendingBytes);
          pendingBytes += length; offset += length;
          if (pendingBytes === pending.byteLength) {
            chunks.push(collect.chunk(pending)); pending = undefined; pendingBytes = 0;
          }
        }
      } else chunks.push(collect.chunk(data));
      if (final) {
        if (pendingBytes) chunks.push(collect.chunk(pending!.subarray(0, pendingBytes)));
        result.set(file.name, collect.join(chunks, size));
        active.delete(file);
      }
    };
    file.start();
  });
  unzip.register(selectiveDecoder(UnzipPassThrough, limits));
  unzip.register(selectiveDecoder(UnzipInflate, limits));
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
  chunkBytes: 256 * 1024,
  // Retain at most one bounded processing buffer, not the whole file.
  chunk: (data: Uint8Array) => new Blob([Uint8Array.from(data)]),
  join: (chunks: Blob[]) => new Blob(chunks),
};

export const decodeTransferArchive = async (archive: Uint8Array, signal?: AbortSignal): Promise<TransferBundle> => {
  abort(signal);
  const options = { maxFileBytes: TRANSFER_LIMITS.fileBytes, maxArchiveBytes: MAX_ARCHIVE_BYTES };
  checkArchiveSize(archive.byteLength, options);
  const first = await readEntries(archive, new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes]]), byteCollector, signal);
  const manifest = parseTransfer(new TextDecoder('utf-8', { fatal: true }).decode(first.get(TRANSFER_MANIFEST_PATH)), options);
  const limits = new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes as number], ...manifest.files.map((file): [string, number] => [file.path, file.bytes])]);
  const entries = await readEntries(archive, limits, byteCollector, signal, true);
  const bundle = { manifest, files: new Map(manifest.files.map((file) => [file.id, entries.get(file.path)!])) };
  await verifyTransferFiles(bundle, signal);
  return bundle;
};

/** Native file selection keeps the archive and decoded files as immutable
 * Blobs. Only the bounded manifest and processing chunks enter JS buffers. */
export const decodeTransferArchiveBlob = async (archive: Blob, signal?: AbortSignal, options: TransferArchiveOptions = {}): Promise<TransferBundle<Blob>> => {
  abort(signal);
  checkArchiveSize(archive.size, options);
  const first = await readEntries(archive, new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes]]), byteCollector, signal);
  const manifest = parseTransfer(new TextDecoder('utf-8', { fatal: true }).decode(first.get(TRANSFER_MANIFEST_PATH)), options);
  const limits = new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes as number], ...manifest.files.map((file): [string, number] => [file.path, file.bytes])]);
  const entries = await readEntries(archive, limits, blobCollector, signal, true);
  const bundle = { manifest, files: new Map(manifest.files.map(file => [file.id, entries.get(file.path)!])) };
  await verifyTransferFiles(bundle, signal);
  return bundle;
};
