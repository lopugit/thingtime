import { sha256 } from '@noble/hashes/sha2.js';
import { WorkspaceError, type WorkspaceBinary } from './storage';

export const binarySize = (value: Uint8Array | Blob) => value instanceof Blob ? value.size : value.byteLength;
export const binaryBlob = (value: Uint8Array | Blob): Blob => value instanceof Blob ? value : new Blob([Uint8Array.from(value)]);

/** One processing chunk at a time; chunk size is not a maximum file size. */
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

/** Every write changes the storage revision. Immutable Blob snapshots can be
 * compared inside IDB without awaiting file I/O and letting the transaction idle.
 * Legacy byte records without a revision retain their exact comparison. */
export function sameBinary(current: WorkspaceBinary | undefined, expected: WorkspaceBinary) {
 if (!current || binarySize(current.value) !== binarySize(expected.value)) return false;
 if (current.revision || expected.revision) return !!current.revision && current.revision === expected.revision;
 return current.value instanceof Uint8Array && expected.value instanceof Uint8Array && current.value.every((byte, i) => byte === (expected.value as Uint8Array)[i]);
}
export function checkedBinary(snapshot: WorkspaceBinary | undefined, size: unknown): WorkspaceBinary {
 if (!snapshot || binarySize(snapshot.value) !== size) throw new WorkspaceError('MISSING_LOCAL_FILE', 'Local file bytes are missing or changed');
 return snapshot;
}
