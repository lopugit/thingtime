import { PAGED_CHECKPOINT_HEADS, validatePagedCheckpointHead } from './checkpoint';
import { syncMutationOrderKey, validateSyncOperation, validateSyncReceipt, validateSyncRun, type SyncOperation, type SyncReceipt } from './execute';
import { INVENTORY_PAGE_BYTES, INVENTORY_PAGE_ENTRIES, INVENTORY_PIN_STORE, INVENTORY_STORES, validateInventoryHeader, type InventoryHeader } from './inventoryJournal';
import { journalScope, type JournalAccess } from './journalScope';
import { pagedPlanJournal, parsePagedPlanSpec, PLAN_PIN_STORE, PLAN_STORES, validatePagedPlanHeader,
	type PagedPlanCursor, type PagedPlanHeader, type PagedPlanSpec } from './pagedPlanJournal';
import { sameSyncScope, syncPathKey, validSyncPath, validSyncPathKey, syncScopeKey, type SyncEntry, type SyncScope } from './reconcile';

export const PAGED_RUN_HEADS = 'sync-paged-run-heads';
export const PAGED_RUN_STORES = ['sync-paged-runs', 'sync-paged-operations'] as const;
const stores = [...PAGED_RUN_STORES, PAGED_RUN_HEADS, PLAN_STORES[0], PLAN_PIN_STORE, INVENTORY_STORES[0], INVENTORY_PIN_STORE, PAGED_CHECKPOINT_HEADS, 'runs'];
export type PagedRunSpec = { id: string; plan: PagedPlanSpec };
export type PagedRunProgress = { phase: 'preparing' | 'ready' | 'running' | 'complete'; read: number; total: number; operations: number; confirmed: number };
type SortKey = [number, number, string];
export type PagedRunHeader = PagedRunProgress & { spec: PagedRunSpec; scope: string; instance: string; planInstance: string;
	next: PagedPlanCursor | null; revision: number; confirmedThrough: SortKey | null };
type Header = PagedRunHeader;
export type ConfirmedSyncOperation = { operation: SyncOperation; receipt: SyncReceipt };
export type ConfirmedSyncCursor = { id: string; instance: string; scope: SyncScope; after: string; read: number };
type Row = { scope: string; run: string; path: string; operation: SyncOperation; receipt: SyncReceipt | null };
const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
export const parsePagedRunSpec = (value: PagedRunSpec): PagedRunSpec => {
	if (!value || !identifier(value.id)) throw Error('Invalid paged run identity.');
	return { id: value.id, plan: parsePagedPlanSpec(value.plan) };
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

export const validatePagedRunHeader = (h: Header, spec: PagedRunSpec, scope: SyncScope) => {
	const key = syncScopeKey(scope);
	const after = h?.confirmedThrough;
	if (!h || h.scope !== key || JSON.stringify(h.spec) !== JSON.stringify(spec) || !identifier(h.instance) || !identifier(h.planInstance) ||
		!['preparing', 'ready', 'running', 'complete'].includes(h.phase) || ![h.read, h.total, h.operations, h.confirmed, h.revision].every(nonnegative) ||
		h.read > h.total || h.operations > h.read || h.confirmed > h.operations ||
		(h.phase === 'preparing' && (h.read === 0 ? h.next !== null : !h.next || h.next.id !== spec.plan.id ||
			!h.next.scope || !sameSyncScope(h.next.scope, scope) || !validSyncPathKey(h.next.after) || h.next.read !== h.read)) ||
		(h.phase !== 'preparing' && (h.read !== h.total || h.next !== null)) ||
		(['preparing', 'ready'].includes(h.phase) && h.confirmed !== 0) || (h.phase === 'complete' && h.confirmed !== h.operations) ||
		(h.confirmed === 0 ? after !== null : !Array.isArray(after) || after.length !== 3 || ![0, 1].includes(after[0]) ||
			!Number.isInteger(after[1]) || !validSyncPath(after[2]) || after[1] !== after[2].split('/').length * (after[0] === 0 ? 1 : -1)))
		throw Error('Paged sync run changed or is unavailable.');
};

export function upgradePagedRunJournal(db: IDBDatabase) {
	for (const name of [PAGED_RUN_HEADS, ...PAGED_RUN_STORES]) if (!db.objectStoreNames.contains(name)) {
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
	const plans = pagedPlanJournal(db, access, keyRange);
	const operationRange = (id: string, after: SortKey | null = null) => (keyRange ?? globalThis.IDBKeyRange).bound(
		after ? [key, id, ...after] : [key, id], [key, id, []], after !== null, false);
	const validate = (h: Header, spec: PagedRunSpec) => validatePagedRunHeader(h, spec, scope);
	const save = (h: Header, tx: IDBTransaction) => { validate(h, h.spec); tx.objectStore(PAGED_RUN_STORES[0]).put(h, [key, h.spec.id]); };
	const withHeader = <T>(spec: PagedRunSpec, mode: IDBTransactionMode,
		work: (h: Header, tx: IDBTransaction, done: (v: T) => void, fail: (e: unknown) => void) => void) =>
		transaction<T>(stores, mode, (tx, done, fail) => {
			const head = tx.objectStore(PAGED_RUN_HEADS).get(key);
			head.onsuccess = () => { try {
				check(); if (head.result !== spec.id) throw Error('Resume the active paged sync run.');
				const get = tx.objectStore(PAGED_RUN_STORES[0]).get([key, spec.id]);
				get.onsuccess = () => { try { check(); validate(get.result, spec);
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
											read: 0, total: p.decisions, operations: 0, confirmed: 0, next: null, revision: 0, confirmedThrough: null };
										tx.objectStore(PAGED_RUN_HEADS).add(spec.id, key);
										tx.objectStore(PLAN_PIN_STORE).add(true, [key, spec.plan.id, spec.id]);
										save(h, tx); done(progress(h));
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
		const page = await plans.read(spec.plan, h.next ?? undefined); check();
		if (page.totalDecisions !== h.total || page.decisions.some(d => d.kind === 'conflict')) throw Error('Resolve sync conflicts before applying this plan.');
		const operations: SyncOperation[] = page.decisions.filter(d => d.kind === 'copy' || d.kind === 'trash').map(mutation => ({ id: uuid(), mutation, confirmed: false }));
		for (const op of operations) { validateSyncOperation(op); if (op.id === spec.id) throw Error('Sync operation IDs must be unique.'); }
		return withHeader(spec, 'readwrite', (current, tx, done) => {
			if (current.instance !== h.instance) throw Error('Paged sync run was replaced.');
			if (current.revision !== h.revision) { done(progress(current)); return; }
			if (JSON.stringify(current) !== JSON.stringify(h)) throw Error('Paged sync progress changed.');
			for (const operation of operations) tx.objectStore(PAGED_RUN_STORES[1]).add(
				{ scope: key, run: spec.id, path: syncPathKey(operation.mutation.path), operation, receipt: null } satisfies Row,
				[key, spec.id, ...orderKey(operation)]);
			const next: Header = { ...h, read: h.read + page.decisions.length, operations: h.operations + operations.length,
				next: page.next, revision: h.revision + 1, phase: page.next ? 'preparing' : 'ready' };
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
	return {
		get scope() { return structuredClone(scope); },
		begin, step, read,
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
		async active(): Promise<{ spec: PagedRunSpec; progress: PagedRunProgress } | null> {
			return transaction(stores, 'readonly', (tx, done, fail) => {
				const head = tx.objectStore(PAGED_RUN_HEADS).get(key);
				head.onsuccess = () => { try {
					check(); if (head.result === undefined) { done(null); return; }
					if (!identifier(head.result)) throw Error('Invalid active paged run.');
					const get = tx.objectStore(PAGED_RUN_STORES[0]).get([key, head.result]);
					get.onsuccess = () => { try {
						check(); const h: Header = get.result, spec = parsePagedRunSpec(h?.spec);
						if (spec.id !== head.result) throw Error('Invalid active paged run.'); validate(h, spec);
						done({ spec, progress: progress(h) });
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
		async find(value: PagedRunSpec, path: string): Promise<SyncOperation | null> {
			const spec = parsePagedRunSpec(value); if (!validSyncPath(path)) throw Error('Invalid sync path.');
			return withHeader(spec, 'readonly', (h, tx, done, fail) => {
				if (h.phase === 'preparing') throw Error('Paged sync run is incomplete.');
				const get = tx.objectStore(PAGED_RUN_STORES[1]).index('path').get([key, spec.id, syncPathKey(path)]);
				get.onsuccess = () => { try { check(); done(get.result === undefined ? null : row(get.result, spec).operation); } catch (e) { fail(e); } };
			});
		},
		async discard(value: PagedRunSpec): Promise<void> {
			const spec = parsePagedRunSpec(value);
			return withHeader(spec, 'readwrite', (h, tx, done) => {
				if (!['preparing', 'ready'].includes(h.phase)) throw Error('A started sync run must retain its receipts and checkpoint boundary.');
				tx.objectStore(PAGED_RUN_STORES[1]).delete(operationRange(spec.id));
				tx.objectStore(PAGED_RUN_STORES[0]).delete([key, spec.id]);
				tx.objectStore(PAGED_RUN_HEADS).delete(key);
				tx.objectStore(PLAN_PIN_STORE).delete([key, spec.plan.id, spec.id]);
				for (const input of inputs(spec)) tx.objectStore(INVENTORY_PIN_STORE).delete([key, input.id, spec.id, 'run']);
				done(undefined);
			});
		}
	};
}
export type PagedRunJournal = ReturnType<typeof pagedRunJournal>;
