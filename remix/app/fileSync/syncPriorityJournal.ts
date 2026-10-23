import { journalScope, type JournalAccess } from './journalScope';
import { syncPathKey, validSyncPath } from './reconcile';

export const SYNC_PRIORITY_STORE = 'sync-upload-priorities';
export type SyncPriorityPreferences = { revision: number; paths: string[] };
/** Scheduling hints cannot add operations to an approved plan. */
export function parseSyncPriorityPaths(value: unknown): string[] {
	if (!Array.isArray(value) || value.some(path => !validSyncPath(path)) || new Set(value.map(syncPathKey)).size !== value.length)
		throw Error('Upload priorities require unique relative paths without aliases.');
	return [...value];
}
export function parseSyncPriorityPreferences(value: unknown): SyncPriorityPreferences {
	const saved = value as SyncPriorityPreferences;
	if (!saved || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw Error('Invalid upload priority revision.');
	return { revision: saved.revision, paths: parseSyncPriorityPaths(saved.paths) };
}
export function upgradeSyncPriorityJournal(db: IDBDatabase) {
	if (!db.objectStoreNames.contains(SYNC_PRIORITY_STORE)) db.createObjectStore(SYNC_PRIORITY_STORE);
}
export function syncPriorityJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const { key, check, transaction } = journalScope(db, access, keyRange);
	const load = (value: unknown) => value === undefined ? { revision: 0, paths: [] } : parseSyncPriorityPreferences(value);
	return {
		read: async () => transaction<SyncPriorityPreferences>([SYNC_PRIORITY_STORE], 'readonly', (tx, done, fail) => {
			const get = tx.objectStore(SYNC_PRIORITY_STORE).get(key);
			get.onsuccess = () => { try { check(); done(load(get.result)); } catch (error) { fail(error); } };
		}),
		save: async (value: string[], expectedRevision: number) => {
			const paths = parseSyncPriorityPaths(value);
			if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER)
				throw Error('Invalid upload priority revision.');
			return transaction<SyncPriorityPreferences>([SYNC_PRIORITY_STORE], 'readwrite', (tx, done, fail) => {
				const store = tx.objectStore(SYNC_PRIORITY_STORE), get = store.get(key);
				get.onsuccess = () => { try {
					check(); if (load(get.result).revision !== expectedRevision) throw Error('Upload priorities changed; reload before saving.');
					const saved = { revision: expectedRevision + 1, paths }; store.put(saved, key); done(saved);
				} catch (error) { fail(error); } };
			});
		}
	};
}
