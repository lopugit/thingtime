import { upgradeJournalRetention } from './journalRetention';
import { journalMaintenance } from './journalMaintenance';
import { PAGED_CHECKPOINT_HEADS, validateSyncCheckpoint, type SyncCheckpoint } from './checkpoint';
import { validateSyncRun, type SyncRun } from './execute';
import { syncScopeKey, type SyncScope } from './reconcile';
import { inventoryJournal, upgradeInventoryJournal } from './inventoryJournal';
import { pagedCheckpointJournal, upgradePagedCheckpointJournal } from './pagedCheckpointJournal';
import { pagedPlanJournal, upgradePagedPlanJournal } from './pagedPlanJournal';

import { PAGED_RUN_HEADS, pagedRunJournal, upgradePagedRunJournal } from './pagedRunJournal';

export { syncScopeKey } from './reconcile';

/** Durable operation state, not file bytes or version history. Canonical file
 * history remains in Timeline. IDB errors are fatal before any new mutation. */
export const openSyncJournal = async (factory: IDBFactory = indexedDB, name = 'thingtime-file-sync-v1', keyRange?: typeof IDBKeyRange) => {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = factory.open(name, 9);
		request.onupgradeneeded = () => {
			for (const store of ['runs', 'checkpoints']) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
			upgradeJournalRetention(request.result);
			upgradeInventoryJournal(request.result);
			upgradePagedPlanJournal(request.result);
			upgradePagedRunJournal(request.result);
			upgradePagedCheckpointJournal(request.result);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	db.onversionchange = () => db.close();
	const read = (scope: SyncScope): Promise<SyncRun | null> =>
		new Promise((resolve, reject) => {
			const key = syncScopeKey(scope),
				tx = db.transaction('runs', 'readonly');
			const request = tx.objectStore('runs').get(key);
			let result: SyncRun | null = null;
			request.onsuccess = () => {
				try {
					if (request.result !== undefined) {
						validateSyncRun(request.result);
						if (syncScopeKey(request.result.scope) !== key) throw new Error('Sync journal scope mismatch.');
						result = request.result;
					}
				} catch (error) {
					reject(error);
					tx.abort();
				}
			};
			tx.oncomplete = () => resolve(result);
			tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Could not read the sync journal.'));
		});
	const persist = async (value: SyncRun): Promise<void> => {
		const run = structuredClone(value);
		validateSyncRun(run);
		const key = syncScopeKey(run.scope);
		return new Promise((resolve, reject) => {
			const tx = db.transaction(['runs', PAGED_RUN_HEADS, PAGED_CHECKPOINT_HEADS], 'readwrite', { durability: 'strict' });
			const store = tx.objectStore('runs'),
				request = store.get(key);
			refusePagedRun(tx, key, reject);
			request.onsuccess = () => {
				try {
					const existing: SyncRun | undefined = request.result;
					if (existing) {
						validateSyncRun(existing);
						if (existing.id === run.id) {
							const immutable = (row: SyncRun) => JSON.stringify({ ...row, operations: row.operations.map((op) => ({ ...op, confirmed: false })) });
							if (immutable(existing) !== immutable(run) || existing.operations.some((op, i) => op.confirmed && !run.operations[i]?.confirmed))
								throw new Error('Sync run identity or confirmed progress cannot change.');
						} else if (existing.operations.some((op) => !op.confirmed)) throw new Error('Resume the unfinished sync run before planning another.');
					}
					store.put(run, key);
				} catch (error) {
					reject(error);
					tx.abort();
				}
			};
			tx.oncomplete = () => resolve();
			tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Could not save the sync journal.'));
		});
	};

	const checkpoint = (scope: SyncScope): Promise<SyncCheckpoint | null> =>
		new Promise((resolve, reject) => {
			const tx = db.transaction(['checkpoints', PAGED_CHECKPOINT_HEADS], 'readonly'),
				request = tx.objectStore('checkpoints').get(syncScopeKey(scope));
			let value: SyncCheckpoint | null = null;
			const paged = tx.objectStore(PAGED_CHECKPOINT_HEADS).get(syncScopeKey(scope));
			paged.onsuccess = () => { if (paged.result !== undefined) { reject(Error('Read the current paged sync checkpoint.')); tx.abort(); } };
			request.onsuccess = () => {
				try {
					if (request.result !== undefined) {
						validateSyncCheckpoint(request.result, scope);
						value = request.result;
					}
				} catch (error) {
					reject(error);
					tx.abort();
				}
			};
			tx.oncomplete = () => resolve(value);
			tx.onabort = tx.onerror = () => reject(tx.error ?? Error('Could not read sync completion.'));
		});
	const complete = async (value: SyncCheckpoint): Promise<void> => {
		const saved = structuredClone(value),
			scope = saved.baseline.scope;
		validateSyncCheckpoint(saved, scope);
		return new Promise((resolve, reject) => {
			const tx = db.transaction(['runs', 'checkpoints', PAGED_RUN_HEADS, PAGED_CHECKPOINT_HEADS], 'readwrite', { durability: 'strict' }),
				key = syncScopeKey(scope),
				request = tx.objectStore('runs').get(key);
			refusePagedRun(tx, key, reject);
			request.onsuccess = () => {
				try {
					const run = request.result;
					validateSyncRun(run);
					if (run.version !== 1 || syncScopeKey(run.scope) !== key || run.id !== saved.runId || run.operations.some((op: any) => !op.confirmed))
						throw Error('Only the current fully confirmed run may advance its baseline.');
					tx.objectStore('checkpoints').put(saved, key);
				} catch (error) {
					reject(error);
					tx.abort();
				}
			};
			tx.oncomplete = () => resolve();
			tx.onabort = tx.onerror = () => reject(tx.error ?? Error('Could not save sync completion.'));
		});
	};
	return { read, persist, checkpoint, complete, maintenance: (access: Parameters<typeof journalMaintenance>[1]) => journalMaintenance(db, access, keyRange), pagedCheckpoints: (access: Parameters<typeof pagedCheckpointJournal>[1]) => pagedCheckpointJournal(db, access, keyRange), pagedRuns: (access: Parameters<typeof pagedRunJournal>[1]) => pagedRunJournal(db, access, keyRange), plans: (access: Parameters<typeof pagedPlanJournal>[1]) => pagedPlanJournal(db, access, keyRange), inventory: (access: Parameters<typeof inventoryJournal>[1]) => inventoryJournal(db, access, keyRange), close: () => db.close() };
};

function refusePagedRun(tx: IDBTransaction, key: string, reject: (error: Error) => void) {
	for (const store of [PAGED_RUN_HEADS, PAGED_CHECKPOINT_HEADS]) {
		const head = tx.objectStore(store).get(key);
		head.onsuccess = () => { if (head.result !== undefined) {
			reject(Error('Resume the paged sync journal before changing the legacy journal.')); tx.abort();
		} };
	}
}

/** Web clients serialize an entire scan/plan/resume cycle across tabs. Native
 * workers implement the same exclusivity with their platform store/lock. */
export const withSyncRootLock = async <T>(
	scope: SyncScope,
	run: () => Promise<T>,
	locks: LockManager = navigator.locks,
	signal?: AbortSignal
): Promise<T> => {
	if (!locks) throw new Error('This browser cannot safely coordinate background file sync.');
	return await locks.request('thingtime-file-sync:' + syncScopeKey(scope), { mode: 'exclusive', ...(signal ? { signal } : {}) }, run);
};
