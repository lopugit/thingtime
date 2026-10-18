import { TIMELINE_EVENT_MAX_BYTES } from '../timeline/contract';
/** Browser persistence boundary for local content. Account scopes never confer
 * server authority and are never inferred from a record supplied by a caller. */
export type WorkspaceScope = { kind: 'anonymous' } | { kind: 'account'; origin: string; ownerId: string; dataPlane: string; delegatedBy?: string };
export const workspaceScopeKey = (scope: WorkspaceScope): string => {
	if (scope.kind === 'anonymous') return JSON.stringify(['anonymous', 1]);
	if (!scope.ownerId || !scope.dataPlane || new URL(scope.origin).origin !== scope.origin) throw new Error('Invalid local workspace scope');
	// A delegated editor belongs to both the signed-in principal and its actor.
	// It must never open the actor's independently signed-in account partition.
	if (scope.delegatedBy !== undefined) {
		if (!scope.delegatedBy || scope.delegatedBy === scope.ownerId) throw new Error('Invalid delegated workspace scope');
		return JSON.stringify(['delegated-account', scope.origin, scope.delegatedBy, scope.ownerId, scope.dataPlane]);
	}
	return JSON.stringify(['account', scope.origin, scope.ownerId, scope.dataPlane]);
};

// Buffered file adapters still use these processing bounds until their stream
// migration is complete. IndexedDB admission itself uses the browser's quota.
export const LEGACY_FILE_BUFFER_LIMITS = { binaryBytes: 16 * 1024 * 1024, bytes: 64 * 1024 * 1024 } as const;
export class WorkspaceError extends Error {
	readonly ok = false;
	get error() {
		return this.message;
	}
	constructor(
		public code: string,
		message: string,
		public status = 400
	) {
		super(message);
		this.name = 'WorkspaceError';
	}
}
export type WorkspaceLease = {
	assertCurrent(): void;
	/** A retired editor must not commit even if identity changes during an IDB request. */
	onInvalidate(callback: () => void): () => void;
};
export type WorkspaceRecord<T = unknown> = { scope: string; collection: string; id: string; value: T; bytes: number; binaryRevision?: string };
export type WorkspaceUsage = { records: number; bytes: number };
type Usage = WorkspaceUsage & { scope: string };
const BINARY_COLLECTION = '@bytes';
export type WorkspaceBinary = { value: Uint8Array | Blob; revision?: string };
export type WorkspaceTransaction = {
	usage(): Promise<WorkspaceUsage>;
	getBytes(id: string): Promise<Uint8Array | undefined>;
	getBinary(id: string): Promise<WorkspaceBinary | undefined>;
	putBlob(id: string, value: Blob): Promise<void>;
	putBytes(id: string, bytes: Uint8Array): Promise<void>;
	deleteBytes(id: string): Promise<void>;
	get<T>(collection: string, id: string): Promise<T | undefined>;
	list<T>(collection: string): Promise<{ id: string; value: T }[]>;
	put(collection: string, id: string, value: unknown): Promise<void>;
	delete(collection: string, id: string): Promise<void>;
};
const request = <T>(req: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
const validKey = (value: string) => {
	if (typeof value !== 'string' || !value || value.length > 256) throw new WorkspaceError('INVALID_KEY', 'Invalid local record key');
};

/** One record per Thing/draft/event, with atomic quota accounting across tabs.
 * Callbacks may await IDB requests only, never network or timers. A failure
 * rolls back the complete transaction; it cannot leave half an import behind. */
export class WorkspaceDatabase {
	private opening: Promise<IDBDatabase> | null = null;
	private cancelOpen: (() => void) | null = null;
	constructor(
		private factory: IDBFactory,
		private name = 'thingtime.local-workspaces.v1',
		private openTimeoutMs = 10_000,
		private keyRanges: Pick<typeof IDBKeyRange, 'bound'> = globalThis.IDBKeyRange
	) {}
	private open() {
		if (this.opening) return this.opening;
		const opening = new Promise<IDBDatabase>((resolve, reject) => {
			const req = this.factory.open(this.name, 1);
			let settled = false;
			const finish = () => {
				settled = true;
				clearTimeout(timer);
				this.cancelOpen = null;
			};
			const fail = (code: string, message: string) => {
				if (settled) return;
				finish();
				// IDB open requests cannot be cancelled. Abort any upgrade and close
				// a late success below so an abandoned request never owns the DB.
				try {
					req.transaction?.abort();
				} catch {}
				reject(new WorkspaceError(code, message, 503));
			};
			const timer = setTimeout(
				() => fail('LOCAL_STORAGE_TIMEOUT', 'Opening browser storage timed out. Retry saving when site storage is available.'),
				this.openTimeoutMs
			);
			this.cancelOpen = () => fail('LOCAL_STORAGE_CLOSED', 'Browser storage was closed before it finished opening. Retry the operation.');
			req.onupgradeneeded = () => {
				if (settled) {
					try {
						req.transaction?.abort();
					} catch {}
					return;
				}
				const records = req.result.createObjectStore('records', { keyPath: ['scope', 'collection', 'id'] });
				records.createIndex('collection', ['scope', 'collection']);
				req.result.createObjectStore('usage', { keyPath: 'scope' });
			};
			req.onerror = () => fail('LOCAL_STORAGE_UNAVAILABLE', 'Browser storage could not be opened. Check site storage permissions and retry.');
			req.onblocked = () => fail('LOCAL_STORAGE_BLOCKED', 'Another Thingtime tab is blocking browser storage. Close that tab and retry.');
			req.onsuccess = () => {
				if (settled) {
					req.result.close();
					return;
				}
				finish();
				req.result.onversionchange = () => {
					req.result.close();
					if (this.opening === opening) this.opening = null;
				};
				resolve(req.result);
			};
		}).catch((error) => {
			if (this.opening === opening) this.opening = null;
			throw error;
		});
		return (this.opening = opening);
	}
	async close() {
		const opening = this.opening;
		this.opening = null;
		this.cancelOpen?.();
		try {
			(await opening)?.close();
		} catch {
			/* Pending opens are cancelled above. */
		}
	}
	transaction<T>(scope: WorkspaceScope, mode: IDBTransactionMode, lease: WorkspaceLease, run: (tx: WorkspaceTransaction) => Promise<T>): Promise<T> {
		return this.scopedTransaction([scope], mode, lease, (views) => run(views[0]));
	}
	/** The account's selected-plane meter includes its delegated editors. Discover
	 * keys and validate every ledger in one snapshot, without reading file bytes
	 * or exposing Character content to the settings panel. */
	accountUsage(scope: Extract<WorkspaceScope, { kind: 'account' }>, lease: WorkspaceLease): Promise<WorkspaceUsage> {
		if (scope.kind !== 'account' || scope.delegatedBy !== undefined)
			return Promise.reject(new WorkspaceError('ACCOUNT_REQUIRED', 'Choose the signed-in account to measure its device storage.', 403));
		const rootKey = workspaceScopeKey(scope);
		const prefix = JSON.stringify(['delegated-account', scope.origin, scope.ownerId]).slice(0, -1) + ',';
		return this.scopedTransaction(async (native) => {
			const keys = new Set([rootKey]);
			const collect = (store: IDBObjectStore, compound: boolean) => new Promise<void>((resolve, reject) => {
				const range = compound ? this.keyRanges.bound([prefix], [prefix + '\uffff']) : this.keyRanges.bound(prefix, prefix + '\uffff');
				const cursor = store.openKeyCursor(range);
				cursor.onerror = () => reject(cursor.error);
				cursor.onsuccess = () => {
					try {
						lease.assertCurrent();
						const row = cursor.result;
						if (!row) return resolve();
						const key = compound ? (row.key as IDBValidKey[])[0] : row.key;
						if (typeof key !== 'string') throw new WorkspaceError('INVALID_WORKSPACE', 'Invalid retained workspace key', 409);
						const parts = JSON.parse(key), actor = { ...scope, delegatedBy: scope.ownerId, ownerId: parts?.[3], dataPlane: parts?.[4] };
						if (!Array.isArray(parts) || parts.length !== 5 || typeof actor.ownerId !== 'string' || typeof actor.dataPlane !== 'string' || workspaceScopeKey(actor) !== key)
							throw new WorkspaceError('INVALID_WORKSPACE', 'Invalid retained workspace key', 409);
						if (actor.dataPlane === scope.dataPlane) keys.add(key);
						// A key cursor skips the remaining records of this partition. It
						// neither clones Blobs nor imposes a limit on retained Characters.
						if (compound) row.continue([key, []]); else row.continue();
					} catch (error) { reject(error); }
				};
			});
			// Both indexes matter: a missing ledger with records, or an orphaned
			// nonzero ledger, must report an error rather than an incomplete total.
			await collect(native.objectStore('records'), true);
			await collect(native.objectStore('usage'), false);
			return [...keys];
		}, 'readonly', lease, async (views) => {
			const total = { bytes: 0, records: 0 };
			for (const view of views) {
				const usage = await view.usage(); total.bytes += usage.bytes; total.records += usage.records;
				if (!Number.isSafeInteger(total.bytes) || !Number.isSafeInteger(total.records))
					throw new WorkspaceError('LOCAL_ACCOUNTING_UNAVAILABLE', 'Device storage usage is unavailable. Your saved content has not been changed.', 503);
			}
			return total;
		});
	}
	/** Discover only this account/origin's existing local partitions. Keys alone
	 * are read; no other account content or remote configuration is exposed. */
	async accountScopes(
		scope: Extract<WorkspaceScope, { kind: 'account' }>,
		lease: WorkspaceLease
	): Promise<Extract<WorkspaceScope, { kind: 'account' }>[]> {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous workspaces cannot enumerate account storage', 403);
		workspaceScopeKey(scope);
		lease.assertCurrent();
		const db = await this.open();
		lease.assertCurrent();
		const native = db.transaction(['usage'], 'readonly');
		const done = new Promise<void>((resolve, reject) => {
			native.oncomplete = () => resolve();
			native.onabort = () => reject(native.error || new WorkspaceError('WORKSPACE_CHANGED', 'Local operation was cancelled', 409));
			native.onerror = () => {};
		});
		void done.catch(() => {});
		const unsubscribe = lease.onInvalidate(() => {
			try {
				native.abort();
			} catch {}
		});
		try {
			const identity = scope.delegatedBy === undefined ? ['account', scope.origin, scope.ownerId] : ['delegated-account', scope.origin, scope.delegatedBy, scope.ownerId];
			const prefix = JSON.stringify(identity).slice(0, -1) + ',';
			const scopes: Extract<WorkspaceScope, { kind: 'account' }>[] = [];
			// Walk keys incrementally, checking identity between cursor events. A
			// processing batch must not become a maximum retained workspace count.
			await new Promise<void>((resolve, reject) => {
				const cursor = native.objectStore('usage').openKeyCursor(this.keyRanges.bound(prefix, prefix + '\uffff'));
				cursor.onerror = () => reject(cursor.error);
				cursor.onsuccess = () => {
					try {
						lease.assertCurrent();
						if (!cursor.result) return resolve();
						const key = cursor.result.key;
						if (typeof key !== 'string') throw new WorkspaceError('INVALID_WORKSPACE', 'Invalid retained workspace key', 409);
						const parts = JSON.parse(key);
						const value = { ...scope, dataPlane: parts?.[identity.length] };
						if (!Array.isArray(parts) || parts.length !== identity.length + 1 || typeof value.dataPlane !== 'string' || workspaceScopeKey(value) !== key)
							throw new WorkspaceError('INVALID_WORKSPACE', 'Invalid retained workspace key', 409);
						scopes.push(value);
						cursor.result.continue();
					} catch (error) {
						reject(error);
					}
				};
			});
			lease.assertCurrent();
			await done;
			lease.assertCurrent();
			return scopes;
		} catch (error) {
			try {
				native.abort();
			} catch {}
			await done.catch(() => {});
			throw workspaceStorageError(error);
		} finally {
			unsubscribe();
		}
	}
	/** Home-pinned content and selected-plane content can share one atomic local
	 * operation. The caller supplies its current selected-account lease; neither
	 * view grants remote authority or opens another account/origin partition. */
	accountHomeTransaction<T>(
		scope: Extract<WorkspaceScope, { kind: 'account' }>,
		mode: IDBTransactionMode,
		lease: WorkspaceLease,
		run: (views: { selected: WorkspaceTransaction; home: WorkspaceTransaction }) => Promise<T>
	): Promise<T> {
		if (scope.kind !== 'account')
			return Promise.reject(new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous workspaces cannot access account home storage', 403));
		return this.scopedTransaction([scope, { ...scope, dataPlane: 'home' }], mode, lease, (views) => run({ selected: views[0], home: views[1] }));
	}
	private async scopedTransaction<T>(
		scopes: WorkspaceScope[] | ((native: IDBTransaction) => Promise<string[]>),
		mode: IDBTransactionMode,
		lease: WorkspaceLease,
		run: (views: WorkspaceTransaction[]) => Promise<T>
	): Promise<T> {
		lease.assertCurrent();
		const scopeKeys = Array.isArray(scopes) ? scopes.map(workspaceScopeKey) : null;
		const db = await this.open();
		lease.assertCurrent();
		const native = db.transaction(['records', 'usage'], mode);
		const records = native.objectStore('records');
		const usageStore = native.objectStore('usage');
		const done = new Promise<void>((resolve, reject) => {
			native.oncomplete = () => resolve();
			native.onabort = () => reject(native.error || new WorkspaceError('WORKSPACE_CHANGED', 'Local operation was cancelled', 409));
			native.onerror = () => {
				/* onabort owns the terminal result. */
			};
		});
		// Attach immediately, including when validation throws before awaiting done.
		void done.catch(() => {});
		const unsubscribe = lease.onInvalidate(() => {
			try {
				native.abort();
			} catch {}
		});
		let writes = Promise.resolve();
		const makeView = (scopeKey: string): WorkspaceTransaction => {
			const check = (collection: string, id?: string, binary = false) => {
				lease.assertCurrent();
				validKey(collection);
				if (collection === BINARY_COLLECTION && !binary)
					throw new WorkspaceError('BINARY_OPERATION_REQUIRED', 'File bytes require the binary storage operation');
				if (id !== undefined) validKey(id);
			};
			const persist = async (collection: string, id: string, value: unknown, bytes: number, binaryRevision?: string) => {
				const previous = (await request(records.get([scopeKey, collection, id]))) as WorkspaceRecord | undefined;
				const usage: Usage = (await request(usageStore.get(scopeKey))) || { scope: scopeKey, records: 0, bytes: 0 };
				usage.records += previous ? 0 : 1;
				usage.bytes += bytes - (previous?.bytes || 0);
				if (!Number.isSafeInteger(usage.records) || !Number.isSafeInteger(usage.bytes) || usage.records < 0 || usage.bytes < 0)
					throw new WorkspaceError('LOCAL_ACCOUNTING_UNAVAILABLE', 'Device storage usage could not be updated safely. Saved content is unchanged.', 503);
				lease.assertCurrent();
				await request(records.put({ scope: scopeKey, collection, id, value, bytes, ...(binaryRevision ? { binaryRevision } : {}) } satisfies WorkspaceRecord));
				await request(usageStore.put(usage));
			};
			const removeRecord = async (collection: string, id: string, binary = false) => {
				check(collection, id, binary);
				const previous = (await request(records.get([scopeKey, collection, id]))) as WorkspaceRecord | undefined;
				if (!previous) return;
				// Damaged accounting must not throw during cleanup or become negative.
				const usage: Usage = (await request(usageStore.get(scopeKey))) || { scope: scopeKey, records: 1, bytes: previous.bytes };
				lease.assertCurrent();
				await request(records.delete([scopeKey, collection, id]));
				await request(usageStore.put({ ...usage, records: Math.max(0, usage.records - 1), bytes: Math.max(0, usage.bytes - previous.bytes) }));
			};

			const tx: WorkspaceTransaction = {
				usage: async () => {
					lease.assertCurrent();
					// Count keys only in this exact partition; never load other accounts or
					// clone file bytes just to display a storage meter. Arrays sort after
					// strings, so the upper key contains every collection/id in this scope.
					const count = await request(records.count(this.keyRanges.bound([scopeKey], [scopeKey, []])));
					const usage = (await request(usageStore.get(scopeKey))) as Usage | undefined;
					lease.assertCurrent();
					if (!usage && count === 0) return { records: 0, bytes: 0 };
					if (
						!usage ||
						usage.scope !== scopeKey ||
						usage.records !== count ||
						!Number.isSafeInteger(usage.records) ||
						usage.records < 0 ||
						!Number.isSafeInteger(usage.bytes) ||
						usage.bytes < 0 ||
						(count === 0 && usage.bytes !== 0)
					) {
						throw new WorkspaceError(
							'LOCAL_ACCOUNTING_UNAVAILABLE',
							'Device storage usage is unavailable. Your saved content has not been changed.',
							503
						);
					}
					return { records: usage.records, bytes: usage.bytes };
				},
				get: async <V>(collection: string, id: string) => {
					check(collection, id);
					const found = (await request(records.get([scopeKey, collection, id]))) as WorkspaceRecord<V> | undefined;
					lease.assertCurrent();
					return found?.value;
				},
				list: async <V>(collection: string) => {
					check(collection);
					const found = (await request(records.index('collection').getAll([scopeKey, collection]))) as WorkspaceRecord<V>[];
					lease.assertCurrent();
					return found.map(({ id, value }) => ({ id, value }));
				},
				put: async (collection, id, value) => {
					check(collection, id);
					const encoded = JSON.stringify(value);
					if (encoded === undefined) throw new WorkspaceError('INVALID_RECORD', 'Local records must contain JSON');
					const bytes = new TextEncoder().encode(encoded).byteLength;
					if (collection === 'timeline-events' && bytes > TIMELINE_EVENT_MAX_BYTES + 2048)
						throw new WorkspaceError('TIMELINE_EVENT_SIZE', 'This Timeline record exceeds the canonical event capacity.', 413);
					await persist(collection, id, JSON.parse(encoded), bytes);
				},
				getBinary: async (id) => {
					check(BINARY_COLLECTION, id, true);
					const found = (await request(records.get([scopeKey, BINARY_COLLECTION, id]))) as WorkspaceRecord<Uint8Array | Blob> | undefined;
					lease.assertCurrent();
					if (!found) return undefined;
					const size = found.value instanceof Uint8Array ? found.value.byteLength : found.value instanceof Blob ? found.value.size : -1;
					if (size !== found.bytes || (found.binaryRevision !== undefined && typeof found.binaryRevision !== 'string') || (found.value instanceof Blob && !found.binaryRevision))
						throw new WorkspaceError('INVALID_LOCAL_FILE', 'Stored file bytes are invalid');
					return { value: found.value, revision: found.binaryRevision };
				},
				getBytes: async (id) => {
					const found = await tx.getBinary(id);
					if (found?.value instanceof Blob) throw new WorkspaceError('BLOB_READ_REQUIRED', 'Read this file outside the storage transaction through its Blob adapter.');
					return found?.value;
				},
				putBlob: async (id, value) => {
					check(BINARY_COLLECTION, id, true);
					if (!(value instanceof Blob)) throw new WorkspaceError('INVALID_LOCAL_FILE', 'File content must be a Blob');
					await persist(BINARY_COLLECTION, id, value, value.size, crypto.randomUUID());
				},
				putBytes: async (id, value) => {
					check(BINARY_COLLECTION, id, true);
					if (!(value instanceof Uint8Array)) throw new WorkspaceError('INVALID_LOCAL_FILE', 'File bytes must be a byte array');
					await persist(BINARY_COLLECTION, id, Uint8Array.from(value), value.byteLength, crypto.randomUUID());
				},
				deleteBytes: async (id) => removeRecord(BINARY_COLLECTION, id, true),
				delete: (collection, id) => removeRecord(collection, id)
			};
			// Quota is read-modify-write state. Serialize mutations even if a caller
			// batches puts with Promise.all inside one native transaction.
			const put = tx.put;
			const remove = tx.delete;
			const putBytes = tx.putBytes;
			const deleteBytes = tx.deleteBytes;
			const putBlob = tx.putBlob;
			tx.put = (...args) => (writes = writes.then(() => put(...args)));
			tx.delete = (...args) => (writes = writes.then(() => remove(...args)));
			tx.putBytes = (...args) => {
				const [id, bytes] = args;
				if (!(bytes instanceof Uint8Array))
					return (writes = writes.then(() => putBytes(id, bytes)));
				const copy = Uint8Array.from(bytes);
				return (writes = writes.then(() => putBytes(id, copy)));
			};
			tx.putBlob = (...args) => (writes = writes.then(() => putBlob(...args)));
			tx.deleteBytes = (...args) => (writes = writes.then(() => deleteBytes(...args)));
			return tx;
		};
		const unique = new Map<string, WorkspaceTransaction>();
		try {
			const keys = typeof scopes === 'function' ? await scopes(native) : scopeKeys!;
			lease.assertCurrent();
			const views = keys.map((key) => {
				if (!unique.has(key)) unique.set(key, makeView(key));
				return unique.get(key)!;
			});
			const result = await run(views);
			await writes;
			lease.assertCurrent();
			await done;
			lease.assertCurrent();
			return result;
		} catch (error) {
			try {
				native.abort();
			} catch {}
			await done.catch(() => {});
			throw workspaceStorageError(error);
		} finally {
			unsubscribe();
		}
	}
}

/** Normalize the actual browser capacity failure without inventing an app quota. */
function workspaceStorageError(error: unknown) {
	if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError')
		return new WorkspaceError('LOCAL_QUOTA', 'Local workspace is full because the browser could not allocate storage. Free device space or export/remove content, then retry.', 507);
	return error;
}
