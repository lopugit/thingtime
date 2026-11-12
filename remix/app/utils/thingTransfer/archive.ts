import { Unzip, UnzipInflate, zip } from 'fflate';
import { parseTransfer, serializeTransfer, TRANSFER_LIMITS, TransferFormatError, type ThingTransfer } from './format';

export const TRANSFER_MANIFEST_PATH = 'thingtime.json';
export const MAX_ARCHIVE_BYTES = TRANSFER_LIMITS.manifestBytes + TRANSFER_LIMITS.fileBytes + 1024 * 1024;
export type TransferBundle = { manifest: ThingTransfer; files: Map<string, Uint8Array> };

export const transferChecksum = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const fail = (message: string): never => { throw new TransferFormatError(message); };
const abort = (signal?: AbortSignal) => { signal?.throwIfAborted(); };

/** Validate actual bytes, not the ZIP headers' untrusted size claims. */
export const verifyTransferFiles = async (bundle: TransferBundle, signal?: AbortSignal): Promise<void> => {
  if (bundle.files.size !== bundle.manifest.files.length) fail('The transfer has missing or unexpected files');
  for (const file of bundle.manifest.files) {
    abort(signal);
    const data = bundle.files.get(file.id);
    if (!data || data.byteLength !== file.bytes) fail('A transferred file has the wrong size');
    if (await transferChecksum(data!) !== file.sha256) fail('A transferred file failed its checksum');
  }
  abort(signal);
};

export const encodeTransferArchive = async (bundle: TransferBundle, signal?: AbortSignal): Promise<Uint8Array> => {
  const manifest = new TextEncoder().encode(serializeTransfer(bundle.manifest));
  await verifyTransferFiles(bundle, signal);
  const entries: Record<string, Uint8Array> = { [TRANSFER_MANIFEST_PATH]: manifest };
  for (const file of bundle.manifest.files) entries[file.path] = bundle.files.get(file.id)!;
  // Files are commonly already-compressed media. Store them without another
  // compression pass; the resulting ZIP is readable by ordinary ZIP tools.
  return new Promise((resolve, reject) => {
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
};

/** Two passes allow a re-zipped archive to put its manifest anywhere.
 * Pass one reads only the manifest; pass two inflates only declared files.
 * No archive filename is ever passed to the filesystem or used as a URL.
 */
const readEntries = async (
  archive: Uint8Array, limits: Map<string, number>, signal?: AbortSignal, exact = false
): Promise<Map<string, Uint8Array>> => {
  const result = new Map<string, Uint8Array>();
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
    const chunks: Uint8Array[] = [];
    active.add(file);
    file.ondata = (error, data, final) => {
      if (failure) return;
      if (error) { failure = error; return; }
      size += data.byteLength;
      if (size > cap) { failure = new TransferFormatError('An archive entry expands beyond its limit'); file.terminate(); return; }
      chunks.push(data);
      if (final) {
        const joined = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
        result.set(file.name, joined);
        active.delete(file);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    // Small compressed chunks bound each inflater output allocation, including
    // malicious files whose local/central-directory size fields are false.
    for (let offset = 0; offset < archive.byteLength; offset += 4096) {
      abort(signal);
      unzip.push(archive.subarray(offset, offset + 4096), offset + 4096 >= archive.byteLength);
      if (failure) throw failure;
      if (offset % (256 * 1024) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (active.size || [...limits.keys()].some((path) => !result.has(path))) fail('The archive is incomplete');
    // During pass two every entry must be declared. Pass one's single limit
    // deliberately admits yet-unread files so ordering is immaterial.
    if (exact && [...seen].some((path) => !limits.has(path))) fail('The archive contains undeclared files');
    return result;
  } finally { for (const file of active) file.terminate(); }
};

export const decodeTransferArchive = async (archive: Uint8Array, signal?: AbortSignal): Promise<TransferBundle> => {
  abort(signal);
  if (!archive.byteLength || archive.byteLength > MAX_ARCHIVE_BYTES) fail('Invalid archive size');
  const first = await readEntries(archive, new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes]]), signal);
  const manifest = parseTransfer(new TextDecoder('utf-8', { fatal: true }).decode(first.get(TRANSFER_MANIFEST_PATH)));
  const limits = new Map([[TRANSFER_MANIFEST_PATH, TRANSFER_LIMITS.manifestBytes as number], ...manifest.files.map((file): [string, number] => [file.path, file.bytes])]);
  const entries = await readEntries(archive, limits, signal, true);
  const bundle = { manifest, files: new Map(manifest.files.map((file) => [file.id, entries.get(file.path)!])) };
  await verifyTransferFiles(bundle, signal);
  return bundle;
};
