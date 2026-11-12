import type { LocalTrashContext } from './localTrash';
import type { FingerprintSource } from './contentFingerprint';
import type { SyncOperation, SyncReceipt, SyncReceiptLookup } from './execute';
import { sameSyncContent, sameSyncScope, validSyncEntry, type SyncEntry, type SyncScope } from './reconcile';

/** Native implementation owns private staging, durable deduplication by the
 * complete immutable operation, root-scoped write approval, verified bytes and
 * coordinated atomic publication after checking the expected destination stamp.
 * A racing uncoordinated native writer must retain the displaced inode and
 * leave the operation pending for conflict review, never claim strict filesystem
 * compare-and-swap or blindly roll it back. Retain displaced
 * versions recoverably. A stage operation must never modify a user destination.
 * The existing SyncReceipt is persisted alongside native publication recovery;
 * it is not another file history. Lost replies reuse exactly the same operation.
 */
export type LocalStagedCopy = { operationId: string; scope: SyncScope; token: string; entry: SyncEntry };
export type LocalSyncTarget = {
	/** Optional telemetry contract; old adapters report an unavailable byte rate. */
	reportsTransferBytes?: true;
	/** Present only after native deletion consent; never an unlink fallback. */
	trash?(operation: SyncOperation, scope: SyncScope, context?: LocalTrashContext): Promise<SyncReceipt>;
	trashExpected?(operation: SyncOperation, scope: SyncScope, context?: LocalTrashContext): Promise<SyncEntry>;
	lookup(operation: SyncOperation, scope: SyncScope, context?: LocalTrashContext): Promise<SyncReceiptLookup>;
	stage(operation: SyncOperation, scope: SyncScope, source?: FingerprintSource, transferred?: (bytes: number, received: number) => void): Promise<LocalStagedCopy>;
	publish(operation: SyncOperation, scope: SyncScope, stage: LocalStagedCopy): Promise<SyncReceipt>;
};
export function validateLocalStage(stage: LocalStagedCopy, operation: SyncOperation, scope: SyncScope): void {
	const m = operation.mutation;
	if (
		m.kind !== 'copy' ||
		m.from !== 'remote' ||
		!stage ||
		stage.operationId !== operation.id ||
		!sameSyncScope(stage.scope, scope) ||
		typeof stage.token !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(stage.token) ||
		!validSyncEntry(stage.entry) ||
		stage.entry.path !== m.path ||
		!sameSyncContent(stage.entry, m.source)
	)
		throw Error('Native stage does not confirm the planned download.');
}
