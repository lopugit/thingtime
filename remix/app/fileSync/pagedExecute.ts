import { executeSyncOperation, SyncObservationChangedError, type SyncExecutionPort } from './execute';
import { withSyncRootLock } from './journal.client';
import { type PagedRunJournal, type PagedRunProgress, type PagedRunSpec } from './pagedRunJournal';
import { ExactCloudSyncDestinationChanged } from './cloudSyncDestination';
import { sameSyncContent, sameSyncScope, sameSyncStamp, type SyncScope } from './reconcile';

/** Resume only already prepared operations. Adapters must supply the same live
 * authorization, exact destination guards and durable receipts as normal sync. */
export async function executePagedSyncRun(value: PagedRunSpec, savedScope: SyncScope, journal: PagedRunJournal,
	port: Omit<SyncExecutionPort, 'persist'>, options: { signal?: AbortSignal; locks?: LockManager; changed?: (p: PagedRunProgress) => void } = {}) {
	return withSyncRootLock(savedScope, () => executePreparedPagedSyncRun(value, savedScope, journal, port, options), options.locks, options.signal);
}

/** The foreground caller already owns the root lock across scans and review. */
export async function executePreparedPagedSyncRun(value: PagedRunSpec, savedScope: SyncScope, journal: PagedRunJournal,
	port: Omit<SyncExecutionPort, 'persist'>, options: { signal?: AbortSignal; changed?: (p: PagedRunProgress) => void; prepare?: (operation: import('./execute').SyncOperation) => Promise<void>; confirmed?: (operation: import('./execute').SyncOperation) => void; omitted?: (operation: import('./execute').SyncOperation) => void } = {}) {
	const spec = structuredClone(value), scope = structuredClone(savedScope);
	const check = () => {
		options.signal?.throwIfAborted();
		if (!sameSyncScope(scope, journal.scope) || !sameSyncScope(scope, port.currentScope())) throw Error('Sync context changed.');
	};
	check(); let state = await journal.start(spec); check();
	while (state.phase !== 'complete') {
		const operation = await journal.claimNext(spec); check();
		if (!operation) throw Error('Sync run has no next operation.');
		await options.prepare?.(operation); check();
		let receipt: Awaited<ReturnType<typeof executeSyncOperation>>;
		try { receipt = await executeSyncOperation(operation, scope, port, options.signal); }
		catch (error) {
			check();
			if (spec.photoAssetOrder && error instanceof SyncObservationChangedError && error.sourceChanged) {
				state = await journal.omitPhotoOperation(spec, operation); check();
				options.omitted?.(operation); options.changed?.(state);
				continue;
			}
			const mutation = operation.mutation;
			if (!spec.backgroundPhotoPublication || !spec.photoAssetOrder || spec.review ||
				mutation.kind !== 'copy' || mutation.from !== 'local' || mutation.expectedTarget !== null ||
				!(error instanceof ExactCloudSyncDestinationChanged || (error instanceof SyncObservationChangedError && error.targetChanged))) throw error;
			// A native refill and this older foreground plan can both prove
			// the same path absent. An existing matching file settles the
			// plan without inventing a receipt for this browser operation.
			const prior = await port.lookup(operation.id, scope); check();
			if (prior.status === 'complete') receipt = prior.receipt;
			else {
				if (prior.status !== 'missing') throw error;
				const local = await port.read('local', mutation.path); check();
				const remote = await port.read('remote', mutation.path); check();
				if (!sameSyncStamp(local, mutation.source) || !remote || remote.path !== mutation.path ||
					!sameSyncContent(remote, mutation.source)) throw error;
				state = await journal.omitPhotoOperation(spec, operation, remote); check();
				options.omitted?.(operation); options.changed?.(state);
				continue;
			}
		}
		check();
		state = await journal.confirm(spec, receipt); check(); options.changed?.(state);
		port.confirmed?.(operation, receipt); options.confirmed?.(operation);
	}
	return state;
}
