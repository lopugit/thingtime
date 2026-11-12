import { canRetainFileConflicts, conflictCopySides, type SyncConflict } from './conflictResolution';
import { INVENTORY_PIN_STORE, INVENTORY_PAGE_BYTES, INVENTORY_PAGE_ENTRIES, INVENTORY_STORES, validateInventoryHeader, type InventoryHeader } from './inventoryJournal';
import { journalScope, type JournalAccess } from './journalScope';
import { JOURNAL_RETENTION_STORE, metadataKey, registerJournalMetadata } from './journalRetention';
import { pagedPlanJournal, provesConflictFreeInitialUpload, PLAN_PIN_STORE, PLAN_STORES, validSyncDecision, validatePagedPlanHeader, type PagedPlanHeader, type PagedPlanCursor } from './pagedPlanJournal';
import { parsePagedRunSpec, type PagedRunSpec } from './pagedRunJournal';
import { parseReviewedConflict, type PagedRunReview, type ReviewedSyncConflict } from './pagedRunReview';
import { sameSyncScope, syncScopeKey, syncPathKey, validSyncPath, validSyncPathKey, type SyncScope, type SyncSide } from './reconcile';

export const REVIEW_DRAFT_HEADS = 'sync-review-draft-heads';
export const REVIEW_DRAFT_STORES = ['sync-review-drafts', 'sync-review-draft-choices'] as const;
export type ReviewDraftSpec = Required<Pick<PagedRunSpec, 'id' | 'plan' | 'configuration'>>;
export type ReviewDraftProgress = {
	phase: 'indexing' | 'reviewing' | 'sealed' | 'released';
	read: number; total: number; count: number; selected: number; blocked: number; retentionBlocked: number; revision: number;
	kind?: PagedRunReview['kind'];
};
export type ReviewDraftHeader = ReviewDraftProgress & {
	spec: ReviewDraftSpec; scope: string; instance: string; planInstance: string; retired?: true; next: PagedPlanCursor | null;
};
export type ReviewDraftRow = { conflict: SyncConflict; from: SyncSide | null; revision: number };
export type ReviewDraftCursor = { id: string; instance: string; scope: SyncScope; after: string; read: number; direction?: 'previous' };
const stores = [JOURNAL_RETENTION_STORE, ...REVIEW_DRAFT_STORES, REVIEW_DRAFT_HEADS, PLAN_STORES[0], PLAN_PIN_STORE, INVENTORY_PIN_STORE, INVENTORY_STORES[0]];
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
const inputs = (s: ReviewDraftSpec) => [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote];
const progress = ({ phase, read, total, count, selected, blocked, retentionBlocked, revision, kind }: ReviewDraftHeader): ReviewDraftProgress =>
	({ phase, read, total, count, selected, blocked, retentionBlocked, revision, ...(kind ? { kind } : {}) });

export function parseReviewDraftSpec(value: ReviewDraftSpec): ReviewDraftSpec {
	const s = parsePagedRunSpec(value);
	if (!s.configuration || s.review) throw Error('A conflict review draft requires its exact settings.');
	return { id: s.id, plan: s.plan, configuration: s.configuration };
}

export function validateReviewDraftHeader(h: ReviewDraftHeader, spec: ReviewDraftSpec, key: string) {
	if (!h || h.retired !== undefined || h.scope !== key || !identifier(h.instance) || !identifier(h.planInstance) ||
		JSON.stringify(h.spec) !== JSON.stringify(spec) || !['indexing', 'reviewing', 'sealed', 'released'].includes(h.phase) ||
		![h.read, h.total, h.count, h.selected, h.blocked, h.retentionBlocked, h.revision].every(count) ||
		h.read > h.total || h.count > h.read || h.selected + h.blocked > h.count || h.retentionBlocked > h.count ||
		(h.next !== null && (!h.next || !h.next.scope || syncScopeKey(h.next.scope) !== key || h.next.id !== spec.plan.id || !validSyncPathKey(h.next.after) || h.next.read !== h.read)) ||
		(h.phase === 'indexing' && (h.selected !== 0 || h.kind !== undefined)) ||
		(h.phase === 'indexing' && h.read > 0 && (h.read >= h.total || h.next === null)) ||
		(['reviewing', 'sealed'].includes(h.phase) && (h.read !== h.total || h.next !== null)) ||
		(h.phase === 'reviewing' && h.kind !== undefined) ||
		(h.kind !== undefined && !['resolve', 'retain'].includes(h.kind)) ||
		(h.phase === 'sealed' && (!h.count || !h.kind || (h.kind === 'resolve' ? h.selected !== h.count : h.retentionBlocked !== 0))))
		throw Error('Conflict review draft changed or is unavailable.');
}

export function upgradeReviewDraftJournal(db: IDBDatabase) {
	for (const store of [...REVIEW_DRAFT_STORES, REVIEW_DRAFT_HEADS]) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
}

/** Durable user choices over one immutable plan. These are neither permission
 * nor executable operations. A consumer must import sealed pages into a fresh
 * run and prepare its entire plan before any transfer can start. */
export function reviewDraftJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const { scope, key, check, range, transaction } = journalScope(db, access, keyRange), plans = pagedPlanJournal(db, access, keyRange);
	const validate = (h: ReviewDraftHeader, s: ReviewDraftSpec) => {
		validateReviewDraftHeader(h, s, key);
		if (s.configuration.deviceId !== scope.deviceId || (h.next && !sameSyncScope(h.next.scope, scope))) throw Error('Conflict review scope changed.');
	};
	const withHeader = <T>(s: ReviewDraftSpec, mode: IDBTransactionMode,
		work: (h: ReviewDraftHeader, tx: IDBTransaction, done: (value: T) => void, fail: (error: unknown) => void) => void) =>
		transaction<T>(stores, mode, (tx, done, fail) => {
			const head = tx.objectStore(REVIEW_DRAFT_HEADS).get(key);
			head.onsuccess = () => { try {
				check(); if (head.result !== s.id) throw Error('Conflict review is no longer active.');
				const request = tx.objectStore(REVIEW_DRAFT_STORES[0]).get([key, s.id]);
				request.onsuccess = () => { try {
					check(); const h: ReviewDraftHeader = request.result; validate(h, s);
					if (h.phase === 'released') throw Error('Conflict review is no longer active.');
					const plan = tx.objectStore(PLAN_STORES[0]).get([key, s.plan.id]);
					plan.onsuccess = () => { try {
						check(); const p: PagedPlanHeader = plan.result; validatePagedPlanHeader(p, s.plan, key);
						if (p.phase !== 'complete' || p.instance !== h.planInstance || p.decisions !== h.total) throw Error('Reviewed plan changed.');
						work(h, tx, done, fail);
					} catch (e) { fail(e); } };
				} catch (e) { fail(e); } };
			} catch (e) { fail(e); } };
		});
	const save = (h: ReviewDraftHeader, tx: IDBTransaction) => {
		validate(h, h.spec); tx.objectStore(REVIEW_DRAFT_STORES[0]).put(h, [key, h.spec.id]);
	};
	const row = (value: ReviewDraftRow, s: ReviewDraftSpec): ReviewDraftRow => {
		if (!value || !count(value.revision) || (value.from !== null && !['local', 'remote'].includes(value.from))) throw Error('Invalid saved conflict choice.');
		// Unselectable folder/deletion conflicts must remain visible. The plan's
		// canonical decision validator checks their stamps while indexing.
		if (!validSyncDecision(value.conflict) || value.conflict.kind !== 'conflict') throw Error('Invalid saved conflict row.');
		if (value.from !== null) parseReviewedConflict(value as ReviewedSyncConflict, { id: s.id, kind: 'resolve', count: 1 }, s.plan.policy.mode, scope);
		return value;
	};
	const begin = async (value: ReviewDraftSpec): Promise<ReviewDraftProgress> => {
		const s = parseReviewDraftSpec(value);
		return transaction(stores, 'readwrite', (tx, done, fail) => {
			const head = tx.objectStore(REVIEW_DRAFT_HEADS).get(key);
			head.onsuccess = () => { try {
				check(); if (head.result !== undefined && head.result !== s.id) throw Error('Resume or release the existing conflict review first.');
				const get = tx.objectStore(REVIEW_DRAFT_STORES[0]).get([key, s.id]);
				get.onsuccess = () => { try {
					check(); const existing: ReviewDraftHeader | undefined = get.result;
					if (existing) { validate(existing, s); if (head.result !== s.id || existing.phase === 'released') throw Error('Conflict review identity was already used.'); }
					const plan = tx.objectStore(PLAN_STORES[0]).get([key, s.plan.id]);
					plan.onsuccess = () => { try {
						check(); const p: PagedPlanHeader = plan.result; validatePagedPlanHeader(p, s.plan, key);
						if (p.phase !== 'complete' || !p.inputInstances || (existing && (existing.planInstance !== p.instance || existing.total !== p.decisions))) throw Error('A conflict review requires a complete unchanged plan.');
						if (existing) { done(progress(existing)); return; }
						const conflictFree = provesConflictFreeInitialUpload(p, s.plan, key);
						const h: ReviewDraftHeader = { spec: s, scope: key, instance: crypto.randomUUID(), planInstance: p.instance,
							phase: conflictFree ? 'reviewing' : 'indexing', read: conflictFree ? p.decisions : 0, total: p.decisions, count: 0, selected: 0, blocked: 0, retentionBlocked: 0, revision: 0, next: null };
						let remaining = 4;
						inputs(s).forEach((input, i) => {
							const get = tx.objectStore(INVENTORY_STORES[0]).get([key, input.id]);
							get.onsuccess = () => { try {
								check(); const capture: InventoryHeader = get.result; validateInventoryHeader(capture, input, key);
								if (capture.phase !== 'complete' || capture.instance !== p.inputInstances![i] || capture.entries !== p.totals[i]) throw Error('Reviewed inventory changed.');
								tx.objectStore(INVENTORY_PIN_STORE).put(true, [key, input.id, s.id, 'review']);
								if (--remaining) return;
								validate(h, s); tx.objectStore(REVIEW_DRAFT_STORES[0]).add(h, [key, s.id]);
								tx.objectStore(REVIEW_DRAFT_HEADS).put(s.id, key);
								tx.objectStore(PLAN_PIN_STORE).put(true, [key, s.plan.id, s.id, 'review']);
								registerJournalMetadata(tx, access, key, 'review', s.id, h.instance); done(progress(h));
							} catch (e) { fail(e); } };
						});
					} catch (e) { fail(e); } };
				} catch (e) { fail(e); } };
			} catch (e) { fail(e); } };
		});
	};
	const step = async (value: ReviewDraftSpec): Promise<ReviewDraftProgress> => {
		const s = parseReviewDraftSpec(value), h = await withHeader<ReviewDraftHeader>(s, 'readonly', (h, _tx, done) => done(h));
		if (h.phase !== 'indexing') return progress(h);
		const page = await plans.read(s.plan, h.next ?? undefined); check();
		return withHeader(s, 'readwrite', (current, tx, done) => {
			if (current.revision !== h.revision) { done(progress(current)); return; }
			if (JSON.stringify(current) !== JSON.stringify(h) || page.totalDecisions !== h.total) throw Error('Conflict review progress changed.');
			const next: ReviewDraftHeader = { ...current, revision: h.revision + 1 };
			let size = 4096, consumed = 0;
			for (const conflict of page.decisions) {
				if (conflict.kind === 'conflict') {
					const value: ReviewDraftRow = { conflict, from: null, revision: 0 }, length = bytes(value) + 1;
					if (length + 4096 > INVENTORY_PAGE_BYTES) throw Error('Conflict review row exceeds its page byte bound.');
					if (size + length > INVENTORY_PAGE_BYTES) break;
					tx.objectStore(REVIEW_DRAFT_STORES[1]).add(value, [key, s.id, syncPathKey(conflict.path)]); size += length;
					next.count++; if (!conflictCopySides(conflict, s.plan.policy.mode).length) next.blocked++;
					if (!canRetainFileConflicts([conflict])) next.retentionBlocked++;
				}
				consumed++;
			}
			next.read += consumed;
			next.next = consumed === page.decisions.length ? page.next : { id: s.plan.id, scope, after: syncPathKey(page.decisions[consumed - 1].path), read: next.read };
			if (!next.next) next.phase = 'reviewing'; save(next, tx); done(progress(next));
		});
	};
	const read = async (value: ReviewDraftSpec, continuation?: ReviewDraftCursor, limit = 20) => {
		const s = parseReviewDraftSpec(value), token = continuation === undefined ? undefined : structuredClone(continuation);
		if (!Number.isInteger(limit) || limit < 1 || limit > INVENTORY_PAGE_ENTRIES || (continuation !== undefined && (!token || token.id !== s.id ||
			!identifier(token.instance) || !token.scope || !sameSyncScope(token.scope, scope) || !validSyncPathKey(token.after) || !count(token.read) || token.read < 1 ||
			(token.direction !== undefined && token.direction !== 'previous')))) throw Error('Invalid conflict review cursor or page limit.');
		return withHeader<{ rows: ReviewDraftRow[]; next: ReviewDraftCursor | null; previous: ReviewDraftCursor | null;
			start: number; progress: ReviewDraftProgress }>(s, 'readonly', (h, tx, done, fail) => {
			if (!['reviewing', 'sealed'].includes(h.phase) || (token && (token.instance !== h.instance || token.read >= h.count))) throw Error('Conflict review is incomplete or its cursor changed.');
			const backwards = token?.direction === 'previous';
			const rows: ReviewDraftRow[] = []; let size = 4096;
			const finish = (atBoundary: boolean) => {
				const start = backwards ? token!.read - rows.length : token?.read ?? 0;
				if (start < 0 || start + rows.length > h.count ||
					(atBoundary && (backwards ? start !== 0 : start + rows.length !== h.count))) throw Error('Conflict review ended before its declared count.');
				if (backwards) rows.reverse();
				const cursor = (after: string, read: number, previous = false): ReviewDraftCursor => ({ id: s.id, instance: h.instance,
					scope: structuredClone(scope), after, read, ...(previous ? { direction: 'previous' as const } : {}) });
				done({ rows, start, progress: progress(h),
					previous: start && rows.length ? cursor(syncPathKey(rows[0].conflict.path), start, true) : null,
					next: start + rows.length < h.count && rows.length ? cursor(syncPathKey(rows.at(-1)!.conflict.path), start + rows.length) : null });
			};
			// Keyset navigation retains only this page, even after thousands of
			// Next/Previous clicks. No growing in-memory cursor-history stack.
			const bounds = backwards ? (keyRange ?? globalThis.IDBKeyRange).bound([key, s.id], [key, s.id, token!.after], false, true) : range(s.id, token?.after);
			const request = tx.objectStore(REVIEW_DRAFT_STORES[1]).openCursor(bounds, backwards ? 'prev' : 'next');
			request.onsuccess = () => { try {
				check(); const cursor = request.result;
				if (!cursor) { finish(true); return; }
				const value = row(cursor.value, s), length = bytes(value) + 1;
				if (JSON.stringify(cursor.primaryKey) !== JSON.stringify([key, s.id, syncPathKey(value.conflict.path)])) throw Error('Conflict row path changed.');
				if (rows.length === limit || size + length > INVENTORY_PAGE_BYTES) {
					if (!rows.length) throw Error('Conflict review row exceeds its page byte bound.');
					finish(false); return;
				}
				rows.push(value); size += length; cursor.continue();
			} catch (e) { fail(e); } };
		});
	};
	return {
		begin, step, read,
		async build(s: ReviewDraftSpec, changed?: (value: ReviewDraftProgress) => void) {
			let p = await begin(s); changed?.(p);
			while (p.phase === 'indexing') { p = await step(s); changed?.(p); } return p;
		},
		async active(): Promise<{ spec: ReviewDraftSpec; progress: ReviewDraftProgress } | null> {
			const id = await transaction<string | undefined>([REVIEW_DRAFT_HEADS], 'readonly', (tx, done) => {
				const get = tx.objectStore(REVIEW_DRAFT_HEADS).get(key); get.onsuccess = () => done(get.result);
			});
			if (id === undefined) return null;
			if (!identifier(id)) throw Error('Invalid active conflict review.');
			const s = await transaction<ReviewDraftSpec>([REVIEW_DRAFT_STORES[0]], 'readonly', (tx, done, fail) => {
				const get = tx.objectStore(REVIEW_DRAFT_STORES[0]).get([key, id]);
				get.onsuccess = () => { try { done(parseReviewDraftSpec(get.result?.spec)); } catch (e) { fail(e); } };
			});
			if (s.id !== id) throw Error('Active conflict review identity changed.');
			return withHeader(s, 'readonly', (h, _tx, done) => done({ spec: s, progress: progress(h) }));
		},
		async choose(value: ReviewDraftSpec, path: string, from: SyncSide | null, revision: number) {
			const s = parseReviewDraftSpec(value);
			if (!validSyncPath(path) || !count(revision) || (from !== null && !['local', 'remote'].includes(from))) throw Error('Invalid conflict choice.');
			return withHeader<{ row: ReviewDraftRow; progress: ReviewDraftProgress }>(s, 'readwrite', (h, tx, done, fail) => {
				if (h.phase !== 'reviewing') throw Error('Conflict review is not editable.');
				const store = tx.objectStore(REVIEW_DRAFT_STORES[1]), get = store.get([key, s.id, syncPathKey(path)]);
				get.onsuccess = () => { try {
					check(); const old = row(get.result, s);
					if (old.conflict.path !== path || old.revision !== revision) throw Error('Conflict choice changed. Reload this page before choosing again.');
					const next = row({ ...old, from, revision: old.revision + 1 }, s);
					h.selected += Number(from !== null) - Number(old.from !== null); h.revision++;
					store.put(next, [key, s.id, syncPathKey(path)]); save(h, tx); done({ row: next, progress: progress(h) });
				} catch (e) { fail(e); } };
			});
		},
		async seal(value: ReviewDraftSpec, kind: PagedRunReview['kind'], revision: number) {
			const s = parseReviewDraftSpec(value);
			return withHeader<ReviewDraftProgress>(s, 'readwrite', (h, tx, done) => {
				if (!['resolve', 'retain'].includes(kind) || !count(revision) || h.phase !== 'reviewing' || revision !== h.revision || !h.count ||
					(kind === 'resolve' ? h.selected !== h.count || !!h.blocked : !!h.retentionBlocked)) throw Error('Conflict review changed, is incomplete or needs source-folder changes.');
				h.phase = 'sealed'; h.kind = kind; h.revision++; save(h, tx); done(progress(h));
			});
		},
		async sealedRows(value: ReviewDraftSpec, cursor?: ReviewDraftCursor) {
			if (cursor?.direction) throw Error('Sealed review import requires forward pages.');
			const s = parseReviewDraftSpec(value), page = await read(s, cursor, INVENTORY_PAGE_ENTRIES);
			if (page.progress.phase !== 'sealed') throw Error('Seal conflict choices before importing a run.');
			const review = { id: s.id, kind: page.progress.kind!, count: page.progress.count };
			return { ...page, rows: page.rows.map(r => parseReviewedConflict({ conflict: r.conflict, from: review.kind === 'retain' ? 'local' : r.from! }, review, s.plan.policy.mode, scope)) };
		},
		/** Explicit cancellation or completed handoff releases only draft metadata.
		 * Maintenance deletes its rows in bounded transactions, never file bytes. */
		async release(value: ReviewDraftSpec) {
			const s = parseReviewDraftSpec(value);
			return withHeader<void>(s, 'readwrite', (h, tx, done) => {
				h.phase = 'released'; h.revision++; save(h, tx);
				tx.objectStore(REVIEW_DRAFT_HEADS).delete(key);
				tx.objectStore(PLAN_PIN_STORE).delete([key, s.plan.id, s.id, 'review']);
				for (const input of inputs(s)) tx.objectStore(INVENTORY_PIN_STORE).delete([key, input.id, s.id, 'review']);
				// Released drafts are always collectable, including non-foreground clients.
				tx.objectStore(JOURNAL_RETENTION_STORE).put({ scope: key, kind: 'review', id: s.id, instance: h.instance, retiring: false, store: 0 }, metadataKey(key, 'review', s.id));
				done(undefined);
			});
		}
	};
}
