import { JOURNAL_RETENTION_STORE, registerJournalMetadata, forgetJournalMetadata } from './journalRetention';
import { parsePagedRunReview, parseReviewedConflict, resolveReviewedPage, type PagedRunReview, type PagedReviewProgress, type ReviewedSyncConflict } from './pagedRunReview';
import { parseFileSyncConfiguration, type FileSyncConfiguration } from './configuration';
import { parseCloudInventoryRoot, type CloudInventoryRoot } from './cloudInventory';
import { parseCloudWrite } from './cloudWrite';
import { prepareCloudOperationBinding, type CloudOperationBinding } from './cloudBinding';
import { parseLocalTrashContext } from './localTrash';
import { PAGED_CHECKPOINT_HEADS, validatePagedCheckpointHead } from './checkpoint';
import { syncMutationOrderKey, validateSyncOperation, validateSyncReceipt, validateSyncRun, type SyncOperation, type SyncReceipt } from './execute';
import { INVENTORY_PAGE_BYTES, INVENTORY_PAGE_ENTRIES, INVENTORY_PIN_STORE, INVENTORY_STORES, inventoryJournal, validateInventoryHeader, type InventoryHeader } from './inventoryJournal';
import { journalScope, type JournalAccess } from './journalScope';
import { pagedPlanJournal, parsePagedPlanSpec, PLAN_PIN_STORE, PLAN_STORES, validatePagedPlanHeader,
	type PagedPlanCursor, type PagedPlanHeader, type PagedPlanSpec } from './pagedPlanJournal';
import { sameSyncScope, syncPathKey, validSyncPath, validSyncPathKey, syncScopeKey, type SyncEntry, type SyncScope } from './reconcile';

export const RETAINED_HEADS = 'sync-retained-run-heads';
export const REVIEW_STORE = 'sync-run-reviews';
export const CLOUD_PARENTS = 'sync-cloud-trash-parents';
export const PAGED_RUN_HEADS = 'sync-paged-run-heads';
export const PAGED_RUN_STORES = ['sync-paged-runs', 'sync-paged-operations'] as const;
const stores = [JOURNAL_RETENTION_STORE, RETAINED_HEADS, REVIEW_STORE, CLOUD_PARENTS, ...PAGED_RUN_STORES, PAGED_RUN_HEADS, PLAN_STORES[0], PLAN_PIN_STORE, INVENTORY_STORES[0], INVENTORY_PIN_STORE, PAGED_CHECKPOINT_HEADS, 'runs'];
export type PagedRunSpec = { id: string; plan: PagedPlanSpec; review?: PagedRunReview; configuration?: FileSyncConfiguration };
export type PagedRunProgress = { phase: 'preparing' | 'ready' | 'running' | 'complete'; read: number; total: number; operations: number; confirmed: number };
type SortKey = [number, number, string];
export type CloudBindingProgress = { prepared: number; total: number; phase: 'preparing' | 'ready' };
type CloudPreparation = { configuration: FileSyncConfiguration; root: CloudInventoryRoot; prepared: number; after: SortKey | null };
export type PagedRunHeader = PagedRunProgress & { spec: PagedRunSpec; scope: string; instance: string; retired?: true; planInstance: string;
	next: PagedPlanCursor | null; revision: number; confirmedThrough: SortKey | null; cloud?: CloudPreparation; review?: PagedReviewProgress; retained?: true };
type Header = PagedRunHeader;
export type ConfirmedSyncOperation = { operation: SyncOperation; receipt: SyncReceipt };
export type ConfirmedSyncCursor = { id: string; instance: string; scope: SyncScope; after: string; read: number };
type Row = { scope: string; run: string; path: string; operation: SyncOperation; receipt: SyncReceipt | null; cloud?: CloudOperationBinding };
const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
export const parsePagedRunSpec = (value: PagedRunSpec): PagedRunSpec => {
	if (!value || !identifier(value.id)) throw Error('Invalid paged run identity.');
	const plan = parsePagedPlanSpec(value.plan), configuration = value.configuration === undefined ? undefined : parseFileSyncConfiguration(value.configuration);
	if (configuration && (configuration.mode !== plan.policy.mode || configuration.propagateDeletes !== plan.policy.propagateDeletes ||
		JSON.stringify(configuration.excludedPaths.map(syncPathKey).sort()) !== JSON.stringify(plan.excludedPaths.map(syncPathKey).sort()))) throw Error('Saved run settings do not match the plan.');
	return { id: value.id, plan, ...(value.review === undefined ? {} : { review: parsePagedRunReview(value.review) }), ...(configuration ? { configuration } : {}) };
};
const inputs = (spec: PagedRunSpec) => [spec.plan.local, spec.plan.remote, spec.plan.baseline.local, spec.plan.baseline.remote];
const progress = ({ phase, read, total, operations, confirmed }: Header): PagedRunProgress => ({ phase, read, total, operations, confirmed });
const orderKey = (op: SyncOperation): SortKey => syncMutationOrderKey(op.mutation);
const entry = (e: SyncEntry): SyncEntry => ({ path: e.path, id: e.id, version: e.version, kind: e.kind, size: e.size, sha256: e.sha256,
	...(e.fingerprint ? { fingerprint: { algorithm: e.fingerprint.algorithm, partSizeBytes: e.fingerprint.partSizeBytes,
		partCount: e.fingerprint.partCount, sha256: e.fingerprint.sha256 } } : {}) });
const receiptValue = (r: SyncReceipt): SyncReceipt => ({ operationId: r.operationId,
	scope: { origin: r.scope.origin, ownerId: r.scope.ownerId, dataPlane: r.scope.dataPlane, rootId: r.scope.rootId, deviceId: r.scope.deviceId },
	entry: r.entry === null ? null : entry(r.entry) });

const validOrder = (value: unknown): value is SortKey => Array.isArray(value) && value.length === 3 && [0, 1].includes(value[0]) &&
	Number.isInteger(value[1]) && validSyncPath(value[2]) && value[1] === value[2].split('/').length * (value[0] === 0 ? 1 : -1);
const cloudProgress = (h: Header): CloudBindingProgress => {
	if (!h.cloud) throw Error('Prepare cloud bindings before using this run.');
	return { prepared: h.cloud.prepared, total: h.operations, phase: h.cloud.prepared === h.operations ? 'ready' : 'preparing' };
};
const validateCloudConfiguration = (value: FileSyncConfiguration, spec: PagedRunSpec, scope: SyncScope, root: CloudInventoryRoot) => {
	const c = parseFileSyncConfiguration(value);
	if (spec.configuration && JSON.stringify(c) !== JSON.stringify(spec.configuration)) throw Error('Saved run settings changed.');
	if (scope.dataPlane !== 'home' || c.deviceId !== scope.deviceId || c.remoteFolderId !== root.rootId ||
		c.mode !== spec.plan.policy.mode || c.propagateDeletes !== spec.plan.policy.propagateDeletes ||
		JSON.stringify(c.excludedPaths.map(syncPathKey).sort()) !== JSON.stringify(spec.plan.excludedPaths.map(syncPathKey).sort()))
		throw Error('Cloud configuration does not match the prepared sync plan.');
	return c;
};

export const validatePagedRunHeader = (h: Header, spec: PagedRunSpec, scope: SyncScope) => {
	const key = syncScopeKey(scope);
	const after = h?.confirmedThrough;
	if (!h || h.retired !== undefined || h.scope !== key || JSON.stringify(h.spec) !== JSON.stringify(spec) || !identifier(h.instance) || !identifier(h.planInstance) ||
		!['preparing', 'ready', 'running', 'complete'].includes(h.phase) || ![h.read, h.total, h.operations, h.confirmed, h.revision].every(nonnegative) ||
		h.read > h.total || h.operations > h.read || h.confirmed > h.operations ||
		(h.phase === 'preparing' && (h.read === 0 ? h.next !== null : !h.next || h.next.id !== spec.plan.id ||
			!h.next.scope || !sameSyncScope(h.next.scope, scope) || !validSyncPathKey(h.next.after) || h.next.read !== h.read)) ||
		(h.phase !== 'preparing' && (h.read !== h.total || h.next !== null)) ||
		(['preparing', 'ready'].includes(h.phase) && h.confirmed !== 0) || (h.phase === 'complete' && h.confirmed !== h.operations) ||
		(h.confirmed === 0 ? after !== null : !Array.isArray(after) || after.length !== 3 || ![0, 1].includes(after[0]) ||
			!Number.isInteger(after[1]) || !validSyncPath(after[2]) || after[1] !== after[2].split('/').length * (after[0] === 0 ? 1 : -1)))
		throw Error('Paged sync run changed or is unavailable.');
	if (h.retained !== undefined && (h.retained !== true || h.phase !== 'complete' || spec.review?.kind !== 'retain')) throw Error('Invalid retained run.');
	if (spec.configuration && spec.configuration.deviceId !== scope.deviceId) throw Error('Saved run device changed.');
	if (!!spec.review !== !!h.review) throw Error('Sync conflict review changed.');
	if (h.review) {
		const r = h.review;
		if (![r.pages, r.entries, r.matched].every(nonnegative) || typeof r.complete !== 'boolean' || r.matched > r.entries ||
			r.entries > spec.review!.count || (r.complete && r.entries !== spec.review!.count) ||
			(!r.complete && (h.read || h.operations || r.matched)) || (h.phase !== 'preparing' && r.matched !== spec.review!.count)) throw Error('Invalid sync review progress.');
	}
	if (h.cloud !== undefined) {
		const c = h.cloud;
		if (!c || h.phase === 'preparing' || !nonnegative(c.prepared) || c.prepared > h.operations ||
			(c.prepared === 0 ? c.after !== null : !validOrder(c.after)) ||
			(h.phase !== 'ready' && c.prepared !== h.operations)) throw Error('Invalid cloud binding progress.');
		parseCloudInventoryRoot(c.root); validateCloudConfiguration(c.configuration, spec, scope, c.root);
	}
};

export function upgradePagedRunJournal(db: IDBDatabase) {
	for (const name of [RETAINED_HEADS, REVIEW_STORE, CLOUD_PARENTS, PAGED_RUN_HEADS, ...PAGED_RUN_STORES]) if (!db.objectStoreNames.contains(name)) {
		const store = db.createObjectStore(name);
		if (name === PAGED_RUN_STORES[1]) {
			store.createIndex('operation', ['scope', 'operation.id'], { unique: true });
			store.createIndex('path', ['scope', 'run', 'path'], { unique: true });
		}
	}
}

/** Bounded durable operation recovery, not Timeline/history or device approval.
 * The active root and plan remain pinned after completion until the paged
 * checkpoint handoff verifies fresh observations. Never discard uncertain work. */
export function pagedRunJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const { scope, key, check, transaction } = journalScope(db, access, keyRange);
	const plans = pagedPlanJournal(db, access, keyRange), inventory = inventoryJournal(db, access, keyRange);
	const operationRange = (id: string, after: SortKey | null = null) => (keyRange ?? globalThis.IDBKeyRange).bound(
		after ? [key, id, ...after] : [key, id], [key, id, []], after !== null, false);
	const validate = (h: Header, spec: PagedRunSpec) => validatePagedRunHeader(h, spec, scope);
	const save = (h: Header, tx: IDBTransaction) => { validate(h, h.spec); tx.objectStore(PAGED_RUN_STORES[0]).put(h, [key, h.spec.id]); };
	const withHeader = <T>(spec: PagedRunSpec, mode: IDBTransactionMode,
		work: (h: Header, tx: IDBTransaction, done: (v: T) => void, fail: (e: unknown) => void) => void, releasedDisplay = false) =>
		transaction<T>(stores, mode, (tx, done, fail) => {
			const head = tx.objectStore(PAGED_RUN_HEADS).get(key);
			head.onsuccess = () => { try {
				check(); if (head.result !== spec.id && !releasedDisplay) throw Error('Resume the active paged sync run.');
				const get = tx.objectStore(PAGED_RUN_STORES[0]).get([key, spec.id]);
				get.onsuccess = () => { try { check(); validate(get.result, spec);
					if (head.result !== spec.id && get.result.phase !== 'complete') throw Error('Sync progress run is not active.');
					const plan = tx.objectStore(PLAN_STORES[0]).get([key, spec.plan.id]);
					plan.onsuccess = () => { try {
						check(); validatePagedPlanHeader(plan.result, spec.plan, key);
						if (plan.result.instance !== get.result.planInstance || plan.result.phase !== 'complete') throw Error('Paged run plan changed.');
						work(get.result, tx, done, fail);
					} catch (e) { fail(e); } }; } catch (e) { fail(e); } };
			} catch (e) { fail(e); } };
		});
	const row = (value: Row, spec: PagedRunSpec, primaryKey?: IDBValidKey): Row => {
		if (!value || value.scope !== key || value.run !== spec.id) throw Error('Invalid saved sync operation scope.');
		validateSyncOperation(value.operation);
		if (spec.review?.kind === 'retain') validateSyncRun({ version: 2, intent: 'retain-conflicts', id: spec.id, scope, operations: [value.operation] });
		if (value.operation.id === spec.id || value.path !== syncPathKey(value.operation.mutation.path) ||
			(primaryKey !== undefined && JSON.stringify(primaryKey) !== JSON.stringify([key, spec.id, ...orderKey(value.operation)])))
			throw Error('Invalid saved sync operation order.');
		if (value.operation.confirmed) validateSyncReceipt(value.operation, scope, value.receipt!);
		else if (value.receipt !== null) throw Error('Unconfirmed operation has a receipt.');
		return value;
	};
	const begin = async (value: PagedRunSpec): Promise<PagedRunProgress> => {
		const spec = parsePagedRunSpec(value);
		return transaction(stores, 'readwrite', (tx, done, fail) => {
			const head = tx.objectStore(PAGED_RUN_HEADS).get(key);
			head.onsuccess = () => { try {
				check(); if (head.result !== undefined && head.result !== spec.id) throw Error('Resume the active paged sync run.');
				const saved = tx.objectStore(PAGED_RUN_STORES[0]).get([key, spec.id]);
				saved.onsuccess = () => { try {
					check(); if (saved.result) { validate(saved.result, spec); if (head.result !== spec.id) throw Error('Paged run lost its active root.'); done(progress(saved.result)); return; }
					const baseline = tx.objectStore(PAGED_CHECKPOINT_HEADS).get(key);
					baseline.onsuccess = () => { try {
						check(); if (baseline.result) {
							validatePagedCheckpointHead(baseline.result, key);
							if (JSON.stringify(baseline.result.baseline) !== JSON.stringify(spec.plan.baseline)) throw Error('Plan must use the current paged sync baseline.');
						}
						const legacy = tx.objectStore('runs').get(key);
						legacy.onsuccess = () => { try {
							check(); if (legacy.result) {
								validateSyncRun(legacy.result);
								if (legacy.result.operations.some((op: SyncOperation) => !op.confirmed)) throw Error('Resume the unfinished sync run before planning another.');
							}
							const plan = tx.objectStore(PLAN_STORES[0]).get([key, spec.plan.id]);
							plan.onsuccess = () => { try {
								check(); validatePagedPlanHeader(plan.result, spec.plan, key); const p: PagedPlanHeader = plan.result;
								if (p.phase !== 'complete') throw Error('Sync plan is incomplete.');
								if (spec.review && spec.review.count > p.decisions) throw Error('Conflict review exceeds the plan.');
								if (!p.inputInstances) throw Error('Rebuild this older sync plan before starting a paged run.');
								let pending = 4;
								inputs(spec).forEach((capture, i) => {
									const get = tx.objectStore(INVENTORY_STORES[0]).get([key, capture.id]);
									get.onsuccess = () => { try {
										check(); validateInventoryHeader(get.result, capture, key); const input: InventoryHeader = get.result;
										if (input.phase !== 'complete' || input.instance !== p.inputInstances![i]) throw Error('Sync plan input was replaced; rebuild the plan.');
										// Four-part keys cannot collide with the planner's three-part pins.
										tx.objectStore(INVENTORY_PIN_STORE).put(true, [key, capture.id, spec.id, 'run']);
										if (--pending) return;
										const h: Header = { spec, scope: key, instance: crypto.randomUUID(), planInstance: p.instance, phase: 'preparing',
											read: 0, total: p.decisions, operations: 0, confirmed: 0, next: null, revision: 0, confirmedThrough: null,
											...(spec.review ? { review: { pages: 0, entries: 0, complete: false, matched: 0 } } : {}) };
										tx.objectStore(PAGED_RUN_HEADS).add(spec.id, key);
										tx.objectStore(PLAN_PIN_STORE).add(true, [key, spec.plan.id, spec.id]);
										registerJournalMetadata(tx, access, key, 'run', spec.id, h.instance); save(h, tx); done(progress(h));
									} catch (e) { fail(e); } };
								});
							} catch (e) { fail(e); } };
						} catch (e) { fail(e); } };
					} catch (e) { fail(e); } };
				} catch (e) { fail(e); } };
			} catch (e) { fail(e); } };
		});
	};
	const step = async (value: PagedRunSpec, uuid: () => string = () => crypto.randomUUID()): Promise<PagedRunProgress> => {
		const spec = parsePagedRunSpec(value), h = await withHeader<Header>(spec, 'readonly', (h, _tx, done) => done(h));
		if (h.phase !== 'preparing') return progress(h);
		if (h.review && !h.review.complete) throw Error('Complete the durable conflict review before preparing operations.');
		const page = await plans.read(spec.plan, h.next ?? undefined); check();
		if (page.totalDecisions !== h.total) throw Error('Sync plan count changed.');
		const conflicts = page.decisions.filter(d => d.kind === 'conflict');
		let decisions = page.decisions;
		if (spec.review) {
			const reviewed = await withHeader<ReviewedSyncConflict[]>(spec, 'readonly', (current, tx, done, fail) => {
				if (current.instance !== h.instance || current.revision !== h.revision) throw Error('Conflict preparation changed; retry this page.');
				if (!conflicts.length) { done([]); return; }
				const rows: ReviewedSyncConflict[] = []; let remaining = conflicts.length;
				conflicts.forEach((c, i) => {
					const get = tx.objectStore(REVIEW_STORE).get([key, spec.id, 'path', syncPathKey(c.path)]);
					get.onsuccess = () => { try {
						check(); rows[i] = parseReviewedConflict(get.result, spec.review!, spec.plan.policy.mode, scope);
						if (!--remaining) done(rows);
					} catch (e) { fail(e); } };
				});
			});
			decisions = resolveReviewedPage(page.decisions, reviewed, spec.review.kind, spec.plan.policy.mode, scope);
		} else if (conflicts.length) throw Error('Resolve sync conflicts before applying this plan.');
		const operations: SyncOperation[] = decisions.filter(d => d.kind === 'copy' || d.kind === 'trash').map(mutation => ({ id: uuid(), mutation, confirmed: false }));
		for (const op of operations) { validateSyncOperation(op); if (op.id === spec.id) throw Error('Sync operation IDs must be unique.'); }
		return withHeader(spec, 'readwrite', (current, tx, done) => {
			if (current.instance !== h.instance) throw Error('Paged sync run was replaced.');
			if (current.revision !== h.revision) { done(progress(current)); return; }
			if (JSON.stringify(current) !== JSON.stringify(h)) throw Error('Paged sync progress changed.');
			for (const operation of operations) tx.objectStore(PAGED_RUN_STORES[1]).add(
				{ scope: key, run: spec.id, path: syncPathKey(operation.mutation.path), operation, receipt: null } satisfies Row,
				[key, spec.id, ...orderKey(operation)]);
			const next: Header = { ...h, read: h.read + page.decisions.length, operations: h.operations + operations.length,
				next: page.next, revision: h.revision + 1, phase: page.next ? 'preparing' : 'ready',
				...(h.review ? { review: { ...h.review, matched: h.review.matched + conflicts.length } } : {}) };
			if (!page.next && next.review && next.review.matched !== spec.review!.count) throw Error('Conflict review count changed.');
			save(next, tx); done(progress(next));
		});
	};
	const read = async (value: PagedRunSpec): Promise<{ operations: SyncOperation[]; progress: PagedRunProgress }> => {
		const spec = parsePagedRunSpec(value);
		return withHeader(spec, 'readonly', (h, tx, done, fail) => {
			if (h.phase === 'preparing') throw Error('Paged sync run is incomplete.');
			const request = tx.objectStore(PAGED_RUN_STORES[1]).openCursor(operationRange(spec.id, h.confirmedThrough));
			const operations: SyncOperation[] = []; let size = 2;
			request.onsuccess = () => { try {
				check(); const cursor = request.result;
				if (!cursor) {
					if (h.confirmed + operations.length !== h.operations) throw Error('Sync operations ended before their declared count.');
					done({ operations, progress: progress(h) }); return;
				}
				const op = row(cursor.value, spec, cursor.primaryKey).operation;
				if (op.confirmed || h.confirmed + operations.length >= h.operations) throw Error('Invalid sync operation confirmation order.');
				const length = bytes(op) + 1;
				if (operations.length === INVENTORY_PAGE_ENTRIES || size + length > INVENTORY_PAGE_BYTES) {
					if (!operations.length) throw Error('Sync operation exceeds its byte bound.');
					done({ operations, progress: progress(h) }); return;
				}
				operations.push(op); size += length; cursor.continue();
			} catch (e) { fail(e); } };
		});
	};
	const find = async (spec: PagedRunSpec, path: string): Promise<SyncOperation | null> => {
		if (!validSyncPath(path)) throw Error('Invalid sync path.');
		return withHeader(spec, 'readonly', (h, tx, done, fail) => {
			if (h.phase === 'preparing') throw Error('Paged sync run is incomplete.');
			const get = tx.objectStore(PAGED_RUN_STORES[1]).index('path').get([key, spec.id, syncPathKey(path)]);
			get.onsuccess = () => { try {
				check(); const op = get.result === undefined ? null : row(get.result, spec).operation;
				if (op && op.mutation.path !== path) throw Error('Sync operation path collision.'); done(op);
			} catch (e) { fail(e); } };
		});
	};
	const beginCloud = async (value: PagedRunSpec, supplied: FileSyncConfiguration): Promise<CloudBindingProgress> => {
		const spec = parsePagedRunSpec(value), requested = parseFileSyncConfiguration(supplied);
		return withHeader(spec, 'readwrite', (h, tx, done, fail) => {
			const get = tx.objectStore(INVENTORY_STORES[0]).get([key, spec.plan.remote.id]);
			get.onsuccess = () => { try {
				check(); validateInventoryHeader(get.result, spec.plan.remote, key);
				const capture: InventoryHeader = get.result;
				if (capture.phase !== 'complete' || !capture.cloud) throw Error('Capture complete cloud metadata before preparing bindings.');
				const root = parseCloudInventoryRoot(capture.cloud), configuration = validateCloudConfiguration(requested, spec, scope, root);
				if (h.cloud) {
					if (JSON.stringify(h.cloud.configuration) !== JSON.stringify(configuration) || JSON.stringify(h.cloud.root) !== JSON.stringify(root))
						throw Error('Saved cloud binding configuration changed.');
				} else {
					if (h.phase !== 'ready') throw Error('Bind cloud operations before starting the run.');
					h.cloud = { configuration, root, prepared: 0, after: null }; h.revision++; save(h, tx);
				}
				done(cloudProgress(h));
			} catch (e) { fail(e); } };
		});
	};
	const stepCloud = async (value: PagedRunSpec): Promise<CloudBindingProgress> => {
		const spec = parsePagedRunSpec(value);
		const snapshot = await withHeader<{ header: Header; rows: Row[] }>(spec, 'readonly', (h, tx, done, fail) => {
			cloudProgress(h);
			if (h.cloud!.prepared === h.operations) { done({ header: h, rows: [] }); return; }
			const request = tx.objectStore(PAGED_RUN_STORES[1]).openCursor(operationRange(spec.id, h.cloud!.after));
			const rows: Row[] = []; let size = 2;
			request.onsuccess = () => { try {
				check(); const cursor = request.result;
				if (!cursor) {
					if (h.cloud!.prepared + rows.length !== h.operations) throw Error('Cloud operations ended early.');
					done({ header: h, rows }); return;
				}
				const r = row(cursor.value, spec, cursor.primaryKey), length = bytes(r) + 1;
				if (r.operation.confirmed || r.cloud || h.cloud!.prepared + rows.length >= h.operations) throw Error('Cloud preparation order changed.');
				if (rows.length === INVENTORY_PAGE_ENTRIES || size + length > INVENTORY_PAGE_BYTES) {
					if (!rows.length) throw Error('Cloud operation exceeds its byte bound.');
					done({ header: h, rows }); return;
				}
				rows.push(r); size += length; cursor.continue();
			} catch (e) { fail(e); } };
		});
		const h = snapshot.header;
		if (h.cloud!.prepared === h.operations) return cloudProgress(h);
		const previous = new Map<string, string | undefined>(), changes = new Map<string, string>();
		const previousTrash = async (path: string): Promise<string | undefined> => {
			if (changes.has(path)) return changes.get(path);
			if (!previous.has(path)) previous.set(path, await withHeader<string | undefined>(spec, 'readonly', (current, tx, done, fail) => {
				if (current.instance !== h.instance || current.revision !== h.revision) throw Error('Cloud preparation changed; retry this page.');
				const get = tx.objectStore(CLOUD_PARENTS).get([key, spec.id, path]);
				get.onsuccess = () => { try { check(); if (get.result !== undefined && !identifier(get.result)) throw Error('Invalid cloud Trash receipt link.'); done(get.result); } catch (e) { fail(e); } };
			}));
			return previous.get(path);
		};
		const prepared: Row[] = []; let size = 2;
		for (const r of snapshot.rows) {
			const cloud = await prepareCloudOperationBinding(r.operation, scope, h.cloud!.root.rootId, {
				node: path => inventory.cloudNode(spec.plan.remote, path), operation: path => find(spec, path), previousTrash
			}); check();
			const bound = { ...r, cloud }, length = bytes(bound) + 1;
			if (size + length > INVENTORY_PAGE_BYTES) {
				if (!prepared.length) throw Error('Cloud binding exceeds its byte bound.'); break;
			}
			prepared.push(bound); size += length;
			const m = r.operation.mutation;
			if (m.kind === 'trash' && m.side === 'local') changes.set(m.path.split('/').slice(0, -1).join('/'), r.operation.id);
		}
		return withHeader(spec, 'readwrite', (current, tx, done) => {
			if (current.instance !== h.instance) throw Error('Paged sync run was replaced.');
			if (current.revision !== h.revision) { done(cloudProgress(current)); return; }
			if (JSON.stringify(current) !== JSON.stringify(h)) throw Error('Cloud preparation changed.');
			for (const r of prepared) tx.objectStore(PAGED_RUN_STORES[1]).put(r, [key, spec.id, ...orderKey(r.operation)]);
			for (const [path, id] of changes) tx.objectStore(CLOUD_PARENTS).put(id, [key, spec.id, path]);
			h.cloud!.prepared += prepared.length; h.cloud!.after = orderKey(prepared.at(-1)!.operation); h.revision++;
			save(h, tx); done(cloudProgress(h));
		});
	};
	return {
		get scope() { return structuredClone(scope); },
		begin, step, read, beginCloud, stepCloud,
		/** A bounded display-only join. This never starts or confirms work. All
		 * paths share one scope-fenced readonly transaction rather than one
		 * transaction per rendered inventory row. */
		async operationsForPaths(value: PagedRunSpec, paths: readonly string[]): Promise<(SyncOperation | null)[]> {
			const spec = parsePagedRunSpec(value), requested = [...paths];
			if (requested.length > INVENTORY_PAGE_ENTRIES || requested.some(path => !validSyncPath(path)) ||
				new Set(requested.map(syncPathKey)).size !== requested.length) throw Error('Invalid sync progress page.');
			return withHeader(spec, 'readonly', (h, tx, done, fail) => {
				if (h.phase === 'preparing') throw Error('Sync progress is not prepared.');
				if (!requested.length) { done([]); return; }
				const result: (SyncOperation | null)[] = new Array(requested.length); let pending = requested.length;
				requested.forEach((path, index) => {
					const get = tx.objectStore(PAGED_RUN_STORES[1]).index('path').get([key, spec.id, syncPathKey(path)]);
					get.onsuccess = () => { try {
						check(); const operation = get.result === undefined ? null : row(get.result, spec).operation;
						if (operation && operation.mutation.path !== path) throw Error('Sync progress path changed.');
						result[index] = operation; if (!--pending) done(result);
					} catch (error) { fail(error); } };
				});
			}, true);
		},
		async appendReview(value: PagedRunSpec, page: { ordinal: number; rows: ReviewedSyncConflict[]; complete?: boolean }): Promise<PagedReviewProgress> {
			const spec = parsePagedRunSpec(value);
			if (!spec.review || !page || !nonnegative(page.ordinal) || !Array.isArray(page.rows) || !page.rows.length ||
				page.rows.length > INVENTORY_PAGE_ENTRIES || (page.complete !== undefined && typeof page.complete !== 'boolean')) throw Error('Invalid conflict review page.');
			const ordinal = page.ordinal, complete = page.complete === true, rows = page.rows.map(row => parseReviewedConflict(row, spec.review!, spec.plan.policy.mode, scope));
			const payload = new TextEncoder().encode(JSON.stringify({ ordinal, rows, complete }));
			if (payload.length > INVENTORY_PAGE_BYTES) throw Error('Conflict review page exceeds its byte bound.');
			const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', payload))].map(b => b.toString(16).padStart(2, '0')).join('');
			return withHeader(spec, 'readwrite', (h, tx, done, fail) => {
				const store = tx.objectStore(REVIEW_STORE), get = store.get([key, spec.id, 'page', ordinal]);
				get.onsuccess = () => { try {
					check(); const r = h.review!;
					if (get.result) {
						if (get.result.digest !== digest || ordinal >= r.pages) throw Error('Conflict review retry changed.'); done(r); return;
					}
					if (h.phase !== 'preparing' || h.read || r.complete || ordinal !== r.pages) throw Error('Conflict review page is missing or out of order.');
					const count = r.entries + rows.length;
					if (count > spec.review!.count || (complete && count !== spec.review!.count) || (!complete && count === spec.review!.count)) throw Error('Conflict review completion count changed.');
					for (const row of rows) store.add(row, [key, spec.id, 'path', syncPathKey(row.conflict.path)]);
					store.add({ digest }, [key, spec.id, 'page', ordinal]);
					h.review = { ...r, pages: r.pages + 1, entries: count, complete }; h.revision++; save(h, tx); done(h.review);
				} catch (e) { fail(e); } };
			});
		},
		async prepareCloud(value: PagedRunSpec, configuration: FileSyncConfiguration, changed?: (p: CloudBindingProgress) => void) {
			const spec = parsePagedRunSpec(value); let state = await beginCloud(spec, configuration);
			while (state.phase !== 'ready') { state = await stepCloud(spec); changed?.(state); } return state;
		},
		async cloudBinding(value: PagedRunSpec, configuration: FileSyncConfiguration, selector: { id: string } | { path: string }): Promise<CloudOperationBinding | null> {
			const spec = parsePagedRunSpec(value), supplied = parseFileSyncConfiguration(configuration);
			if ('id' in selector ? !identifier(selector.id) : !validSyncPath(selector.path)) throw Error('Invalid cloud binding selector.');
			return withHeader(spec, 'readonly', (h, tx, done, fail) => {
				if (cloudProgress(h).phase !== 'ready') throw Error('Complete cloud bindings before executing.');
				if (JSON.stringify(h.cloud!.configuration) !== JSON.stringify(supplied)) throw Error('Saved cloud binding configuration changed.');
				const ops = tx.objectStore(PAGED_RUN_STORES[1]), get = 'id' in selector ? ops.index('operation').get([key, selector.id]) : ops.index('path').get([key, spec.id, syncPathKey(selector.path)]);
				get.onsuccess = () => { try {
					check(); if (get.result === undefined) { done(null); return; }
					const r = row(get.result, spec); if (!r.cloud) throw Error('Cloud binding is missing.');
					const write = parseCloudWrite(r.cloud.write);
					if (!sameSyncScope(write.scope, scope) || write.cloudRootId !== h.cloud!.root.rootId ||
						JSON.stringify({ ...r.operation, confirmed: false }) !== JSON.stringify({ ...write.operation, confirmed: false }) ||
						('id' in selector ? write.operation.id !== selector.id : write.operation.mutation.path !== selector.path)) throw Error('Cloud binding identity changed.');
					done({ write, ...(r.cloud.trashContext !== undefined ? { trashContext: parseLocalTrashContext(write.operation, r.cloud.trashContext) } : {}) });
				} catch (e) { fail(e); } };
			});
		},
		/** Canonical path order for the checkpoint merge, independent of effect order. */
		async readConfirmed(value: PagedRunSpec, continuation?: ConfirmedSyncCursor): Promise<{ rows: ConfirmedSyncOperation[]; next: ConfirmedSyncCursor | null; total: number }> {
			const spec = parsePagedRunSpec(value), token = continuation && structuredClone(continuation);
			if (token && (token.id !== spec.id || !identifier(token.instance) || !token.scope || !sameSyncScope(token.scope, scope) ||
				!validSyncPathKey(token.after) || !nonnegative(token.read) || token.read === 0)) throw Error('Invalid confirmed-operation continuation.');
			return withHeader(spec, 'readonly', (h, tx, done, fail) => {
				if (h.phase !== 'complete') throw Error('Complete the sync run before reading checkpoint receipts.');
				if (token && (token.instance !== h.instance || token.read >= h.operations)) throw Error('Confirmed-operation continuation changed.');
				const range = (keyRange ?? globalThis.IDBKeyRange).bound(token ? [key, spec.id, token.after] : [key, spec.id], [key, spec.id, []], !!token);
				const request = tx.objectStore(PAGED_RUN_STORES[1]).index('path').openCursor(range);
				const rows: ConfirmedSyncOperation[] = []; let size = 2;
				request.onsuccess = () => { try {
					check(); const cursor = request.result;
					if (!cursor) {
						if ((token?.read ?? 0) + rows.length !== h.operations) throw Error('Confirmed-operation count changed.');
						done({ rows, next: null, total: h.operations }); return;
					}
					const r = row(cursor.value, spec, cursor.primaryKey);
					if (!r.operation.confirmed || !r.receipt) throw Error('Checkpoint operation is unconfirmed.');
					const saved = { operation: r.operation, receipt: r.receipt }, length = bytes(saved) + 1;
					if (rows.length === INVENTORY_PAGE_ENTRIES || size + length > INVENTORY_PAGE_BYTES) {
						if (!rows.length) throw Error('Confirmed operation exceeds its byte bound.');
						done({ rows, total: h.operations, next: { id: spec.id, instance: h.instance, scope, read: (token?.read ?? 0) + rows.length,
							after: syncPathKey(rows.at(-1)!.operation.mutation.path) } }); return;
					}
					rows.push(saved); size += length; cursor.continue();
				} catch (e) { fail(e); } };
			});
		},
		async active(): Promise<{ spec: PagedRunSpec; progress: PagedRunProgress; review?: PagedReviewProgress } | null> {
			return transaction(stores, 'readonly', (tx, done, fail) => {
				const head = tx.objectStore(PAGED_RUN_HEADS).get(key);
				head.onsuccess = () => { try {
					check(); if (head.result === undefined) { done(null); return; }
					if (!identifier(head.result)) throw Error('Invalid active paged run.');
					const get = tx.objectStore(PAGED_RUN_STORES[0]).get([key, head.result]);
					get.onsuccess = () => { try {
						check(); const h: Header = get.result, spec = parsePagedRunSpec(h?.spec);
						if (spec.id !== head.result) throw Error('Invalid active paged run.'); validate(h, spec);
						done({ spec, progress: progress(h), ...(h.review ? { review: h.review } : {}) });
					} catch (e) { fail(e); } };
				} catch (e) { fail(e); } };
			});
		},
		async prepare(value: PagedRunSpec, changed?: (p: PagedRunProgress) => void): Promise<PagedRunProgress> {
			const spec = parsePagedRunSpec(value); let state = await begin(spec);
			while (state.phase === 'preparing') { state = await step(spec); changed?.(state); }
			return state;
		},
		async start(value: PagedRunSpec): Promise<PagedRunProgress> {
			const spec = parsePagedRunSpec(value);
			return withHeader(spec, 'readwrite', (h, tx, done) => {
				if (h.phase === 'preparing') throw Error('Paged sync run is incomplete.');
				if (h.cloud && cloudProgress(h).phase !== 'ready') throw Error('Complete cloud bindings before starting the run.');
				if (h.phase === 'ready') { h.phase = h.operations ? 'running' : 'complete'; h.revision++; save(h, tx); }
				done(progress(h));
			});
		},
		async confirm(value: PagedRunSpec, supplied: SyncReceipt): Promise<PagedRunProgress> {
			const spec = parsePagedRunSpec(value), receipt = structuredClone(supplied);
			if (!receipt || typeof receipt.operationId !== 'string') throw Error('Invalid sync receipt identity.');
			return withHeader(spec, 'readwrite', (h, tx, done, fail) => {
				if (!['running', 'complete'].includes(h.phase)) throw Error('Start the durable sync run before confirming.');
				const ops = tx.objectStore(PAGED_RUN_STORES[1]), get = ops.index('operation').get([key, receipt.operationId]);
				get.onsuccess = () => { try {
					check(); const r = row(get.result, spec), op = r.operation;
					validateSyncReceipt(op, scope, receipt); const saved = receiptValue(receipt);
					if (op.confirmed) {
						if (JSON.stringify(r.receipt) !== JSON.stringify(saved)) throw Error('Sync receipt retry changed.');
						done(progress(h)); return;
					}
					const next = ops.openCursor(operationRange(spec.id, h.confirmedThrough));
					next.onsuccess = () => { try {
						check(); const cursor = next.result;
						if (!cursor || row(cursor.value, spec, cursor.primaryKey).operation.id !== op.id) throw Error('Confirm sync operations in order.');
						op.confirmed = true; r.receipt = saved; ops.put(r, cursor.primaryKey);
						h.confirmed++; h.confirmedThrough = orderKey(op); h.revision++;
						if (h.confirmed === h.operations) h.phase = 'complete';
						save(h, tx); done(progress(h));
					} catch (e) { fail(e); } };
				} catch (e) { fail(e); } };
			});
		},
		/** Keep the last confirmed retention identity for repeat Ignore. This does
		 * not publish agreement or advance either replica's common baseline. */
		async finishRetention(value: PagedRunSpec): Promise<PagedRunProgress> {
			const spec = parsePagedRunSpec(value);
			return withHeader(spec, 'readwrite', (h, tx, done) => {
				if (spec.review?.kind !== 'retain' || h.phase !== 'complete') throw Error('Complete conflict retention before releasing this run.');
				h.retained = true; h.revision++; save(h, tx);
				tx.objectStore(RETAINED_HEADS).put(spec.id, key);
				tx.objectStore(PAGED_RUN_HEADS).delete(key);
				tx.objectStore(PLAN_PIN_STORE).delete([key, spec.plan.id, spec.id]);
				for (const input of inputs(spec)) tx.objectStore(INVENTORY_PIN_STORE).delete([key, input.id, spec.id, 'run']);
				done(progress(h));
			});
		},
		async retained(): Promise<{ spec: PagedRunSpec; progress: PagedRunProgress } | null> {
			return transaction(stores, 'readonly', (tx, done, fail) => {
				const head = tx.objectStore(RETAINED_HEADS).get(key);
				head.onsuccess = () => { try {
					check(); if (head.result === undefined) { done(null); return; }
					if (!identifier(head.result)) throw Error('Invalid retained run identity.');
					const get = tx.objectStore(PAGED_RUN_STORES[0]).get([key, head.result]);
					get.onsuccess = () => { try {
						check(); const h: Header = get.result, spec = parsePagedRunSpec(h?.spec); validate(h, spec);
						if (!h.retained || spec.id !== head.result) throw Error('Conflict retention is not complete.');
						done({ spec, progress: progress(h) });
					} catch (e) { fail(e); } };
				} catch (e) { fail(e); } };
			});
		},
		find: (value: PagedRunSpec, path: string) => find(parsePagedRunSpec(value), path),
		async discard(value: PagedRunSpec): Promise<void> {
			const spec = parsePagedRunSpec(value);
			return withHeader(spec, 'readwrite', (h, tx, done) => {
				if (!['preparing', 'ready'].includes(h.phase)) throw Error('A started sync run must retain its receipts and checkpoint boundary.');
				tx.objectStore(PAGED_RUN_STORES[1]).delete(operationRange(spec.id));
				tx.objectStore(CLOUD_PARENTS).delete(operationRange(spec.id));
				tx.objectStore(REVIEW_STORE).delete(operationRange(spec.id));
				tx.objectStore(PAGED_RUN_STORES[0]).delete([key, spec.id]); forgetJournalMetadata(tx, key, 'run', spec.id);
				tx.objectStore(PAGED_RUN_HEADS).delete(key);
				tx.objectStore(PLAN_PIN_STORE).delete([key, spec.plan.id, spec.id]);
				for (const input of inputs(spec)) tx.objectStore(INVENTORY_PIN_STORE).delete([key, input.id, spec.id, 'run']);
				done(undefined);
			});
		}
	};
}
export type PagedRunJournal = ReturnType<typeof pagedRunJournal>;
