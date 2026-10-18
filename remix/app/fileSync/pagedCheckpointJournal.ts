import { advanceSyncBaselinePair, PAGED_CHECKPOINT_HEADS, validatePagedCheckpointHead, type PagedCheckpointHead } from './checkpoint';
import { inventoryJournal, inventoryIdentity, newInventoryHeader, INVENTORY_PAGE_BYTES, INVENTORY_PAGE_ENTRIES, INVENTORY_PIN_STORE,
	INVENTORY_STORES, validateInventoryHeader, type InventoryHeader, type InventoryIdentity } from './inventoryJournal';
import { journalScope, type JournalAccess } from './journalScope';
import { PLAN_PIN_STORE, PLAN_STORES, validatePagedPlanHeader, type PagedPlanHeader } from './pagedPlanJournal';
import { PAGED_RUN_HEADS, PAGED_RUN_STORES, pagedRunJournal, parsePagedRunSpec, validatePagedRunHeader, type PagedRunHeader, type PagedRunSpec } from './pagedRunJournal';
import { sameSyncContent, syncPathKey, validSyncPathKey, type SyncEntry } from './reconcile';

export const PAGED_CHECKPOINT_DRAFTS = 'sync-paged-checkpoint-drafts';
export type PagedCheckpointSpec = { run: PagedRunSpec; localRootId: string; remoteFolderId: string };
type Pair = { local: InventoryIdentity; remote: InventoryIdentity };
type Position = { after: string | null; read: number };
export type PagedCheckpointProgress = { phase: 'collecting' | 'building' | 'sealing' | 'published'; paths: number; entries: number; pages: number };
type Header = PagedCheckpointProgress & { spec: PagedCheckpointSpec; scope: string; instance: string; runInstance: string;
	after: Pair; baseline: Pair; instances: string[]; previous: string | null; positions: Position[]; totals: number[]; revision: number };
export type PagedCheckpointState = PagedCheckpointProgress & { after: Pair; baseline: Pair };
const stores = [PAGED_CHECKPOINT_DRAFTS, PAGED_CHECKPOINT_HEADS, PAGED_RUN_HEADS, ...PAGED_RUN_STORES, PLAN_STORES[0], PLAN_PIN_STORE, INVENTORY_STORES[0], INVENTORY_PIN_STORE];
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const nonnegative = (v: number) => Number.isSafeInteger(v) && v >= 0;
const original = (s: PagedCheckpointSpec) => [s.run.plan.local, s.run.plan.remote, s.run.plan.baseline.local, s.run.plan.baseline.remote];
const owned = (h: Header) => [h.after.local, h.after.remote, h.baseline.local, h.baseline.remote];
const state = (h: Header): PagedCheckpointState => structuredClone({ phase: h.phase, paths: h.paths, entries: h.entries, pages: h.pages, after: h.after, baseline: h.baseline });
const specification = (s: PagedCheckpointSpec): PagedCheckpointSpec => {
	if (!s || !identifier(s.localRootId) || !identifier(s.remoteFolderId)) throw Error('Invalid checkpoint roots.');
	return { run: parsePagedRunSpec(s.run), localRootId: s.localRootId, remoteFolderId: s.remoteFolderId };
};

export function upgradePagedCheckpointJournal(db: IDBDatabase) {
	for (const name of [PAGED_CHECKPOINT_DRAFTS, PAGED_CHECKPOINT_HEADS]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
}

/** Resume a five-stream merge: post-run observations, previous baseline, and
 * confirmed effects. Only sealed, validated output is published. This journal
 * holds observations and receipts; it never writes files or grants authority. */
export function pagedCheckpointJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const { scope, key, check, transaction } = journalScope(db, access, keyRange);
	const inventory = inventoryJournal(db, access, keyRange), runs = pagedRunJournal(db, access, keyRange);
	const headValue = (h: Header): PagedCheckpointHead => ({ version: 1, scope: key, instance: h.instance, runId: h.spec.run.id,
		localRootId: h.spec.localRootId, remoteFolderId: h.spec.remoteFolderId, baseline: h.baseline });
	const validate = (h: Header, spec: PagedCheckpointSpec) => {
		if (!h || h.scope !== key || JSON.stringify(h.spec) !== JSON.stringify(spec) || !identifier(h.instance) || !identifier(h.runInstance) ||
			!['collecting', 'building', 'sealing', 'published'].includes(h.phase) || ![h.paths, h.entries, h.pages, h.revision].every(nonnegative) ||
			h.entries > h.paths || (h.previous !== null && !identifier(h.previous)) || !h.after || !h.baseline ||
			!Array.isArray(h.instances) || h.instances.length !== 4 || !h.instances.every(identifier) ||
			!Array.isArray(h.positions) || h.positions.length !== 5 || !Array.isArray(h.totals) || h.totals.length !== 5 || !h.totals.every(nonnegative) ||
			h.positions.some((p, i) => !p || !nonnegative(p.read) || p.read > h.totals[i] || (p.read === 0 ? p.after !== null : !validSyncPathKey(p.after))) ||
			(['sealing', 'published'].includes(h.phase) && h.positions.some((p, i) => p.read !== h.totals[i])) ||
			(h.phase === 'collecting' && (h.paths || h.pages || h.entries || h.positions.some(p => p.read)))) throw Error('Checkpoint progress changed.');
		const captures = owned(h).map(inventoryIdentity);
		if (new Set(captures.map(c => c.id)).size !== 4 || captures.some((c, i) => c.source !== (i % 2 ? 'remote' : 'local'))) throw Error('Checkpoint capture identity changed.');
		validatePagedCheckpointHead(headValue(h), key);
	};
	const get = <T>(tx: IDBTransaction, store: string, id: IDBValidKey, done: (value: T) => void, fail: (e: unknown) => void) => {
		const request = tx.objectStore(store).get(id);
		request.onsuccess = () => { try { check(); done(request.result); } catch (e) { fail(e); } };
	};
	const context = (tx: IDBTransaction, spec: PagedCheckpointSpec, done: (run: PagedRunHeader, plan: PagedPlanHeader, captures: InventoryHeader[]) => void, fail: (e: unknown) => void) => {
		get<string>(tx, PAGED_RUN_HEADS, key, active => {
			if (active !== spec.run.id) throw Error('Resume the active paged sync run.');
			get<PagedRunHeader>(tx, PAGED_RUN_STORES[0], [key, spec.run.id], run => {
				validatePagedRunHeader(run, spec.run, scope);
				if (run.phase !== 'complete') throw Error('Complete the sync run before capturing its checkpoint.');
				get<PagedPlanHeader>(tx, PLAN_STORES[0], [key, spec.run.plan.id], plan => {
					validatePagedPlanHeader(plan, spec.run.plan, key);
					if (plan.phase !== 'complete' || plan.instance !== run.planInstance || !plan.inputInstances) throw Error('Original checkpoint inputs are unavailable.');
					const captures: InventoryHeader[] = []; let pending = 4;
					original(spec).forEach((capture, i) => get<InventoryHeader>(tx, INVENTORY_STORES[0], [key, capture.id], header => {
						validateInventoryHeader(header, capture, key);
						if (header.phase !== 'complete' || header.instance !== plan.inputInstances![i]) throw Error('Checkpoint input was replaced.');
						captures[i] = header; if (!--pending) done(run, plan, captures);
					}, fail));
				}, fail);
			}, fail);
		}, fail);
	};
	const withHeader = <T>(spec: PagedCheckpointSpec, mode: IDBTransactionMode,
		work: (h: Header, tx: IDBTransaction, done: (v: T) => void, fail: (e: unknown) => void, captures: InventoryHeader[]) => void) =>
		transaction<T>(stores, mode, (tx, done, fail) => get<Header>(tx, PAGED_CHECKPOINT_DRAFTS, [key, spec.run.id], h => {
			validate(h, spec);
			if (h.phase === 'published') { work(h, tx, done, fail, []); return; }
			context(tx, spec, (run) => {
				if (run.instance !== h.runInstance) throw Error('Checkpoint run was replaced.');
				const captures: InventoryHeader[] = []; let pending = 4;
				owned(h).forEach((capture, i) => get<InventoryHeader>(tx, INVENTORY_STORES[0], [key, capture.id], header => {
					validateInventoryHeader(header, capture, key);
					if (header.instance !== h.instances[i]) throw Error('Checkpoint capture was replaced.');
					captures[i] = header; if (!--pending) work(h, tx, done, fail, captures);
				}, fail));
			}, fail);
		}, fail));
	const save = (h: Header, tx: IDBTransaction) => { validate(h, h.spec); tx.objectStore(PAGED_CHECKPOINT_DRAFTS).put(h, [key, h.spec.run.id]); };
	const begin = async (value: PagedCheckpointSpec): Promise<PagedCheckpointState> => {
		const spec = specification(value);
		return transaction(stores, 'readwrite', (tx, done, fail) => get<Header | undefined>(tx, PAGED_CHECKPOINT_DRAFTS, [key, spec.run.id], existing => {
			if (existing) { validate(existing, spec); done(state(existing)); return; }
			context(tx, spec, (run, _plan, inputs) => get<PagedCheckpointHead | undefined>(tx, PAGED_CHECKPOINT_HEADS, key, previous => {
				if (previous) {
					validatePagedCheckpointHead(previous, key);
					if (previous.localRootId !== spec.localRootId || previous.remoteFolderId !== spec.remoteFolderId ||
						JSON.stringify(previous.baseline) !== JSON.stringify(spec.run.plan.baseline)) throw Error('Checkpoint roots or prior baseline changed.');
				}
				const captures = Array.from({ length: 4 }, (_, i) => newInventoryHeader({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source: i % 2 ? 'remote' : 'local' }, key));
				const pair = (start: number): Pair => ({ local: inventoryIdentity(captures[start]), remote: inventoryIdentity(captures[start + 1]) });
				const h: Header = { spec, scope: key, instance: crypto.randomUUID(), runInstance: run.instance, phase: 'collecting', paths: 0, entries: 0, pages: 0,
					after: pair(0), baseline: pair(2), instances: captures.map(c => c.instance!), previous: previous?.instance ?? null,
					positions: Array.from({ length: 5 }, () => ({ after: null, read: 0 })), totals: [0, 0, inputs[2].entries, inputs[3].entries, run.operations], revision: 0 };
				for (const capture of captures) {
					tx.objectStore(INVENTORY_STORES[0]).add(capture, [key, capture.id]);
					tx.objectStore(INVENTORY_PIN_STORE).add(true, [key, capture.id, spec.run.id, 'checkpoint']);
				}
				save(h, tx); done(state(h));
			}, fail), fail);
		}, fail));
	};
	const step = async (value: PagedCheckpointSpec): Promise<PagedCheckpointState> => {
		const spec = specification(value);
		const h = await withHeader<Header>(spec, 'readwrite', (h, tx, done, _fail, captures) => {
			if (h.phase === 'collecting') {
				if (captures.slice(0, 2).some(c => c.phase !== 'complete')) throw Error('Complete both post-run inventory captures before building the checkpoint.');
				h.totals[0] = captures[0].entries; h.totals[1] = captures[1].entries; h.phase = 'building'; h.revision++; save(h, tx);
			}
			done(h);
		});
		if (h.phase === 'published') return state(h);
		if (h.phase === 'sealing') {
			await inventory.seal(h.baseline.local); await inventory.seal(h.baseline.remote);
			return withHeader(spec, 'readwrite', (current, tx, done, fail, captures) => {
				if (current.phase === 'published') { done(state(current)); return; }
				if (current.instance !== h.instance || current.revision !== h.revision || current.phase !== 'sealing' ||
					captures.slice(2).some(c => c.phase !== 'complete' || c.entries !== h.entries)) throw Error('Checkpoint output is not sealed.');
				get<PagedCheckpointHead | undefined>(tx, PAGED_CHECKPOINT_HEADS, key, previous => {
					if (previous) validatePagedCheckpointHead(previous, key);
					if ((previous?.instance ?? null) !== h.previous) throw Error('Published checkpoint changed.');
					if (previous) for (const capture of [previous.baseline.local, previous.baseline.remote])
						tx.objectStore(INVENTORY_PIN_STORE).delete([key, capture.id, previous.instance, 'baseline']);
					for (const capture of [h.baseline.local, h.baseline.remote]) tx.objectStore(INVENTORY_PIN_STORE).put(true, [key, capture.id, h.instance, 'baseline']);
					for (const capture of owned(h)) tx.objectStore(INVENTORY_PIN_STORE).delete([key, capture.id, spec.run.id, 'checkpoint']);
					for (const capture of original(spec)) tx.objectStore(INVENTORY_PIN_STORE).delete([key, capture.id, spec.run.id, 'run']);
					tx.objectStore(PLAN_PIN_STORE).delete([key, spec.run.plan.id, spec.run.id]);
					tx.objectStore(PAGED_RUN_HEADS).delete(key);
					tx.objectStore(PAGED_CHECKPOINT_HEADS).put(headValue(h), key);
					current.phase = 'published'; current.revision++; save(current, tx); done(state(current));
				}, fail);
			});
		}
		const identities = [h.after.local, h.after.remote, spec.run.plan.baseline.local, spec.run.plan.baseline.remote];
		const pages = await Promise.all(identities.map(async (capture, i) => {
			const p = h.positions[i]; if (p.read === h.totals[i]) return [];
			const page = await inventory.read(capture, p.after === null ? undefined : { ...capture, scope, after: p.after, read: p.read });
			if (page.totalEntries !== h.totals[i]) throw Error('Checkpoint inventory count changed.');
			return page.entries;
		}));
		const p = h.positions[4], effects = p.read === h.totals[4] ? [] : await runs.readConfirmed(spec.run, p.after === null ? undefined :
			{ id: spec.run.id, instance: h.runInstance, scope, after: p.after, read: p.read }).then(page => {
				if (page.total !== h.totals[4]) throw Error('Checkpoint receipt count changed.'); return page.rows;
			});
		check();
		const positions = structuredClone(h.positions), offsets = [0, 0, 0, 0, 0], output: [SyncEntry[], SyncEntry[]] = [[], []];
		const lengths = [...pages.map(page => page.length), effects.length]; let paths = 0, size = 4096;
		while (paths < INVENTORY_PAGE_ENTRIES) {
			if (offsets.some((n, i) => n === lengths[i] && positions[i].read < h.totals[i])) break;
			const heads = pages.map((page, i) => page[offsets[i]] ?? null), effect = effects[offsets[4]] ?? null;
			const names = [...heads.map(e => e?.path ?? null), effect?.operation.mutation.path ?? null];
			const keys = names.filter((n): n is string => n !== null).map(syncPathKey).sort(); if (!keys.length) break;
			const pathKey = keys[0], included = names.map(name => name !== null && syncPathKey(name) === pathKey);
			const path = names[included.indexOf(true)]!;
			if (names.some((name, i) => included[i] && name !== path)) throw Error('Case or Unicode filename collision requires review.');
			const entries = heads.map((entry, i) => included[i] ? entry : null);
			if (!sameSyncContent(entries[2], entries[3])) throw Error('Checkpoint baseline must contain matching content.');
			let prior = entries[2] && entries[3] ? { path, local: entries[2], remote: entries[3] } : null;
			if (included[4]) {
				const m = effect!.operation.mutation, receipt = effect!.receipt;
				prior = m.kind === 'trash' ? null : { path, local: m.from === 'local' ? m.source : receipt.entry!, remote: m.from === 'remote' ? m.source : receipt.entry! };
			}
			const next = advanceSyncBaselinePair(prior, entries[0], entries[1]);
			const bytes = new TextEncoder().encode(JSON.stringify([entries, included[4] ? effect : null, next])).length;
			if (size + bytes > INVENTORY_PAGE_BYTES) { if (!paths) throw Error('Checkpoint row exceeds its byte bound.'); break; }
			if (next) { output[0].push(next.local); output[1].push(next.remote); }
			size += bytes; paths++;
			included.forEach((yes, i) => { if (yes) { offsets[i]++; positions[i] = { after: pathKey, read: positions[i].read + 1 }; } });
		}
		const finished = positions.every((p, i) => p.read === h.totals[i]);
		if (!paths && !finished) throw Error('Checkpoint made no bounded progress.');
		const append = !!output[0].length || finished;
		// A crash between these writes replays the exact page ordinal/digest.
		// The cursor advances only after both copies are durable.
		if (append) for (const [i, capture] of [h.baseline.local, h.baseline.remote].entries()) await inventory.append(capture,
			{ ordinal: h.pages, entries: output[i], ...(finished ? { totalEntries: h.entries + output[i].length } : {}) });
		return withHeader(spec, 'readwrite', (current, tx, done) => {
			if (current.instance !== h.instance) throw Error('Checkpoint was replaced.');
			if (current.revision !== h.revision) { done(state(current)); return; }
			if (JSON.stringify(current) !== JSON.stringify(h)) throw Error('Checkpoint progress changed.');
			const next: Header = { ...h, positions, revision: h.revision + 1, paths: h.paths + paths, entries: h.entries + output[0].length,
				pages: h.pages + Number(append), phase: finished ? 'sealing' : 'building' };
			save(next, tx); done(state(next));
		});
	};
	return {
		begin, step,
		async build(value: PagedCheckpointSpec, changed?: (progress: PagedCheckpointState) => void): Promise<PagedCheckpointState> {
			const spec = specification(value); let result = await begin(spec);
			while (result.phase !== 'published') { result = await step(spec); changed?.(result); }
			return result;
		},
		async current(): Promise<PagedCheckpointHead | null> {
			return transaction(stores, 'readonly', (tx, done, fail) => get<PagedCheckpointHead | undefined>(tx, PAGED_CHECKPOINT_HEADS, key, head => {
				if (!head) { done(null); return; } validatePagedCheckpointHead(head, key); done(head);
			}, fail));
		}
	};
}
