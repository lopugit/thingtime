import { sameSyncScope, syncScopeKey, validateSyncScope, type SyncScope } from './reconcile';

export type JournalAccess = { scope: SyncScope; currentScope(): SyncScope; signal?: AbortSignal };

/** Fence each asynchronous page and transaction to the original connection. */
export function journalScope(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const scope = structuredClone(access.scope);
	validateSyncScope(scope);
	const key = syncScopeKey(scope);
	const check = () => {
		access.signal?.throwIfAborted();
		if (!sameSyncScope(scope, access.scope) || !sameSyncScope(scope, access.currentScope())) throw Error('Sync journal account or root changed.');
	};
	const range = (id: string, after?: string) => (keyRange ?? globalThis.IDBKeyRange).bound(
		after === undefined ? [key, id] : [key, id, after], [key, id, []], after !== undefined, false
	);
	const transaction = <T>(stores: readonly string[], mode: IDBTransactionMode,
		work: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> => {
		check();
		return new Promise((resolve, reject) => {
			const tx = db.transaction([...stores], mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
			let result: T, failure: unknown;
			const fail = (error: unknown) => { failure = error; tx.abort(); };
			tx.oncomplete = () => { try { check(); resolve(result); } catch (error) { reject(error); } };
			tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? Error('Sync journal transaction failed.'));
			try { work(tx, value => { result = value; }, fail); } catch (error) { fail(error); }
		});
	};
	return { scope, key, check, range, transaction };
}
