import { executeSyncOperation, type SyncExecutionPort } from './execute';
import { withSyncRootLock } from './journal.client';
import { type PagedRunJournal, type PagedRunProgress, type PagedRunSpec } from './pagedRunJournal';
import { sameSyncScope, type SyncScope } from './reconcile';

/** Resume only already prepared operations. Adapters must supply the same live
 * authorization, exact destination guards and durable receipts as normal sync. */
export async function executePagedSyncRun(value: PagedRunSpec, savedScope: SyncScope, journal: PagedRunJournal,
	port: Omit<SyncExecutionPort, 'persist'>, options: { signal?: AbortSignal; locks?: LockManager; changed?: (p: PagedRunProgress) => void } = {}) {
	const spec = structuredClone(value), scope = structuredClone(savedScope);
	const check = () => {
		options.signal?.throwIfAborted();
		if (!sameSyncScope(scope, journal.scope) || !sameSyncScope(scope, port.currentScope())) throw Error('Sync context changed.');
	};
	return withSyncRootLock(scope, async () => {
		check(); let state = await journal.start(spec); check();
		while (state.phase !== 'complete') {
			const page = await journal.read(spec); check();
			if (!page.operations.length) throw Error('Sync run has no next operation.');
			for (const operation of page.operations) {
				check(); const receipt = await executeSyncOperation(operation, scope, port, options.signal); check();
				state = await journal.confirm(spec, receipt); check(); options.changed?.(state);
			}
		}
		return state;
	}, options.locks, options.signal);
}
