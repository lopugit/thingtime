import { assertBackupCapturePolicy, parseNativeBackupCapture, parseNativeSkippedPage, type NativeBackupCapture, type NativeSkippedPage } from './nativeInventory';
import { JOURNAL_RETENTION_STORE, registerJournalMetadata, forgetJournalMetadata } from './journalRetention';
import { inventorySyncEntry, parseCloudInventoryNode, parseCloudInventoryRoot, type CloudInventoryNode, type CloudInventoryRoot } from './cloudInventory';
import { sameSyncStamp, validSyncPath, sameSyncScope, syncPathKey, validSyncEntry, validSyncPathKey, type SyncEntry, type SyncScope, type SyncPolicy } from './reconcile';
import { journalScope, type JournalAccess } from './journalScope';

export const INVENTORY_PAGE_ENTRIES = 128;
export const INVENTORY_PAGE_BYTES = 1024 * 1024;
export const INVENTORY_PIN_STORE = 'inventory-capture-pins';
export const INVENTORY_STORES = ['inventory-captures', 'inventory-pages', 'inventory-entries'] as const;
export type InventoryIdentity = { id: string; source: 'local' | 'remote'; generation: string };
export type InventoryCursor = InventoryIdentity & { scope: SyncScope; after: string; read: number };
export type InventoryProgress = { phase: 'collecting' | 'captured' | 'complete'; pages: number; entries: number; validatedEntries: number };
export type InventoryHeader = InventoryIdentity & InventoryProgress & { scope: string; instance?: string; retired?: true; cloud?: CloudInventoryRoot; backupCapture?: NativeBackupCapture; skippedEntries?: number; derivedCoverage?: true; validatedThrough: string | null };
type Row = { scope: string; capture: string; path: string; identity: string; entry: SyncEntry; cloud?: CloudInventoryNode };
const encoder = new TextEncoder();
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const progress = ({ phase, pages, entries, validatedEntries }: InventoryHeader): InventoryProgress => ({ phase, pages, entries, validatedEntries });

export const inventoryIdentity = (value: InventoryIdentity): InventoryIdentity => {
	if (!value || !identifier(value.id) || !identifier(value.generation) || !['local', 'remote'].includes(value.source))
		throw Error('Invalid inventory generation.');
	return { id: value.id, source: value.source, generation: value.generation };
};
export const validateInventoryHeader = (header: InventoryHeader, expected: InventoryIdentity, key: string) => {
	if (!header || header.retired !== undefined || header.scope !== key || header.id !== expected.id || header.source !== expected.source || header.generation !== expected.generation ||
		(header.instance !== undefined && !identifier(header.instance)) ||
		!['collecting', 'captured', 'complete'].includes(header.phase) || !Number.isSafeInteger(header.pages) || header.pages < 0 ||
		!Number.isSafeInteger(header.entries) || header.entries < 0 || (header.phase !== 'collecting' && header.pages === 0) ||
		!Number.isSafeInteger(header.validatedEntries) || header.validatedEntries < 0 || header.validatedEntries > header.entries ||
		(header.validatedEntries === 0 ? header.validatedThrough !== null : !validSyncPathKey(header.validatedThrough)) ||
		(header.phase === 'collecting' && header.validatedEntries !== 0) || (header.phase === 'complete' && header.validatedEntries !== header.entries))
		throw Error('Inventory generation changed or is unavailable.');
	if (header.backupCapture !== undefined) {
		const c = parseNativeBackupCapture(header.backupCapture);
		if (header.source !== 'local' || !Number.isSafeInteger(header.skippedEntries) || header.skippedEntries! < 0 || header.skippedEntries! > c.totalSkipped ||
			(header.derivedCoverage !== undefined && header.derivedCoverage !== true) ||
			(header.phase === 'complete' && header.skippedEntries !== c.totalSkipped)) throw Error('Backup coverage or skipped inventory changed.');
	} else if (header.skippedEntries !== undefined || header.derivedCoverage !== undefined) throw Error('Backup coverage is missing.');
	if (header.cloud !== undefined) {
		if (header.source !== 'remote') throw Error('Cloud metadata requires a remote inventory.');
		parseCloudInventoryRoot(header.cloud);
	}
};

export const newInventoryHeader = (identity: InventoryIdentity, scope: string): InventoryHeader => ({
	...inventoryIdentity(identity), scope, instance: crypto.randomUUID(), phase: 'collecting', pages: 0, entries: 0, validatedEntries: 0, validatedThrough: null
});

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
	const validateRow = (row: Row, header: InventoryHeader, primaryKey?: IDBValidKey): SyncEntry => {
		if (!row) throw Error('Inventory entry is unavailable.');
		const item = entry(row.entry);
		if (row.scope !== key || row.capture !== header.id || row.identity !== item.id || row.path !== syncPathKey(item.path) ||
			(primaryKey !== undefined && JSON.stringify(primaryKey) !== JSON.stringify([key, header.id, row.path]))) throw Error('Inventory entry identity changed.');
		if (header.cloud) {
			const node = parseCloudInventoryNode(row.cloud!);
			if (!sameSyncStamp(item, inventorySyncEntry(node)) || item.id === header.cloud.rootId) throw Error('Cloud inventory metadata changed.');
		} else if (row.cloud !== undefined) throw Error('Unexpected cloud inventory metadata.');
		return item;
	};
	const validateCloudParent = (row: Row, header: InventoryHeader, parentId: string) => {
		if (header.cloud && (row.cloud!.kind === 'file' ? row.cloud!.file.folderId : row.cloud!.folderId) !== parentId) throw Error('Cloud inventory ancestry changed.');
	};
	const readRows = (store: IDBObjectStore, query: IDBKeyRange, consume: (rows: Row[], keys: IDBValidKey[]) => void, fail: (error: unknown) => void) =>
		scoped.readPage(store, query, INVENTORY_PAGE_ENTRIES + 1, consume, fail);
	const transaction = <T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void) =>
		scoped.transaction([...INVENTORY_STORES, INVENTORY_PIN_STORE, JOURNAL_RETENTION_STORE], mode, work);
	const withHeader = <T>(value: InventoryIdentity, mode: IDBTransactionMode,
		work: (header: InventoryHeader, tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void) => {
		const expected = identity(value);
		return transaction<T>(mode, (tx, done, fail) => {
			const request = tx.objectStore(INVENTORY_STORES[0]).get([key, expected.id]);
			request.onsuccess = () => { try { check(); validate(request.result, expected); work(request.result, tx, done, fail); } catch (error) { fail(error); } };
		});
	};
	const begin = async (value: InventoryIdentity, cloud?: CloudInventoryRoot): Promise<InventoryProgress> => {
		const expected = identity(value);
		if (cloud && expected.source !== 'remote') throw Error('Cloud metadata requires a remote inventory.');
		return transaction('readwrite', (tx, done, fail) => {
			const store = tx.objectStore(INVENTORY_STORES[0]), request = store.get([key, expected.id]);
			request.onsuccess = () => { try {
				check();
				const header: InventoryHeader = request.result ?? { ...newInventoryHeader(expected, key), ...(cloud ? { cloud } : {}) };
				validate(header, expected);
				if (cloud && JSON.stringify(header.cloud) !== JSON.stringify(cloud)) throw Error('Cloud inventory root changed.');
				if (!request.result) { store.add(header, [key, expected.id]); registerJournalMetadata(tx, access, key, 'inventory', expected.id, header.instance); }
				done(progress(header));
			} catch (error) { fail(error); } };
		});
	};
	const append = async (value: InventoryIdentity, page: { ordinal: number; entries: readonly SyncEntry[]; totalEntries?: number }, cloud?: CloudInventoryNode[]): Promise<InventoryProgress> => {
		const expected = identity(value);
		if (!page || !Number.isSafeInteger(page.ordinal) || page.ordinal < 0 || !Array.isArray(page.entries) || page.entries.length > INVENTORY_PAGE_ENTRIES ||
			(page.totalEntries !== undefined && (!Number.isSafeInteger(page.totalEntries) || page.totalEntries < 0)) ||
			(!page.entries.length && page.totalEntries === undefined)) throw Error('Invalid inventory page.');
		const rows = page.entries.map(entry), ordinal = page.ordinal, total = page.totalEntries;
		const bytes = encoder.encode(JSON.stringify({ ordinal, entries: rows, ...(cloud ? { cloud } : {}), ...(total === undefined ? {} : { totalEntries: total }) }));
		if (bytes.length > INVENTORY_PAGE_BYTES) throw Error('Inventory page exceeds its byte bound.');
		const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
		return withHeader(expected, 'readwrite', (header, tx, done, fail) => {
			if (!!header.cloud !== !!cloud) throw Error('Cloud inventory pages must retain their original metadata.');
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
				for (const [i, row] of rows.entries()) entries.add({ scope: key, capture: expected.id, path: syncPathKey(row.path), identity: row.id, entry: row, ...(cloud ? { cloud: cloud[i] } : {}) }, [key, expected.id, syncPathKey(row.path)]);
				pages.add({ digest }, [key, expected.id, ordinal]);
				const next: InventoryHeader = { ...header, entries: count, pages: header.pages + 1, phase: total === undefined ? 'collecting' : 'captured' };
				tx.objectStore(INVENTORY_STORES[0]).put(next, [key, expected.id]);
				done(progress(next));
			} catch (error) { fail(error); } };
		});
	};
	const setCoverage = async (value: InventoryIdentity, capture: NativeBackupCapture, policy: SyncPolicy, derived = false) => {
		assertBackupCapturePolicy(policy); const expected = parseNativeBackupCapture(capture);
		return withHeader<void>(value, 'readwrite', (header, tx, done) => {
			if (header.source !== 'local' || header.cloud) throw Error('Backup coverage requires a local capture.');
			if (header.backupCapture) {
				if (JSON.stringify(header.backupCapture) !== JSON.stringify(expected) || !!header.derivedCoverage !== derived) throw Error('Backup coverage changed.');
				done(undefined); return;
			}
			if (header.phase !== 'collecting' || header.pages !== 0) throw Error('Backup coverage must precede inventory entries.');
			tx.objectStore(INVENTORY_STORES[0]).put({ ...header, backupCapture: expected, skippedEntries: 0, ...(derived ? { derivedCoverage: true } : {}) }, [key, header.id]);
			done(undefined);
		});
	};
	const appendSkips = async (value: InventoryIdentity, page: NativeSkippedPage) => {
		return withHeader<void>(value, 'readwrite', (header, tx, done, fail) => {
			if (!header.backupCapture) throw Error('Backup coverage is missing.');
			const parsed = parseNativeSkippedPage(page, header.backupCapture, page.offset), pages = tx.objectStore(INVENTORY_STORES[1]);
			const id = [key, header.id, 'skip', parsed.offset], read = pages.get(id);
			read.onsuccess = () => { try {
				check();
				if (read.result !== undefined) {
					if (JSON.stringify(read.result) !== JSON.stringify(parsed)) throw Error('Skipped inventory retry changed.');
					done(undefined); return;
				}
				if (header.phase !== 'collecting' || parsed.offset !== header.skippedEntries) throw Error('Skipped inventory is missing or out of order.');
				pages.add(parsed, id);
				const paths = new Map<string, 'entry' | 'subtree'>();
				for (const skip of parsed.skipped) {
					if (skip.path === null) { pages.put(true, [key, header.id, 'skip-root']); continue; }
					const path = syncPathKey(skip.path);
					paths.set(path, paths.get(path) === 'subtree' || skip.scope === 'subtree' ? 'subtree' : 'entry');
				}
				for (const [path, scope] of paths) {
					const pathId = [key, header.id, 'skip-path', path], previous = pages.get(pathId);
					previous.onsuccess = () => { try { check(); pages.put(previous.result === 'subtree' || scope === 'subtree' ? 'subtree' : 'entry', pathId); } catch (error) { fail(error); } };
				}
				tx.objectStore(INVENTORY_STORES[0]).put({ ...header, skippedEntries: parsed.offset + parsed.skipped.length }, [key, header.id]); done(undefined);
			} catch (error) { fail(error); } };
		});
	};
	const readSkips = async (value: InventoryIdentity, offset = 0): Promise<NativeSkippedPage | null> => {
		return withHeader(value, 'readonly', (header, tx, done, fail) => {
			if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid skipped inventory continuation.');
			if (!header.backupCapture) { if (offset !== 0) throw Error('Invalid skipped inventory continuation.'); done(null); return; }
			const read = tx.objectStore(INVENTORY_STORES[1]).get([key, header.id, 'skip', offset]);
			read.onsuccess = () => { try {
				check();
				if (header.backupCapture!.totalSkipped === 0 && offset === 0) {
					done({ capture: structuredClone(header.backupCapture!), offset: 0, skipped: [], nextOffset: null, totalSkipped: 0 }); return;
				}
				done(parseNativeSkippedPage(read.result, header.backupCapture!, offset));
			} catch (error) { fail(error); } };
		});
	};
	const cloudNodes = async (value: InventoryIdentity, paths: readonly string[]): Promise<(CloudInventoryNode | null)[]> => {
		const requested = [...paths];
		if (requested.length > INVENTORY_PAGE_ENTRIES || requested.some(path => !validSyncPath(path)) ||
			new Set(requested.map(syncPathKey)).size !== requested.length) throw Error('Invalid cloud inventory path.');
		return withHeader(value, 'readonly', (header, tx, done, fail) => {
			if (!header.cloud || header.phase !== 'complete') throw Error('A complete cloud metadata capture is required.');
			if (!requested.length) { done([]); return; }
			const result: (CloudInventoryNode | null)[] = new Array(requested.length); let pending = requested.length;
			requested.forEach((path, index) => {
				const id = [key, header.id, syncPathKey(path)], get = tx.objectStore(INVENTORY_STORES[2]).get(id);
				get.onsuccess = () => { try {
					check();
					if (get.result === undefined) result[index] = null;
					else {
						const item = validateRow(get.result, header, id);
						if (item.path !== path) throw Error('Case or Unicode filename collision requires review.');
						result[index] = parseCloudInventoryNode(get.result.cloud);
					}
					if (!--pending) done(result);
				} catch (error) { fail(error); } };
			});
		});
	};
	return {
		/** Exact bounded observations from a sealed baseline; no missing whole
		 * inventory or failed access is ever interpreted as path absence. */
		async entriesForPaths(value: InventoryIdentity, paths: readonly string[]): Promise<(SyncEntry | null)[]> {
			const requested = [...paths];
			if (requested.length > INVENTORY_PAGE_ENTRIES || requested.some(path => !validSyncPath(path))) throw Error('Invalid inventory path page.');
			return withHeader(value, 'readonly', (header, tx, done, fail) => {
				if (header.phase !== 'complete') throw Error('A complete baseline is required.');
				const result: (SyncEntry | null)[] = new Array(requested.length); let waiting = requested.length;
				if (!waiting) { done([]); return; }
				requested.forEach((path, i) => { const id = [key, header.id, syncPathKey(path)], get = tx.objectStore(INVENTORY_STORES[2]).get(id);
					get.onsuccess = () => { try { check(); const row = get.result === undefined ? null : validateRow(get.result, header, id);
						if (row && row.path !== path) throw Error('Case or Unicode baseline collision requires review.'); result[i] = row; if (!--waiting) done(result);
					} catch (error) { fail(error); } }; });
			});
		},

		setCoverage: (value: InventoryIdentity, capture: NativeBackupCapture, policy: SyncPolicy) => setCoverage(value, capture, policy), appendSkips, readSkips,
		importState: (value: InventoryIdentity) => withHeader<InventoryProgress & { skipped: number; derived: boolean; coverage: NativeBackupCapture | null }>(value, 'readonly', (header, _tx, done) => done({
			...progress(header), skipped: header.skippedEntries ?? 0, derived: header.derivedCoverage === true,
			coverage: header.backupCapture ? parseNativeBackupCapture(header.backupCapture) : null
		})),
		/** Upgrade an older admitted job without rereading its committed prefix.
		 * The caller must already hold the exact reviewed job's native ticket. */
		latestNativeImport: (captureId: string, generation: string): Promise<InventoryIdentity | null> => transaction('readonly', (tx, done, fail) => {
			const read = tx.objectStore(INVENTORY_PIN_STORE).get([key, 'latest-review']);
			read.onsuccess = () => { try {
				check(); if (read.result === undefined) { done(null); return; }
				const id = inventoryIdentity(read.result), get = tx.objectStore(INVENTORY_STORES[0]).get([key, id.id]);
				get.onsuccess = () => { try {
					check(); const header: InventoryHeader = get.result; validate(header, id);
					done(header.source === 'local' && !header.derivedCoverage && header.backupCapture?.id === captureId &&
						header.backupCapture.generation === generation ? id : null);
				} catch (error) { fail(error); } };
			} catch (error) { fail(error); } };
		}),
		/** Keep just the current review capture; later cycles release the prior
		 * pin atomically. The UI cache carries only its scope-bound identity. */
		async retainLatest(value: InventoryIdentity): Promise<void> {
			return withHeader(value, 'readwrite', (header, tx, done, fail) => {
				const pins = tx.objectStore(INVENTORY_PIN_STORE), pointer = [key, 'latest-review'], read = pins.get(pointer);
				read.onsuccess = () => { try {
					check();
					if (read.result !== undefined) {
						const old = inventoryIdentity(read.result);
						pins.delete([key, old.id, 'latest-review']);
					}
					pins.put(true, [key, header.id, 'latest-review']); pins.put(inventoryIdentity(header), pointer); done(undefined);
				} catch (error) { fail(error); } };
			});
		},
		/** Look up only these bounded paths and their ancestors, rather than
		 * loading or rescanning the whole skip ledger per checkpoint page. */
		async unobserved(value: InventoryIdentity, paths: string[]): Promise<boolean[]> {
			if (!Array.isArray(paths) || paths.length > INVENTORY_PAGE_ENTRIES || paths.some(path => !validSyncPath(path))) throw Error('Invalid coverage path page.');
			return withHeader(value, 'readonly', (header, tx, done, fail) => {
				if (!header.backupCapture || header.backupCapture.coverage === 'full' || !paths.length) { done(paths.map(() => false)); return; }
				if (header.skippedEntries !== header.backupCapture.totalSkipped) throw Error('Skipped inventory is incomplete.');
				const store = tx.objectStore(INVENTORY_STORES[1]), root = store.get([key, header.id, 'skip-root']);
				root.onsuccess = () => { try {
					check(); if (root.result === true) { done(paths.map(() => true)); return; }
					const results = paths.map(() => false); let remaining = paths.reduce((n, path) => n + path.split('/').length, 0);
					paths.forEach((path, i) => {
						const parts = path.split('/');
						for (let n = 1; n <= parts.length; n++) {
							const request = store.get([key, header.id, 'skip-path', syncPathKey(parts.slice(0, n).join('/'))]);
							request.onsuccess = () => { try { check(); if (request.result === 'subtree' || (n === parts.length && request.result === 'entry')) results[i] = true;
								if (--remaining === 0) done(results); } catch (error) { fail(error); } };
						}
					});
				} catch (error) { fail(error); } };
			});
		},
		/** Native source coverage stays attached even to a derived checkpoint.
		 * Its totalEntries describes that source, not the derived baseline count. */
		coverage: (value: InventoryIdentity) => withHeader<NativeBackupCapture | null>(value, 'readonly', (header, _tx, done) => done(header.backupCapture ? structuredClone(header.backupCapture) : null)),
		async copyCoverage(from: InventoryIdentity, to: InventoryIdentity, policy: SyncPolicy) {
			const c = await withHeader<NativeBackupCapture | null>(from, 'readonly', (header, _tx, done) => {
				if (header.phase !== 'complete') throw Error('Source inventory coverage is incomplete.');
				done(header.backupCapture ? structuredClone(header.backupCapture) : null);
			});
			if (!c) return;
			await setCoverage(to, c, policy, true);
			let offset = 0;
			do { const page = (await readSkips(from, offset))!; await appendSkips(to, page); if (page.nextOffset === null) return; offset = page.nextOffset; } while (true);
		},
		begin: (value: InventoryIdentity) => begin(value),
		beginCloud: (value: InventoryIdentity, root: CloudInventoryRoot) => begin(value, parseCloudInventoryRoot(root)),
		append: (value: InventoryIdentity, page: { ordinal: number; entries: readonly SyncEntry[]; totalEntries?: number }) => append(value, page),
		async appendCloud(value: InventoryIdentity, page: { ordinal: number; nodes: readonly CloudInventoryNode[]; totalEntries?: number }): Promise<InventoryProgress> {
			if (!page || !Array.isArray(page.nodes) || page.nodes.length > INVENTORY_PAGE_ENTRIES) throw Error('Invalid cloud inventory page.');
			const nodes = page.nodes.map(parseCloudInventoryNode);
			return append(value, { ordinal: page.ordinal, entries: nodes.map(inventorySyncEntry), ...(page.totalEntries === undefined ? {} : { totalEntries: page.totalEntries }) }, nodes);
		},
		/** Captured entries are immutable. Validate at most one page per transaction
		 * and persist its cursor atomically, so closing or cancelling can resume
		 * validation without one whole-tree transaction or a partial completion. */
		async seal(value: InventoryIdentity, changed?: (value: InventoryProgress) => void): Promise<InventoryProgress> {
			const expected = identity(value);
			while (true) {
				const result = await withHeader<InventoryProgress>(expected, 'readwrite', (header, tx, done, fail) => {
					if (header.phase === 'collecting') throw Error('Inventory has no terminal page.');
					if (header.backupCapture && (header.skippedEntries !== header.backupCapture.totalSkipped ||
						(!header.derivedCoverage && header.entries !== header.backupCapture.totalEntries))) throw Error('Backup entries or skipped inventory are incomplete.');
					if (header.phase === 'complete') { done(progress(header)); return; }
					const entries = tx.objectStore(INVENTORY_STORES[2]);
					let count = header.validatedEntries, through = header.validatedThrough;
					const save = (complete: boolean) => {
						if (complete && count !== header.entries) throw Error('Inventory entry count changed.');
						const next: InventoryHeader = { ...header, phase: complete ? 'complete' : 'captured', validatedEntries: count, validatedThrough: through };
						tx.objectStore(INVENTORY_STORES[0]).put(next, [key, header.id]); done(progress(next));
					};
					readRows(entries, range(header.id, header.validatedThrough ?? undefined), (rows, keys) => {
						const page = rows.slice(0, INVENTORY_PAGE_ENTRIES), parents = new Map<string, Row[]>();
						for (const [i, row] of page.entries()) {
							const item = validateRow(row, header, keys[i]);
							if (count >= header.entries) throw Error('Inventory entry count changed.');
							count++; through = row.path;
							const parent = item.path.split('/').slice(0, -1).join('/');
							if (!parent) { if (header.cloud) validateCloudParent(row, header, header.cloud.rootId); continue; }
							const children = parents.get(parent) ?? []; children.push(row); parents.set(parent, children);
						}
						let pending = parents.size;
						if (!pending) { save(rows.length <= INVENTORY_PAGE_ENTRIES); return; }
						// Siblings share a single parent lookup; enqueue independent parents
						// together instead of waiting for each child before requesting the next.
						for (const [parent, children] of parents) {
							const primaryKey = [key, header.id, syncPathKey(parent)], ancestor = entries.get(primaryKey);
							ancestor.onsuccess = () => { try {
								check();
								if (!ancestor.result) throw Error('Inventory has a missing, aliased or non-folder ancestor.');
								const folder = validateRow(ancestor.result, header, primaryKey);
								if (folder.path !== parent || folder.kind !== 'folder') throw Error('Inventory has a missing, aliased or non-folder ancestor.');
								for (const row of children) validateCloudParent(row, header, folder.id);
								if (--pending === 0) save(rows.length <= INVENTORY_PAGE_ENTRIES);
							} catch (error) { fail(error); } };
						}
					}, fail);
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
				const result: SyncEntry[] = [];
				let bytes = 2;
				readRows(tx.objectStore(INVENTORY_STORES[2]), range(header.id, token?.after), (rows, keys) => {
					for (const [i, row] of rows.entries()) {
						const item = validateRow(row, header, keys[i]), size = encoder.encode(JSON.stringify(item)).length + 1;
						if (bytes + size > INVENTORY_PAGE_BYTES || result.length === INVENTORY_PAGE_ENTRIES) {
							if (!result.length) throw Error('Inventory entry exceeds its byte bound.');
							done({ entries: result, next: { ...expected, scope: structuredClone(scope), after: syncPathKey(result.at(-1)!.path),
								read: (token?.read ?? 0) + result.length }, totalEntries: header.entries }); return;
						}
						result.push(item); bytes += size;
					}
					if ((token?.read ?? 0) + result.length !== header.entries) throw Error('Inventory ended before its declared entry count.');
					done({ entries: result, next: null, totalEntries: header.entries });
				}, fail);
			});
		},
		async cloudRoot(value: InventoryIdentity): Promise<CloudInventoryRoot> {
			return withHeader(value, 'readonly', (header, _tx, done) => {
				if (!header.cloud || header.phase !== 'complete') throw Error('A complete cloud metadata capture is required.');
				done(parseCloudInventoryRoot(header.cloud));
			});
		},
		cloudNodes,
		cloudNode: async (value: InventoryIdentity, path: string) => (await cloudNodes(value, [path]))[0]!,
		async discard(value: InventoryIdentity): Promise<void> {
			return withHeader(value, 'readwrite', (header, tx, done, fail) => {
				const request = tx.objectStore(INVENTORY_PIN_STORE).count(range(header.id));
				request.onsuccess = () => { try {
					check();
					if (request.result) throw Error('Inventory is pinned by an unfinished sync plan.');
					tx.objectStore(INVENTORY_STORES[0]).delete([key, header.id]); forgetJournalMetadata(tx, key, 'inventory', header.id);
					for (const store of INVENTORY_STORES.slice(1)) tx.objectStore(store).delete(range(header.id));
					done(undefined);
				} catch (error) { fail(error); } };
			});
		}
	};
}
