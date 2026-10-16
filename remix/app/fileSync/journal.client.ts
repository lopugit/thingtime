import { validateSyncCheckpoint, type SyncCheckpoint } from './checkpoint';
import { validateSyncRun, type SyncRun } from './execute';
import { validateSyncScope, type SyncScope } from './reconcile';

export const syncScopeKey = (scope: SyncScope): string => {
	validateSyncScope(scope);
	return JSON.stringify([scope.origin, scope.ownerId, scope.dataPlane, scope.rootId, scope.deviceId]);
};

/** Durable operation state, not file bytes or version history. Canonical file
 * history remains in Timeline. IDB errors are fatal before any new mutation. */
export const openSyncJournal = async (factory: IDBFactory = indexedDB, name = 'thingtime-file-sync-v1') => {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = factory.open(name, 2);
		request.onupgradeneeded = () => {
			for (const store of ['runs', 'checkpoints']) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
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
			const tx = db.transaction('runs', 'readwrite', { durability: 'strict' });
			const store = tx.objectStore('runs'),
				request = store.get(key);
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
			const tx = db.transaction('checkpoints', 'readonly'),
				request = tx.objectStore('checkpoints').get(syncScopeKey(scope));
			let value: SyncCheckpoint | null = null;
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
			const tx = db.transaction(['runs', 'checkpoints'], 'readwrite', { durability: 'strict' }),
				key = syncScopeKey(scope),
				request = tx.objectStore('runs').get(key);
			request.onsuccess = () => {
				try {
					const run = request.result;
					validateSyncRun(run);
					if (syncScopeKey(run.scope) !== key || run.id !== saved.runId || run.operations.some((op: any) => !op.confirmed))
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
	return { read, persist, checkpoint, complete, close: () => db.close() };
};

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
