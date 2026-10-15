/** Browser persistence boundary for local content. Account scopes never confer
 * server authority and are never inferred from a record supplied by a caller. */
export type WorkspaceScope = { kind: 'anonymous' } | { kind: 'account'; origin: string; ownerId: string; dataPlane: string };
export const workspaceScopeKey = (scope: WorkspaceScope): string => {
	if (scope.kind === 'anonymous') return JSON.stringify(['anonymous', 1]);
	if (!scope.ownerId || !scope.dataPlane || new URL(scope.origin).origin !== scope.origin) throw new Error('Invalid local workspace scope');
	return JSON.stringify(['account', scope.origin, scope.ownerId, scope.dataPlane]);
};

export const WORKSPACE_LIMITS = { records: 10000, recordBytes: 1024 * 1024, bytes: 64 * 1024 * 1024 } as const;
export class WorkspaceError extends Error {
	readonly ok = false;
	get error() { return this.message; }
	constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'WorkspaceError'; }
}
export type WorkspaceLease = {
	assertCurrent(): void;
	/** A retired editor must not commit even if identity changes during an IDB request. */
	onInvalidate(callback: () => void): () => void;
};
export type WorkspaceRecord<T = unknown> = { scope: string; collection: string; id: string; value: T; bytes: number };
type Usage = { scope: string; records: number; bytes: number };
export type WorkspaceTransaction = {
	get<T>(collection: string, id: string): Promise<T | undefined>;
	list<T>(collection: string): Promise<{ id: string; value: T }[]>;
	put(collection: string, id: string, value: unknown): Promise<void>;
	delete(collection: string, id: string): Promise<void>;
};
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
	req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
const validKey = (value: string) => {
	if (typeof value !== 'string' || !value || value.length > 200) throw new WorkspaceError('INVALID_KEY', 'Invalid local record key');
};

/** One record per Thing/draft/event, with atomic quota accounting across tabs.
 * Callbacks may await IDB requests only, never network or timers. A failure
 * rolls back the complete transaction; it cannot leave half an import behind. */
export class WorkspaceDatabase {
	private opening: Promise<IDBDatabase> | null = null;
	private cancelOpen: (() => void) | null = null;
	constructor(private factory: IDBFactory, private name = 'thingtime.local-workspaces.v1', private openTimeoutMs = 10_000) {}
	private open() {
		if (this.opening) return this.opening;
		const opening = new Promise<IDBDatabase>((resolve, reject) => {
			const req = this.factory.open(this.name, 1);
			let settled = false;
			const finish = () => { settled = true; clearTimeout(timer); this.cancelOpen = null; };
			const fail = (code: string, message: string) => {
				if (settled) return;
				finish();
				// IDB open requests cannot be cancelled. Abort any upgrade and close
				// a late success below so an abandoned request never owns the DB.
				try { req.transaction?.abort(); } catch {}
				reject(new WorkspaceError(code, message, 503));
			};
			const timer = setTimeout(() => fail('LOCAL_STORAGE_TIMEOUT', 'Opening browser storage timed out. Retry saving when site storage is available.'), this.openTimeoutMs);
			this.cancelOpen = () => fail('LOCAL_STORAGE_CLOSED', 'Browser storage was closed before it finished opening. Retry the operation.');
			req.onupgradeneeded = () => {
				if (settled) { try { req.transaction?.abort(); } catch {} return; }
				const records = req.result.createObjectStore('records', { keyPath: ['scope', 'collection', 'id'] });
				records.createIndex('collection', ['scope', 'collection']);
				req.result.createObjectStore('usage', { keyPath: 'scope' });
			};
			req.onerror = () => fail('LOCAL_STORAGE_UNAVAILABLE', 'Browser storage could not be opened. Check site storage permissions and retry.');
			req.onblocked = () => fail('LOCAL_STORAGE_BLOCKED', 'Another Thingtime tab is blocking browser storage. Close that tab and retry.');
			req.onsuccess = () => {
				if (settled) { req.result.close(); return; }
				finish();
				req.result.onversionchange = () => { req.result.close(); if (this.opening === opening) this.opening = null; };
				resolve(req.result);
			};
		}).catch(error => {
			if (this.opening === opening) this.opening = null;
			throw error;
		});
		return this.opening = opening;
	}
	async close() {
		const opening = this.opening; this.opening = null; this.cancelOpen?.();
		try { (await opening)?.close(); } catch { /* Pending opens are cancelled above. */ }
	}
	async transaction<T>(scope: WorkspaceScope, mode: IDBTransactionMode, lease: WorkspaceLease, run: (tx: WorkspaceTransaction) => Promise<T>): Promise<T> {
		lease.assertCurrent();
		const scopeKey = workspaceScopeKey(scope); const db = await this.open(); lease.assertCurrent();
		const native = db.transaction(['records', 'usage'], mode);
		const records = native.objectStore('records'); const usageStore = native.objectStore('usage');
		const done = new Promise<void>((resolve, reject) => {
			native.oncomplete = () => resolve();
			native.onabort = () => reject(native.error || new WorkspaceError('WORKSPACE_CHANGED', 'Local operation was cancelled', 409));
			native.onerror = () => { /* onabort owns the terminal result. */ };
		});
		// Attach immediately, including when validation throws before awaiting done.
		void done.catch(() => {});
		const unsubscribe = lease.onInvalidate(() => { try { native.abort(); } catch {} });
		const check = (collection: string, id?: string) => { lease.assertCurrent(); validKey(collection); if (id !== undefined) validKey(id); };
		const tx: WorkspaceTransaction = {
			get: async <V>(collection: string, id: string) => {
				check(collection, id); const found = await request(records.get([scopeKey, collection, id])) as WorkspaceRecord<V> | undefined;
				lease.assertCurrent(); return found?.value;
			},
			list: async <V>(collection: string) => {
				check(collection); const found = await request(records.index('collection').getAll([scopeKey, collection])) as WorkspaceRecord<V>[];
				lease.assertCurrent(); return found.map(({ id, value }) => ({ id, value }));
			},
			put: async (collection, id, value) => {
				check(collection, id);
				const encoded = JSON.stringify(value);
				if (encoded === undefined) throw new WorkspaceError('INVALID_RECORD', 'Local records must contain JSON');
				const bytes = new TextEncoder().encode(encoded).byteLength;
				if (bytes > WORKSPACE_LIMITS.recordBytes) throw new WorkspaceError('LOCAL_QUOTA', 'This local record exceeds 1 MB', 413);
				const previous = await request(records.get([scopeKey, collection, id])) as WorkspaceRecord | undefined;
				const usage: Usage = await request(usageStore.get(scopeKey)) || { scope: scopeKey, records: 0, bytes: 0 };
				usage.records += previous ? 0 : 1; usage.bytes += bytes - (previous?.bytes || 0);
				if (usage.records > WORKSPACE_LIMITS.records || usage.bytes > WORKSPACE_LIMITS.bytes) throw new WorkspaceError('LOCAL_QUOTA', 'Local workspace is full. Export or remove some content before saving.', 413);
				lease.assertCurrent();
				await request(records.put({ scope: scopeKey, collection, id, value: JSON.parse(encoded), bytes } satisfies WorkspaceRecord));
				await request(usageStore.put(usage));
			},
			delete: async (collection, id) => {
				check(collection, id); const previous = await request(records.get([scopeKey, collection, id])) as WorkspaceRecord | undefined;
				if (!previous) return;
				// Default the row exactly as put() does, and never let damaged accounting
				// go negative: a negative total would silently raise the effective
				// workspace quota instead of reporting a full workspace.
				const usage: Usage = await request(usageStore.get(scopeKey)) || { scope: scopeKey, records: 1, bytes: previous.bytes };
				lease.assertCurrent();
				await request(records.delete([scopeKey, collection, id]));
				await request(usageStore.put({ ...usage, records: Math.max(0, usage.records - 1), bytes: Math.max(0, usage.bytes - previous.bytes) }));
			}
		};
		// Quota is read-modify-write state. Serialize mutations even if a caller
		// batches puts with Promise.all inside one native transaction.
		let writes = Promise.resolve(); const put = tx.put; const remove = tx.delete;
		tx.put = (...args) => writes = writes.then(() => put(...args));
		tx.delete = (...args) => writes = writes.then(() => remove(...args));
		try {
			const result = await run(tx); await writes; lease.assertCurrent(); await done; lease.assertCurrent(); return result;
		} catch (error) {
			try { native.abort(); } catch {}
			await done.catch(() => {});
			throw error;
		} finally { unsubscribe(); }
	}
}
