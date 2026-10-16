import type { FingerprintSource } from './contentFingerprint';
import type { SyncOperation, SyncReceipt, SyncReceiptLookup } from './execute';
import { sameSyncContent, sameSyncScope, validSyncEntry, type SyncEntry, type SyncScope } from './reconcile';

/** Native implementation owns private staging, durable deduplication by the
 * complete immutable operation, root-scoped write approval, verified bytes and
 * atomic publication with the expected destination stamp. Retain displaced
 * versions recoverably. A stage operation must never modify a user destination.
 * The existing SyncReceipt is persisted alongside native publication recovery;
 * it is not another file history. Lost replies reuse exactly the same operation.
 */
export type LocalStagedCopy = { operationId: string; scope: SyncScope; token: string; entry: SyncEntry };
export type LocalSyncTarget = {
	lookup(operation: SyncOperation, scope: SyncScope): Promise<SyncReceiptLookup>;
	stage(operation: SyncOperation, scope: SyncScope, source?: FingerprintSource): Promise<LocalStagedCopy>;
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
