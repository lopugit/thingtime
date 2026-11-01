import type { JournalAccess } from './journalScope';

export const JOURNAL_RETENTION_STORE = 'sync-managed-metadata';
// Append kinds: existing metadata keys persist these numeric positions.
export const JOURNAL_KINDS = ['run', 'checkpoint', 'plan', 'inventory', 'review'] as const;
export type JournalKind = typeof JOURNAL_KINDS[number];
export type ManagedJournalMetadata = { scope: string; kind: JournalKind; id: string; instance: string; retiring: boolean; store: number };
export const metadataKey = (scope: string, kind: JournalKind, id: string): IDBValidKey => [scope, JOURNAL_KINDS.indexOf(kind), id];

const record = (scope: string, kind: JournalKind, id: string, instance: string | undefined, retiring: boolean): ManagedJournalMetadata => {
	if (!instance) throw Error('Managed sync metadata requires an internal instance.');
	return { scope, kind, id, instance, retiring, store: 0 };
};

/** Foreground-owned metadata can be recaptured after its root lock is released.
 * Other durable journal clients opt in only when they share that lifecycle. */
export function registerJournalMetadata(tx: IDBTransaction, access: JournalAccess, scope: string, kind: JournalKind, id: string, instance: string | undefined) {
	if (access.cleanup === 'foreground') tx.objectStore(JOURNAL_RETENTION_STORE).add(record(scope, kind, id, instance, false), metadataKey(scope, kind, id));
}

export function forgetJournalMetadata(tx: IDBTransaction, scope: string, kind: JournalKind, id: string) {
	tx.objectStore(JOURNAL_RETENTION_STORE).delete(metadataKey(scope, kind, id));
}

/** The caller must atomically prove that no consumer still needs this header.
 * Keeping a retired header until all child rows are gone prevents ID reuse. */
export function retireJournalMetadata(tx: IDBTransaction, scope: string, kind: JournalKind, id: string, headerStore: string, header: { instance?: string }) {
	tx.objectStore(headerStore).put({ ...header, retired: true }, [scope, id]);
	tx.objectStore(JOURNAL_RETENTION_STORE).put(record(scope, kind, id, header.instance, true), metadataKey(scope, kind, id));
}

export function upgradeJournalRetention(db: IDBDatabase) {
	if (!db.objectStoreNames.contains(JOURNAL_RETENTION_STORE)) db.createObjectStore(JOURNAL_RETENTION_STORE);
}
