import { WorkspaceError, type WorkspaceBinary } from './storage';
import { binarySize } from '../utils/thingTransfer/binary';
export { binarySize, binaryBlob, blobChecksum } from '../utils/thingTransfer/binary';

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
