import { journalScope, type JournalAccess } from './journalScope';
import { JOURNAL_RETENTION_STORE, JOURNAL_KINDS, metadataKey, retireJournalMetadata, type JournalKind, type ManagedJournalMetadata } from './journalRetention';
import { INVENTORY_STORES, INVENTORY_PIN_STORE, INVENTORY_PAGE_ENTRIES, INVENTORY_PAGE_BYTES, inventoryIdentity, validateInventoryHeader, type InventoryHeader } from './inventoryJournal';
import { PLAN_STORES, PLAN_PIN_STORE, parsePagedPlanSpec, validatePagedPlanHeader, type PagedPlanHeader } from './pagedPlanJournal';
import { PAGED_RUN_STORES, PAGED_RUN_HEADS, RETAINED_HEADS, REVIEW_STORE, CLOUD_PARENTS, parsePagedRunSpec, validatePagedRunHeader, type PagedRunHeader } from './pagedRunJournal';
import { PAGED_CHECKPOINT_DRAFTS, validatePagedCheckpointHeader, type PagedCheckpointHeader } from './pagedCheckpointJournal';
import { PAGED_CHECKPOINT_HEADS, validatePagedCheckpointHead, type PagedCheckpointHead } from './checkpoint';
import { REVIEW_DRAFT_HEADS, REVIEW_DRAFT_STORES, parseReviewDraftSpec, validateReviewDraftHeader, type ReviewDraftHeader } from './pagedReviewDraft';

type Header = InventoryHeader | PagedPlanHeader | PagedRunHeader | PagedCheckpointHeader | ReviewDraftHeader;
export type MaintenanceCursor = { scope: string; kind: JournalKind; id: string; inclusive: boolean };
export type MaintenanceProgress = { examined: number; deleted: number; retired: number; done: boolean; next: MaintenanceCursor | null };
const headers = { inventory: INVENTORY_STORES[0], plan: PLAN_STORES[0], run: PAGED_RUN_STORES[0], checkpoint: PAGED_CHECKPOINT_DRAFTS, review: REVIEW_DRAFT_STORES[0] };
const children = { inventory: INVENTORY_STORES.slice(1), plan: PLAN_STORES.slice(1), run: [PAGED_RUN_STORES[1], REVIEW_STORE, CLOUD_PARENTS], checkpoint: [], review: REVIEW_DRAFT_STORES.slice(1) };
const stores = [...new Set([JOURNAL_RETENTION_STORE, ...Object.values(headers), ...Object.values(children).flat(), INVENTORY_PIN_STORE,
	PLAN_PIN_STORE, PAGED_RUN_HEADS, RETAINED_HEADS, PAGED_CHECKPOINT_HEADS, REVIEW_DRAFT_HEADS])];
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);

/** Called while the foreground owner holds its root lock. Only explicitly
 * managed observations/plans or fully handed-off runs are eligible. No bytes,
 * native receipts or canonical Timeline records live in these stores. */
export function journalMaintenance(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const { scope, key, check, range, transaction } = journalScope(db, access, keyRange), ranges = keyRange ?? globalThis.IDBKeyRange;
	const validate = (raw: Header, row: ManagedJournalMetadata) => {
		if (!raw || raw.scope !== key || raw.instance !== row.instance || (row.retiring ? raw.retired !== true : raw.retired !== undefined))
			throw Error('Managed sync metadata changed.');
		const h = { ...raw, retired: undefined };
		switch (row.kind) {
			case 'inventory': validateInventoryHeader(h as InventoryHeader, inventoryIdentity(h as InventoryHeader), key);
				if ((h as InventoryHeader).id !== row.id) throw Error('Managed inventory identity changed.'); break;
			case 'plan': { const p = h as PagedPlanHeader; validatePagedPlanHeader(p, parsePagedPlanSpec(p.spec), key);
				if (p.spec.id !== row.id) throw Error('Managed plan identity changed.'); break; }
			case 'run': { const r = h as PagedRunHeader; validatePagedRunHeader(r, parsePagedRunSpec(r.spec), scope);
				if (r.spec.id !== row.id) throw Error('Managed run identity changed.'); break; }
			case 'checkpoint': { const c = h as PagedCheckpointHeader; validatePagedCheckpointHeader(c, c.spec, key);
				if (c.spec.run.id !== row.id) throw Error('Managed checkpoint identity changed.'); break; }
			case 'review': { const d = h as ReviewDraftHeader; validateReviewDraftHeader(d, parseReviewDraftSpec(d.spec), key);
				if (d.spec.id !== row.id) throw Error('Managed review identity changed.'); break; }
		}
	};
	const step = async (after?: MaintenanceCursor): Promise<MaintenanceProgress> => {
		if (after && (after.scope !== key || !JOURNAL_KINDS.includes(after.kind) || !identifier(after.id) || typeof after.inclusive !== 'boolean'))
			throw Error('Invalid cleanup cursor.');
		return transaction(stores, 'readwrite', (tx, done, fail) => {
			const activePlans = new Set<string>(), activeInputs = new Set<string>();
			let active: string | undefined, retained: string | undefined, review: string | undefined, baseline: PagedCheckpointHead | undefined, ready = 4;
			const result: MaintenanceProgress = { examined: 0, deleted: 0, retired: 0, done: false, next: after ?? null };
			const get = <T>(store: string, id: IDBValidKey, next: (v: T) => void) => {
				const request = tx.objectStore(store).get(id);
				request.onsuccess = () => { try { check(); next(request.result); } catch (e) { fail(e); } };
			};
			const count = (store: string, id: string, next: (n: number) => void) => {
				const request = tx.objectStore(store).count(range(id));
				request.onsuccess = () => { try { check(); next(request.result); } catch (e) { fail(e); } };
			};
			const eligible = (row: ManagedJournalMetadata, h: Header, next: (yes: boolean) => void) => {
				switch (row.kind) {
					case 'inventory':
						if (activeInputs.has(row.id)) { next(false); return; }
						if (baseline && [baseline.baseline.local.id, baseline.baseline.remote.id].includes(row.id)) { next(false); return; }
						count(INVENTORY_PIN_STORE, row.id, n => next(n === 0)); return;
					case 'plan': if (activePlans.has(row.id)) { next(false); return; } count(PLAN_PIN_STORE, row.id, n => next(n === 0)); return;
					case 'review': next(row.id !== review && h.phase === 'released'); return;
					case 'checkpoint': next(row.id !== active && row.id !== baseline?.runId && h.phase === 'published'); return;
					case 'run': {
						const run = h as PagedRunHeader;
						if (row.id === active || row.id === retained || row.id === baseline?.runId || run.phase !== 'complete') { next(false); return; }
						if (row.retiring || run.retained) { next(true); return; }
						get<PagedCheckpointHeader | undefined>(PAGED_CHECKPOINT_DRAFTS, [key, row.id], c => {
							if (!c) { next(false); return; }
							validatePagedCheckpointHeader(c, c.spec, key);
							next(c.phase === 'published' && c.spec.run.id === row.id && c.runInstance === run.instance);
						}); return;
					}
				}
			};
			const purge = (row: ManagedJournalMetadata, h: Header) => {
				if (!row.retiring) {
					if (row.kind === 'plan') {
						const s = (h as PagedPlanHeader).spec;
						for (const capture of [s.local, s.remote, s.baseline.local, s.baseline.remote])
							tx.objectStore(INVENTORY_PIN_STORE).delete([key, capture.id, s.id]);
					}
					retireJournalMetadata(tx, key, row.kind, row.id, headers[row.kind], h);
					row.retiring = true; result.retired++;
				}
				let bytes = 4096;
				const finishPage = () => {
					tx.objectStore(JOURNAL_RETENTION_STORE).put(row, metadataKey(key, row.kind, row.id));
					result.next = { scope: key, kind: row.kind, id: row.id, inclusive: true }; done(result);
				};
				const remove = () => {
					check();
					if (row.store === children[row.kind].length) {
						tx.objectStore(headers[row.kind]).delete([key, row.id]);
						tx.objectStore(JOURNAL_RETENTION_STORE).delete(metadataKey(key, row.kind, row.id));
						result.next = { scope: key, kind: row.kind, id: row.id, inclusive: false }; done(result); return;
					}
					const store = tx.objectStore(children[row.kind][row.store]);
					// Start each page at its first remaining key. Reopening the entire
					// retired prefix can repeatedly traverse tombstones in an index.
					const seek = store.getKey(range(row.id));
					seek.onsuccess = () => { try {
						check();
						if (seek.result === undefined) { row.store++; remove(); return; }
						visit(seek.result);
					} catch (e) { fail(e); } };
					const visit = (lower: IDBValidKey) => {
						const request = store.openKeyCursor(ranges.bound(lower, [key, row.id, []]));
						let first: IDBValidKey | undefined, last: IDBValidKey | undefined;
						// The cursor is already confined to this retired scoped record.
						// Delete one contiguous bounded page, avoiding a separate delete
						// request for every key in a large obsolete capture.
						const flush = () => { if (first !== undefined) store.delete(ranges.bound(first, last!)); };
						request.onsuccess = () => { try {
							check(); const cursor = request.result;
							if (!cursor) { flush(); row.store++; remove(); return; }
							const size = new TextEncoder().encode(JSON.stringify(cursor.primaryKey)).length;
							if (size + 4096 > INVENTORY_PAGE_BYTES) throw Error('Cleanup key exceeds its byte bound.');
							if (result.deleted === INVENTORY_PAGE_ENTRIES || bytes + size > INVENTORY_PAGE_BYTES) { flush(); finishPage(); return; }
							first ??= cursor.primaryKey; last = cursor.primaryKey; result.deleted++; bytes += size; cursor.continue();
						} catch (e) { fail(e); } };
					};
				};
				remove();
			};
			const scanRows = () => {
				const selection = ranges.bound(after ? metadataKey(key, after.kind, after.id) : [key], [key, []], after ? !after.inclusive : false);
				const request = tx.objectStore(JOURNAL_RETENTION_STORE).openCursor(selection);
				request.onsuccess = () => { try {
					check(); const cursor = request.result;
					if (!cursor) { done({ ...result, done: true, next: null }); return; }
					if (result.examined === INVENTORY_PAGE_ENTRIES) { done(result); return; }
					const row: ManagedJournalMetadata = cursor.value;
					if (!row || row.scope !== key || !JOURNAL_KINDS.includes(row.kind) || !identifier(row.id) || !identifier(row.instance) ||
						typeof row.retiring !== 'boolean' || !Number.isInteger(row.store) || row.store < 0 || row.store > children[row.kind].length ||
						(!row.retiring && row.store !== 0) || JSON.stringify(cursor.primaryKey) !== JSON.stringify(metadataKey(key, row.kind, row.id)))
						throw Error('Invalid managed sync metadata.');
					result.examined++;
					get<Header>(headers[row.kind], [key, row.id], h => {
						validate(h, row);
						eligible(row, h, yes => {
							if (yes) { purge(row, h); return; }
							if (row.retiring) throw Error('Retired sync metadata acquired a new consumer.');
							result.next = { scope: key, kind: row.kind, id: row.id, inclusive: false }; cursor.continue();
						});
					});
				} catch (e) { fail(e); } };
			};
			const scanRun = () => {
				if (!active) { scanRows(); return; }
				// Root ownership protects recovery even if a pin index is damaged.
				get<PagedRunHeader>(PAGED_RUN_STORES[0], [key, active], run => {
					validatePagedRunHeader(run, parsePagedRunSpec(run?.spec), scope);
					if (run.spec.id !== active) throw Error('Active sync run identity changed.');
					const plan = run.spec.plan; activePlans.add(plan.id);
					for (const input of [plan.local, plan.remote, plan.baseline.local, plan.baseline.remote]) activeInputs.add(input.id);
					get<PagedCheckpointHeader | undefined>(PAGED_CHECKPOINT_DRAFTS, [key, active], draft => {
						if (draft) {
							validatePagedCheckpointHeader(draft, draft.spec, key);
							if (draft.runInstance !== run.instance || JSON.stringify(draft.spec.run) !== JSON.stringify(run.spec)) throw Error('Active checkpoint changed.');
							for (const input of [draft.after.local, draft.after.remote, draft.baseline.local, draft.baseline.remote]) activeInputs.add(input.id);
						}
						scanRows();
					});
				});
			};
			const scan = () => {
				if (--ready) return;
				if (!review) { scanRun(); return; }
				get<ReviewDraftHeader>(REVIEW_DRAFT_STORES[0], [key, review], draft => {
					validateReviewDraftHeader(draft, parseReviewDraftSpec(draft?.spec), key);
					if (draft.spec.id !== review || draft.phase === 'released') throw Error('Active conflict review changed.');
					const p = draft.spec.plan; activePlans.add(p.id);
					for (const input of [p.local, p.remote, p.baseline.local, p.baseline.remote]) activeInputs.add(input.id);
					scanRun();
				});
			};
			get<string | undefined>(PAGED_RUN_HEADS, key, value => { if (value !== undefined && !identifier(value)) throw Error('Invalid active sync identity.'); active = value; scan(); });
			get<string | undefined>(RETAINED_HEADS, key, value => { if (value !== undefined && !identifier(value)) throw Error('Invalid retained sync identity.'); retained = value; scan(); });
			get<PagedCheckpointHead | undefined>(PAGED_CHECKPOINT_HEADS, key, value => { if (value) validatePagedCheckpointHead(value, key); baseline = value; scan(); });
			get<string | undefined>(REVIEW_DRAFT_HEADS, key, value => { if (value !== undefined && !identifier(value)) throw Error('Invalid active review identity.'); review = value; scan(); });
		});
	};
	return { step, async collect(changed?: (p: MaintenanceProgress) => void) {
		let next: MaintenanceCursor | undefined; const totals = { examined: 0, deleted: 0, retired: 0 };
		for (;;) { const p = await step(next); check(); totals.examined += p.examined; totals.deleted += p.deleted; totals.retired += p.retired;
			changed?.(p); if (p.done) return totals; next = p.next!; }
	} };
}
