import { planConflictRetention, resolveFileSyncConflicts, type SyncConflict } from './conflictResolution';
import { validSyncEntry, type SyncDecision, type SyncMode, type SyncScope, type SyncSide } from './reconcile';

export type PagedRunReview = { id: string; kind: 'resolve' | 'retain'; count: number };
export type ReviewedSyncConflict = { conflict: SyncConflict; from: SyncSide };
export type PagedReviewProgress = { pages: number; entries: number; complete: boolean; matched: number };
const reasons = ['both-changed', 'type-changed', 'delete-edit', 'deletion-disabled', 'destination-changed', 'excluded-descendants'];

export function parsePagedRunReview(value: PagedRunReview): PagedRunReview {
	if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.id) ||
		!['resolve', 'retain'].includes(value.kind) || !Number.isSafeInteger(value.count) || value.count < 1) throw Error('Invalid sync conflict review.');
	return { id: value.id, kind: value.kind, count: value.count };
}
export function parseReviewedConflict(value: ReviewedSyncConflict, review: PagedRunReview, mode: SyncMode, scope: SyncScope): ReviewedSyncConflict {
	const row = structuredClone(value), c = row?.conflict;
	if (!c || c.kind !== 'conflict' || !reasons.includes(c.reason) || !['local', 'remote'].includes(row.from) ||
		[c.local, c.remote].some(e => e !== null && (!validSyncEntry(e) || e.path !== c.path))) throw Error('Invalid reviewed conflict.');
	const item: ReviewedSyncConflict = { conflict: { kind: 'conflict', path: c.path, reason: c.reason, local: c.local, remote: c.remote }, from: row.from };
	resolveReviewedPage([c], [item], review.kind, mode, scope);
	return item;
}

/** Both journal forms apply the exact same visible conflict-choice policy. */
export function resolveReviewedPage(decisions: SyncDecision[], rows: ReviewedSyncConflict[], kind: PagedRunReview['kind'], mode: SyncMode, scope: SyncScope): SyncDecision[] {
	const plan = { scope, decisions }, reviewed = rows.map(row => row.conflict);
	if (kind === 'retain') {
		if (rows.some(row => row.from !== 'local')) throw Error('Retention preserves both existing versions.');
		// Pages without conflicts must not accidentally execute unrelated sync work.
		return reviewed.length ? planConflictRetention(plan, reviewed).decisions : [];
	}
	return resolveFileSyncConflicts(plan, reviewed, rows.map(row => ({ path: row.conflict.path, from: row.from })), mode).decisions;
}
