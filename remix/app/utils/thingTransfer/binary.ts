import { sha256 } from '@noble/hashes/sha2.js';

export type TransferBinary = Uint8Array | Blob;
export const binarySize = (value: TransferBinary) => value instanceof Blob ? value.size : value.byteLength;
export const binaryBlob = (value: TransferBinary): Blob => value instanceof Blob ? value : new Blob([Uint8Array.from(value)]);

/** Read one processing chunk at a time; never materialize an entire Blob. */
export async function blobChecksum(blob: Blob, check: () => void = () => {}) {
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
