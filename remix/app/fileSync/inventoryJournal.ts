import { sameSyncScope, syncPathKey, validSyncEntry, validSyncPathKey, type SyncEntry, type SyncScope } from './reconcile';
import { journalScope, type JournalAccess } from './journalScope';

export const INVENTORY_PAGE_ENTRIES = 128;
export const INVENTORY_PAGE_BYTES = 1024 * 1024;
export const INVENTORY_PIN_STORE = 'inventory-capture-pins';
export const INVENTORY_STORES = ['inventory-captures', 'inventory-pages', 'inventory-entries'] as const;
export type InventoryIdentity = { id: string; source: 'local' | 'remote'; generation: string };
export type InventoryCursor = InventoryIdentity & { scope: SyncScope; after: string; read: number };
export type InventoryProgress = { phase: 'collecting' | 'captured' | 'complete'; pages: number; entries: number; validatedEntries: number };
export type InventoryHeader = InventoryIdentity & InventoryProgress & { scope: string; validatedThrough: string | null };
type Row = { scope: string; capture: string; path: string; identity: string; entry: SyncEntry };
const encoder = new TextEncoder();
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const progress = ({ phase, pages, entries, validatedEntries }: InventoryHeader): InventoryProgress => ({ phase, pages, entries, validatedEntries });

export const inventoryIdentity = (value: InventoryIdentity): InventoryIdentity => {
	if (!value || !identifier(value.id) || !identifier(value.generation) || !['local', 'remote'].includes(value.source))
		throw Error('Invalid inventory generation.');
	return { id: value.id, source: value.source, generation: value.generation };
};
export const validateInventoryHeader = (header: InventoryHeader, expected: InventoryIdentity, key: string) => {
	if (!header || header.scope !== key || header.id !== expected.id || header.source !== expected.source || header.generation !== expected.generation ||
		!['collecting', 'captured', 'complete'].includes(header.phase) || !Number.isSafeInteger(header.pages) || header.pages < 0 ||
		!Number.isSafeInteger(header.entries) || header.entries < 0 || (header.phase !== 'collecting' && header.pages === 0) ||
		!Number.isSafeInteger(header.validatedEntries) || header.validatedEntries < 0 || header.validatedEntries > header.entries ||
		(header.validatedEntries === 0 ? header.validatedThrough !== null : !validSyncPathKey(header.validatedThrough)) ||
		(header.phase === 'collecting' && header.validatedEntries !== 0) || (header.phase === 'complete' && header.validatedEntries !== header.entries))
		throw Error('Inventory generation changed or is unavailable.');
};

export function upgradeInventoryJournal(db: IDBDatabase) {
	if (!db.objectStoreNames.contains(INVENTORY_PIN_STORE)) db.createObjectStore(INVENTORY_PIN_STORE);
	for (const name of INVENTORY_STORES) if (!db.objectStoreNames.contains(name)) {
		const store = db.createObjectStore(name);
		if (name === 'inventory-entries') store.createIndex('identity', ['scope', 'capture', 'identity'], { unique: true });
	}
}

/** Durable observations only. A sealed capture grants no write authority and is
 * not a Timeline version. Adapters must supply one immutable source generation;
 * consumers still reauthorize and compare exact stamps before each mutation. */
export function inventoryJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const scoped = journalScope(db, access, keyRange), { scope, key, check, range } = scoped;
	const identity = inventoryIdentity;
	const validate = (header: InventoryHeader, expected: InventoryIdentity) => validateInventoryHeader(header, expected, key);
	const entry = (value: SyncEntry): SyncEntry => {
		if (!validSyncEntry(value)) throw Error('Invalid inventory entry.');
		return { path: value.path, id: value.id, version: value.version, kind: value.kind, size: value.size, sha256: value.sha256,
			...(value.fingerprint ? { fingerprint: { algorithm: value.fingerprint.algorithm, partSizeBytes: value.fingerprint.partSizeBytes,
				partCount: value.fingerprint.partCount, sha256: value.fingerprint.sha256 } } : {}) };
	};
	const transaction = <T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void) =>
		scoped.transaction([...INVENTORY_STORES, INVENTORY_PIN_STORE], mode, work);
	const withHeader = <T>(value: InventoryIdentity, mode: IDBTransactionMode,
		work: (header: InventoryHeader, tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void) => {
		const expected = identity(value);
		return transaction<T>(mode, (tx, done, fail) => {
			const request = tx.objectStore(INVENTORY_STORES[0]).get([key, expected.id]);
			request.onsuccess = () => { try { check(); validate(request.result, expected); work(request.result, tx, done, fail); } catch (error) { fail(error); } };
		});
	};
	return {
		async begin(value: InventoryIdentity): Promise<InventoryProgress> {
			const expected = identity(value);
			return transaction('readwrite', (tx, done, fail) => {
				const store = tx.objectStore(INVENTORY_STORES[0]), request = store.get([key, expected.id]);
				request.onsuccess = () => { try {
					check();
					const header: InventoryHeader = request.result ?? { ...expected, scope: key, phase: 'collecting', pages: 0, entries: 0, validatedEntries: 0, validatedThrough: null };
					validate(header, expected);
					if (!request.result) store.add(header, [key, expected.id]);
					done(progress(header));
				} catch (error) { fail(error); } };
			});
		},
		async append(value: InventoryIdentity, page: { ordinal: number; entries: readonly SyncEntry[]; totalEntries?: number }): Promise<InventoryProgress> {
			const expected = identity(value);
			if (!page || !Number.isSafeInteger(page.ordinal) || page.ordinal < 0 || !Array.isArray(page.entries) || page.entries.length > INVENTORY_PAGE_ENTRIES ||
				(page.totalEntries !== undefined && (!Number.isSafeInteger(page.totalEntries) || page.totalEntries < 0)) ||
				(!page.entries.length && page.totalEntries === undefined)) throw Error('Invalid inventory page.');
			const rows = page.entries.map(entry), ordinal = page.ordinal, total = page.totalEntries;
			const bytes = encoder.encode(JSON.stringify({ ordinal, entries: rows, ...(total === undefined ? {} : { totalEntries: total }) }));
			if (bytes.length > INVENTORY_PAGE_BYTES) throw Error('Inventory page exceeds its byte bound.');
			const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
			return withHeader(expected, 'readwrite', (header, tx, done, fail) => {
				const pages = tx.objectStore(INVENTORY_STORES[1]), request = pages.get([key, expected.id, ordinal]);
				request.onsuccess = () => { try {
					check();
					if (request.result) {
						if (request.result.digest !== digest || ordinal >= header.pages) throw Error('Inventory page retry changed.');
						done(progress(header)); return;
					}
					if (header.phase !== 'collecting' || header.pages !== ordinal) throw Error('Inventory page is missing or out of order.');
					const count = header.entries + rows.length;
					if (!Number.isSafeInteger(count) || !Number.isSafeInteger(header.pages + 1) || (total !== undefined && total !== count)) throw Error('Inventory completion count changed.');
					const entries = tx.objectStore(INVENTORY_STORES[2]);
					for (const row of rows) entries.add({ scope: key, capture: expected.id, path: syncPathKey(row.path), identity: row.id, entry: row }, [key, expected.id, syncPathKey(row.path)]);
					pages.add({ digest }, [key, expected.id, ordinal]);
					const next: InventoryHeader = { ...header, entries: count, pages: header.pages + 1, phase: total === undefined ? 'collecting' : 'captured' };
					tx.objectStore(INVENTORY_STORES[0]).put(next, [key, expected.id]);
					done(progress(next));
				} catch (error) { fail(error); } };
			});
		},
		/** Captured entries are immutable. Validate at most one page per transaction
		 * and persist its cursor atomically, so closing or cancelling can resume
		 * validation without one whole-tree transaction or a partial completion. */
		async seal(value: InventoryIdentity, changed?: (value: InventoryProgress) => void): Promise<InventoryProgress> {
			const expected = identity(value);
			while (true) {
				const result = await withHeader<InventoryProgress>(expected, 'readwrite', (header, tx, done, fail) => {
					if (header.phase === 'collecting') throw Error('Inventory has no terminal page.');
					if (header.phase === 'complete') { done(progress(header)); return; }
					const entries = tx.objectStore(INVENTORY_STORES[2]), request = entries.openCursor(range(header.id, header.validatedThrough ?? undefined));
					let count = header.validatedEntries, through = header.validatedThrough, processed = 0;
					const save = (complete: boolean) => {
						if (complete && count !== header.entries) throw Error('Inventory entry count changed.');
						const next: InventoryHeader = { ...header, phase: complete ? 'complete' : 'captured', validatedEntries: count, validatedThrough: through };
						tx.objectStore(INVENTORY_STORES[0]).put(next, [key, header.id]); done(progress(next));
					};
					request.onsuccess = () => { try {
						check();
						const cursor = request.result;
						if (!cursor) { save(true); return; }
						if (processed === INVENTORY_PAGE_ENTRIES) { save(false); return; }
						const row: Row = cursor.value, item = entry(row.entry);
						if (row.scope !== key || row.capture !== header.id || row.identity !== item.id || row.path !== syncPathKey(item.path) ||
							JSON.stringify(cursor.primaryKey) !== JSON.stringify([key, header.id, row.path])) throw Error('Inventory entry identity changed.');
						if (count >= header.entries) throw Error('Inventory entry count changed.');
						count++; processed++; through = row.path;
						const parent = item.path.split('/').slice(0, -1).join('/');
						if (!parent) { cursor.continue(); return; }
						const ancestor = entries.get([key, header.id, syncPathKey(parent)]);
						ancestor.onsuccess = () => { try {
							check();
							const folder = ancestor.result?.entry;
							if (!folder || !validSyncEntry(folder) || folder.path !== parent || folder.kind !== 'folder') throw Error('Inventory has a missing, aliased or non-folder ancestor.');
							cursor.continue();
						} catch (error) { fail(error); } };
					} catch (error) { fail(error); } };
				});
				changed?.(result);
				if (result.phase === 'complete') return result;
			}
		},
		async read(value: InventoryIdentity, continuation?: InventoryCursor): Promise<{ entries: SyncEntry[]; next: InventoryCursor | null; totalEntries: number }> {
			const expected = identity(value), token = continuation === undefined ? undefined : structuredClone(continuation);
			if (token !== undefined && (!token || !sameSyncScope(token.scope, scope) || token.id !== expected.id || token.source !== expected.source ||
				token.generation !== expected.generation || !validSyncPathKey(token.after) || !Number.isSafeInteger(token.read) || token.read <= 0)) throw Error('Invalid inventory continuation.');
			return withHeader(expected, 'readonly', (header, tx, done, fail) => {
				if (header.phase !== 'complete') throw Error('Inventory is incomplete; keep the last complete scan.');
				if (token && token.read >= header.entries) throw Error('Invalid inventory continuation count.');
				const request = tx.objectStore(INVENTORY_STORES[2]).openCursor(range(header.id, token?.after));
				const result: SyncEntry[] = [];
				let bytes = 2;
				request.onsuccess = () => { try {
					check();
					const cursor = request.result;
					if (!cursor) {
						if ((token?.read ?? 0) + result.length !== header.entries) throw Error('Inventory ended before its declared entry count.');
						done({ entries: result, next: null, totalEntries: header.entries }); return;
					}
					const row: Row = cursor.value, item = entry(row.entry), size = encoder.encode(JSON.stringify(item)).length + 1;
					if (row.scope !== key || row.capture !== header.id || row.identity !== item.id || row.path !== syncPathKey(item.path) ||
						JSON.stringify(cursor.primaryKey) !== JSON.stringify([key, header.id, row.path])) throw Error('Inventory entry identity changed.');
					if (bytes + size > INVENTORY_PAGE_BYTES || result.length === INVENTORY_PAGE_ENTRIES) {
						if (!result.length) throw Error('Inventory entry exceeds its byte bound.');
						done({ entries: result, next: { ...expected, scope: structuredClone(scope), after: syncPathKey(result.at(-1)!.path),
							read: (token?.read ?? 0) + result.length }, totalEntries: header.entries }); return;
					}
					result.push(item); bytes += size; cursor.continue();
				} catch (error) { fail(error); } };
			});
		},
		async discard(value: InventoryIdentity): Promise<void> {
			return withHeader(value, 'readwrite', (header, tx, done, fail) => {
				const request = tx.objectStore(INVENTORY_PIN_STORE).count(range(header.id));
				request.onsuccess = () => { try {
					check();
					if (request.result) throw Error('Inventory is pinned by an unfinished sync plan.');
					tx.objectStore(INVENTORY_STORES[0]).delete([key, header.id]);
					for (const store of INVENTORY_STORES.slice(1)) tx.objectStore(store).delete(range(header.id));
					done(undefined);
				} catch (error) { fail(error); } };
			});
		}
	};
}
