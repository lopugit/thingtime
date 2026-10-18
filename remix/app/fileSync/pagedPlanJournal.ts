import { MAX_SYNC_EXCLUSIONS } from './configuration';
import { inventoryIdentity, inventoryJournal, INVENTORY_PAGE_BYTES, INVENTORY_PAGE_ENTRIES, INVENTORY_PIN_STORE,
	INVENTORY_STORES, validateInventoryHeader, type InventoryHeader, type InventoryIdentity } from './inventoryJournal';
import { journalScope, type JournalAccess } from './journalScope';
import { decideSyncPath, sameSyncContent, sameSyncScope, sameSyncStamp, syncPathKey, validSyncEntry, validSyncPath, validSyncPathKey,
	type SyncDecision, type SyncPathObservation, type SyncPolicy, type SyncScope } from './reconcile';

export type PagedPlanSpec = {
	id: string;
	local: InventoryIdentity;
	remote: InventoryIdentity;
	baseline: { local: InventoryIdentity; remote: InventoryIdentity };
	policy: SyncPolicy;
	excludedPaths: string[];
};
export type PagedPlanProgress = { phase: 'indexing' | 'planning' | 'complete'; indexed: number; planned: number; decisions: number };
export type PagedPlanCursor = { id: string; scope: SyncScope; after: string; read: number };
type Position = { after: string | null; read: number };
export type PagedPlanHeader = PagedPlanProgress & { scope: string; instance: string; spec: PagedPlanSpec; positions: Position[]; totals: number[]; revision: number };
export const PLAN_PIN_STORE = 'sync-plan-pins';
export const PLAN_STORES = ['sync-plans', 'sync-plan-ancestors', 'sync-plan-decisions'] as const;
const STORES = PLAN_STORES;
type Header = PagedPlanHeader;
const ALL_STORES = [...STORES, PLAN_PIN_STORE, INVENTORY_STORES[0], INVENTORY_PIN_STORE];
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const captures = (s: PagedPlanSpec) => [s.local, s.remote, s.baseline.local, s.baseline.remote];
const initialPositions = (): Position[] => Array.from({ length: 4 }, () => ({ after: null, read: 0 }));
const progress = ({ phase, indexed, planned, decisions }: Header): PagedPlanProgress => ({ phase, indexed, planned, decisions });
const nonnegative = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function parsePagedPlanSpec(value: PagedPlanSpec): PagedPlanSpec {
	if (!value || !identifier(value.id) || !value.baseline || !value.policy ||
		!['two-way', 'upload', 'download', 'backup'].includes(value.policy.mode) || typeof value.policy.propagateDeletes !== 'boolean' ||
		!Array.isArray(value.excludedPaths) || value.excludedPaths.length > MAX_SYNC_EXCLUSIONS || value.excludedPaths.some(p => !validSyncPath(p)) ||
		value.excludedPaths.reduce((n, p) => n + encoder.encode(p).length, 0) > 16_384) throw Error('Invalid paged sync plan.');
	const inputs = captures(value).map(inventoryIdentity);
	if (inputs.some((input, i) => input.source !== (i % 2 ? 'remote' : 'local'))) throw Error('Sync plan replica changed.');
	const exclusions = value.excludedPaths.map(syncPathKey);
	if (new Set(exclusions).size !== exclusions.length) throw Error('Duplicate sync exclusion.');
	return { id: value.id, local: inputs[0], remote: inputs[1], baseline: { local: inputs[2], remote: inputs[3] },
		policy: { mode: value.policy.mode, propagateDeletes: value.policy.propagateDeletes }, excludedPaths: [...value.excludedPaths] };
}

export const validatePagedPlanHeader = (h: PagedPlanHeader, spec: PagedPlanSpec, key: string) => {
	if (!h || !identifier(h.instance) || h.scope !== key || JSON.stringify(h.spec) !== JSON.stringify(spec) ||
		!['indexing', 'planning', 'complete'].includes(h.phase) || !nonnegative(h.revision) ||
		![h.indexed, h.planned, h.decisions].every(nonnegative) || h.decisions > h.planned || h.planned > h.indexed ||
		!Array.isArray(h.totals) || h.totals.length !== 4 || !h.totals.every(nonnegative) ||
		!Array.isArray(h.positions) || h.positions.length !== 4 || h.positions.some((p, i) => !p || !nonnegative(p.read) || p.read > h.totals[i] ||
			(p.read === 0 ? p.after !== null : !validSyncPathKey(p.after))) ||
		(h.phase === 'indexing' && (h.planned !== 0 || h.decisions !== 0)) ||
		(h.phase === 'complete' && (h.planned !== h.indexed || h.positions.some((p, i) => p.read !== h.totals[i]))))
		throw Error('Sync plan changed or is unavailable.');
};

export function upgradePagedPlanJournal(db: IDBDatabase) {
	for (const store of [...STORES, PLAN_PIN_STORE]) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
}

/** Two bounded passes over immutable observations. The first validates the
 * complete union and indexes changed ancestors; only then can the second make
 * decisions. No decision is readable until that second pass is durable.
 * This is a plan, never device approval, an operation receipt or a baseline. */
export function pagedPlanJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const { scope, key, check, range, transaction } = journalScope(db, access, keyRange);
	const inventory = inventoryJournal(db, access, keyRange);
	const validate = (h: Header, spec: PagedPlanSpec) => validatePagedPlanHeader(h, spec, key);
	const withHeader = <T>(spec: PagedPlanSpec, mode: IDBTransactionMode,
		work: (header: Header, tx: IDBTransaction, done: (result: T) => void, fail: (error: unknown) => void) => void) =>
		transaction<T>(ALL_STORES, mode, (tx, done, fail) => {
			const request = tx.objectStore(STORES[0]).get([key, spec.id]);
			request.onsuccess = () => { try { check(); validate(request.result, spec); work(request.result, tx, done, fail); } catch (error) { fail(error); } };
		});
	const unpin = (spec: PagedPlanSpec, tx: IDBTransaction) => {
		for (const capture of captures(spec)) tx.objectStore(INVENTORY_PIN_STORE).delete([key, capture.id, spec.id]);
	};
	const begin = async (value: PagedPlanSpec): Promise<PagedPlanProgress> => {
		const spec = parsePagedPlanSpec(value);
		return transaction(ALL_STORES, 'readwrite', (tx, done, fail) => {
			const store = tx.objectStore(STORES[0]), request = store.get([key, spec.id]);
			request.onsuccess = () => { try {
				check();
				if (request.result) { validate(request.result, spec); done(progress(request.result)); return; }
				const totals: number[] = []; let remaining = 4;
				captures(spec).forEach((capture, i) => {
					const read = tx.objectStore(INVENTORY_STORES[0]).get([key, capture.id]);
					read.onsuccess = () => { try {
						check(); validateInventoryHeader(read.result, capture, key);
						const header: InventoryHeader = read.result;
						if (header.phase !== 'complete') throw Error('Sync planning requires complete inventories.');
						totals[i] = header.entries;
						tx.objectStore(INVENTORY_PIN_STORE).put(true, [key, capture.id, spec.id]);
						if (--remaining) return;
						if (!Number.isSafeInteger(totals.reduce((a, b) => a + b, 0))) throw Error('Sync inventory count exceeds its safe range.');
						const h: Header = { scope: key, instance: crypto.randomUUID(), spec, totals, positions: initialPositions(), revision: 0,
							phase: 'indexing', indexed: 0, planned: 0, decisions: 0 };
						store.add(h, [key, spec.id]); done(progress(h));
					} catch (error) { fail(error); } };
				});
			} catch (error) { fail(error); } };
		});
	};
	const step = async (value: PagedPlanSpec): Promise<PagedPlanProgress> => {
		const spec = parsePagedPlanSpec(value), header = await withHeader<Header>(spec, 'readonly', (h, _tx, done) => done(h));
		return advance(spec, header);
	};
	async function advance(spec: PagedPlanSpec, header: Header): Promise<PagedPlanProgress> {
		if (header.phase === 'complete') return progress(header);
		// Each stream contributes at most one bounded page. Persist only consumed
		// positions; unused suffixes are read again after restart, never skipped.
		const pages = await Promise.all(captures(spec).map(async (capture, i) => {
			const p = header.positions[i];
			if (p.read === header.totals[i]) return [];
			const page = await inventory.read(capture, p.after === null ? undefined : { ...capture, scope, after: p.after, read: p.read });
			if (page.totalEntries !== header.totals[i] || !page.entries.length) throw Error('Sync inventory changed during planning.');
			return page.entries;
		}));
		check();
		const positions = structuredClone(header.positions), offsets = [0, 0, 0, 0];
		const rows: SyncPathObservation[] = [], flags: [string, number][] = [];
		const exclusions = spec.excludedPaths.map(syncPathKey);
		const included = (path: string) => !exclusions.some(p => syncPathKey(path) === p || syncPathKey(path).startsWith(p + '/'));
		let usedBytes = 0;
		while (rows.length < INVENTORY_PAGE_ENTRIES) {
			// A consumed page might have an unseen next key, so stop before choosing
			// another replica's head until every unfinished stream has a head.
			if (offsets.some((n, i) => n === pages[i].length && positions[i].read < header.totals[i])) break;
			const heads = pages.map((page, i) => page[offsets[i]] ?? null);
			const paths = heads.filter(Boolean).map(e => syncPathKey(e!.path)).sort();
			if (!paths.length) break;
			const pathKey = paths[0], entries = heads.map(e => e && syncPathKey(e.path) === pathKey ? e : null);
			const path = entries.find(Boolean)!.path;
			if (entries.some(e => e && e.path !== path)) throw Error('Case or Unicode filename collision requires review.');
			if (!sameSyncContent(entries[2], entries[3])) throw Error('Sync baseline must contain confirmed matching content.');
			const row: SyncPathObservation = { path, local: entries[0], remote: entries[1], beforeLocal: entries[2], beforeRemote: entries[3] };
			const rowFlags: [string, number][] = [];
			if (header.phase === 'indexing' && included(path)) for (let side = 0; side < 2; side++) {
				if (!entries[side] || sameSyncStamp(entries[side], entries[side + 2])) continue;
				const parts = path.split('/');
				for (let n = 1; n < parts.length; n++) rowFlags.push([syncPathKey(parts.slice(0, n).join('/')), side]);
			}
			const size = bytes(row) + bytes(rowFlags);
			if (usedBytes + size > INVENTORY_PAGE_BYTES) {
				if (!rows.length) throw Error('Sync plan row exceeds its byte bound.');
				break;
			}
			rows.push(row); flags.push(...rowFlags); usedBytes += size;
			entries.forEach((entry, i) => { if (entry) { offsets[i]++; positions[i] = { after: pathKey, read: positions[i].read + 1 }; } });
		}
		const finished = positions.every((p, i) => p.read === header.totals[i]);
		if (!rows.length && !finished) throw Error('Sync plan made no bounded progress.');
		return withHeader(spec, 'readwrite', (current, tx, done, fail) => {
			// Another tab may have committed this same page while we read it.
			if (current.revision !== header.revision) { done(progress(current)); return; }
			if (JSON.stringify(current) !== JSON.stringify(header)) throw Error('Sync plan progress changed.');
			const next: Header = { ...current, positions, revision: current.revision + 1 };
			if (!Number.isSafeInteger(next.revision)) throw Error('Sync plan revision exceeds its safe range.');
			const save = () => {
				check();
				if (finished && header.phase === 'planning') {
					if (next.planned !== next.indexed) throw Error('Sync plan ended before its validated count.');
					next.phase = 'complete'; unpin(spec, tx);
				}
				validate(next, spec); tx.objectStore(STORES[0]).put(next, [key, spec.id]); done(progress(next));
			};
			if (header.phase === 'indexing') {
				for (const [path, side] of flags) tx.objectStore(STORES[1]).put(true, [key, spec.id, path, side]);
				next.indexed += rows.length;
				if (finished) { next.phase = 'planning'; next.positions = initialPositions(); }
				save(); return;
			}
			next.planned += rows.length;
			const selected = rows.filter(row => included(row.path)); let pending = selected.length;
			if (!pending) { save(); return; }
			selected.forEach(row => {
				const below = [false, false]; let waiting = 2;
				[0, 1].forEach(side => {
					const request = tx.objectStore(STORES[1]).get([key, spec.id, syncPathKey(row.path), side]);
					request.onsuccess = () => { try {
						check(); below[side] = request.result === true;
						if (--waiting) return;
						let decision = decideSyncPath(row, spec.policy, below[0], below[1]);
						if (decision.kind === 'trash' && exclusions.some(p => p.startsWith(syncPathKey(row.path) + '/'))) decision = {
							kind: 'conflict', path: row.path, reason: 'excluded-descendants', local: row.local, remote: row.remote
						};
						tx.objectStore(STORES[2]).add(decision, [key, spec.id, syncPathKey(row.path)]); next.decisions++;
						if (--pending === 0) save();
					} catch (error) { fail(error); } };
				});
			});
		});
	}
	return {
		begin, step,
		async build(value: PagedPlanSpec, changed?: (value: PagedPlanProgress) => void): Promise<PagedPlanProgress> {
			const spec = parsePagedPlanSpec(value); let state = await begin(spec);
			while (state.phase !== 'complete') { state = await step(spec); changed?.(state); }
			return state;
		},
		async read(value: PagedPlanSpec, continuation?: PagedPlanCursor): Promise<{ decisions: SyncDecision[]; next: PagedPlanCursor | null; totalDecisions: number }> {
			const spec = parsePagedPlanSpec(value), token = continuation === undefined ? undefined : structuredClone(continuation);
			if (continuation !== undefined && (!token || token.id !== spec.id || !token.scope || !sameSyncScope(token.scope, scope) || !validSyncPathKey(token.after) || !Number.isSafeInteger(token.read) || token.read <= 0)) throw Error('Invalid sync plan continuation.');
			return withHeader(spec, 'readonly', (h, tx, done, fail) => {
				if (h.phase !== 'complete') throw Error('Sync plan is incomplete.');
				if (token && token.read >= h.decisions) throw Error('Invalid sync plan continuation count.');
				const request = tx.objectStore(STORES[2]).openCursor(range(spec.id, token?.after));
				const decisions: SyncDecision[] = []; let size = 2;
				request.onsuccess = () => { try {
					check(); const cursor = request.result;
					if (!cursor) {
						if ((token?.read ?? 0) + decisions.length !== h.decisions) throw Error('Sync decisions ended before their declared count.');
						done({ decisions, next: null, totalDecisions: h.decisions }); return;
					}
					const d: SyncDecision = cursor.value;
					if (!validDecision(d) || JSON.stringify(cursor.primaryKey) !== JSON.stringify([key, spec.id, syncPathKey(d.path)])) throw Error('Invalid saved sync decision.');
					const length = bytes(d) + 1;
					if (decisions.length === INVENTORY_PAGE_ENTRIES || size + length > INVENTORY_PAGE_BYTES) {
						if (!decisions.length) throw Error('Sync decision exceeds its byte bound.');
						done({ decisions, totalDecisions: h.decisions, next: { id: spec.id, scope: structuredClone(scope),
							after: syncPathKey(decisions.at(-1)!.path), read: (token?.read ?? 0) + decisions.length } }); return;
					}
					decisions.push(d); size += length; cursor.continue();
				} catch (error) { fail(error); } };
			});
		},
		async discard(value: PagedPlanSpec): Promise<void> {
			const spec = parsePagedPlanSpec(value);
			return withHeader(spec, 'readwrite', (_h, tx, done, fail) => {
				const pins = tx.objectStore(PLAN_PIN_STORE).count(range(spec.id));
				pins.onsuccess = () => { try {
				check(); if (pins.result) throw Error('Sync plan is pinned by a run.');
				unpin(spec, tx); tx.objectStore(STORES[0]).delete([key, spec.id]);
				for (const store of STORES.slice(1)) tx.objectStore(store).delete(range(spec.id));
				done(undefined);
				} catch (error) { fail(error); } };
			});
		}
	};
}

function validDecision(d: SyncDecision): boolean {
	if (!d || !validSyncPath(d.path)) return false;
	const entry = (e: unknown) => e !== null && typeof e === 'object' && validSyncEntry(e as any) && (e as any).path === d.path;
	if (d.kind === 'copy') return ['local', 'remote'].includes(d.from) && entry(d.source) && (d.expectedTarget === null || entry(d.expectedTarget));
	if (d.kind === 'trash') return ['local', 'remote'].includes(d.side) && entry(d.expected);
	if (d.kind !== 'conflict' && d.kind !== 'settled') return false;
	return (d.local === null || entry(d.local)) && (d.remote === null || entry(d.remote)) && (d.kind === 'settled' ||
		['both-changed', 'type-changed', 'delete-edit', 'deletion-disabled', 'destination-changed', 'excluded-descendants'].includes(d.reason));
}
