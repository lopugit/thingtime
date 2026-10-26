import { sha256 } from '@noble/hashes/sha2.js';

export type BinaryRuntime = {
  Blob?: unknown;
  window?: unknown;
  process?: { release?: { name?: string }; versions?: { node?: string };
    getBuiltinModule?: (name: string) => { Blob?: unknown } | undefined };
};

/** Detect the actual Node Blob backend, not merely Node globals in an Electron
 * renderer. No node: imports are shipped to the browser. */
export const usesNodeBlobBackend = (runtime: BinaryRuntime = globalThis as BinaryRuntime): boolean => {
  const process = runtime.process;
  if (process?.release?.name !== 'node' || !process.versions?.node) return false;
  if (process.getBuiltinModule) return process.getBuiltinModule('node:buffer')?.Blob === runtime.Blob;
  // Older Node versions lack getBuiltinModule. A renderer with a window must
  // retain its native browser Blob behavior.
  return runtime.window === undefined;
};

/** Node 24.18.0 truncates openAsBlob lengths and fatally asserts while slicing
 * composite Blobs at the uint32 boundary. Conservatively fence this backend
 * until its large-Blob support can be verified without risking a process crash.
 * This is a runtime limitation; native Chromium Blobs retain ZIP64 support. */
export const assertBinaryPlatformSize = (size: number): void => {
  if (size >= 0x100000000 && usesNodeBlobBackend()) {
    throw new RangeError('This Node.js Blob backend cannot safely process archives or files of 4 GiB or larger; use the native Chromium Blob path for ZIP64 transfers');
  }
};

export type TransferBinary = Uint8Array | Blob;
export const binarySize = (value: TransferBinary) => value instanceof Blob ? value.size : value.byteLength;
export const binaryBlob = (value: TransferBinary): Blob => {
  assertBinaryPlatformSize(binarySize(value));
  return value instanceof Blob ? value : new Blob([Uint8Array.from(value)]);
};

/** Read one processing chunk at a time; never materialize an entire Blob. */
export async function blobChecksum(blob: Blob, check: () => void = () => {}) {
  assertBinaryPlatformSize(blob.size);
  const hash = sha256.create();
  try {
    check();
    for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
      check();
      const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
      check(); hash.update(bytes);
    }
    check(); return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
  } finally { hash.destroy(); }
}
