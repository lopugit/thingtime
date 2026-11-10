import {
	createDeviceSyncHistoryAggregation, deviceSyncHistoryScopeKey, parseDeviceSyncHistoryRange, parseDeviceSyncHistorySample,
	type DeviceSyncHistory, type DeviceSyncHistoryRange, type DeviceSyncHistorySample, type DeviceSyncHistoryScope
} from './deviceSyncHistory';

const STORE = 'device-sync-history';
const READ_BATCH = 256;
export function upgradeDeviceSyncHistoryJournal(db: IDBDatabase) {
	if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
}

type Access = { scope: DeviceSyncHistoryScope; assertCurrent(): void; signal?: AbortSignal };

/** One row per observed sample. The ordered compound key isolates devices
 * before each batch opens; the fold retains only the requested display buckets. */
export function deviceSyncHistoryJournal(db: IDBDatabase, access: Access, keyRange?: typeof IDBKeyRange) {
	const key = deviceSyncHistoryScopeKey(access.scope);
	const check = () => {
		access.signal?.throwIfAborted();
		access.assertCurrent();
		access.signal?.throwIfAborted();
		if (deviceSyncHistoryScopeKey(access.scope) !== key) throw Error('The sync history scope changed.');
	};
	return {
		async append(value: DeviceSyncHistorySample): Promise<void> {
			check();
			const sample = parseDeviceSyncHistorySample(structuredClone(value));
			return new Promise((resolve, reject) => {
				const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
				const request = tx.objectStore(STORE).add(sample, [key, sample.at, sample.status === 'running' ? 0 : 1, crypto.randomUUID()]);
				request.onsuccess = () => { try { check(); } catch (error) { reject(error); tx.abort(); } };
				tx.oncomplete = () => { try { check(); resolve(); } catch (error) { reject(error); } };
				tx.onabort = tx.onerror = () => reject(tx.error ?? Error('Could not save sync history.'));
			});
		},
		async read(value: DeviceSyncHistoryRange): Promise<DeviceSyncHistory> {
			check();
			const range = parseDeviceSyncHistoryRange(value);
			const aggregation = createDeviceSyncHistoryAggregation(range);
			const bounds = keyRange ?? IDBKeyRange;
			const readBatch = (after?: IDBValidKey): Promise<{ rows: DeviceSyncHistorySample[]; next?: IDBValidKey }> => new Promise((resolve, reject) => {
				check();
				const tx = db.transaction(STORE, 'readonly'), store = tx.objectStore(STORE);
				const page = bounds.bound(after ?? [key, range.from], [key, range.to], after !== undefined, true);
				const values = store.getAll(page, READ_BATCH), keys = store.getAllKeys(page, READ_BATCH);
				const abort = () => tx.abort();
				const cleanup = () => access.signal?.removeEventListener('abort', abort);
				access.signal?.addEventListener('abort', abort, { once: true });
				tx.oncomplete = () => {
					cleanup();
					try {
						check();
						resolve({ rows: values.result, next: keys.result.length === READ_BATCH ? keys.result.at(-1) : undefined });
					} catch (error) { reject(error); }
				};
				tx.onabort = tx.onerror = () => { cleanup(); reject(access.signal?.reason ?? tx.error ?? Error('Could not read sync history.')); };
			});
			// Short transactions let admitted writes proceed between range pages.
			// The fixed upper timestamp and ordered cursor prevent duplicate rows.
			let after: IDBValidKey | undefined;
			do {
				const { rows, next } = await readBatch(after);
				check();
				for (const row of rows) aggregation.add(row);
				after = next;
			} while (after !== undefined);
			return aggregation.result();
		}
	};
}
