import { sha256 } from '@noble/hashes/sha2.js';
import type { FileSyncConfiguration } from './configuration';
import type { openSyncJournal } from './journal.client';
import type { PagedPlanCursor, PagedPlanSpec } from './pagedPlanJournal';
import type { ReviewDraftCursor, ReviewDraftSpec } from './pagedReviewDraft';
import { resolveReviewedPage, type ReviewedSyncConflict } from './pagedRunReview';
import { syncPathKey, type SyncScope } from './reconcile';

type Journal = Awaited<ReturnType<typeof openSyncJournal>>;
export type ReviewDraftJournal = ReturnType<Journal['reviewDrafts']>;
export type PagedConflictReviewSession = {
	read(cursor?: ReviewDraftCursor): ReturnType<ReviewDraftJournal['read']>;
	choose(path: string, from: 'local' | 'remote' | null, revision: number): ReturnType<ReviewDraftJournal['choose']>;
};
export type PagedConflictReviewResult = { action: 'resolve' | 'retain'; revision: number } | { action: 'cancel' };

export class SyncReviewChangedError extends Error {
	constructor() { super('Files changed during conflict review. Review the current versions before copying. Both folders were preserved.'); }
}

/** One bounded page is retained while a consumer streams the sealed choices. */
export async function* sealedReviewRows(drafts: ReviewDraftJournal, draft: ReviewDraftSpec) {
	let cursor: ReviewDraftCursor | null = null;
	do {
		const page = await drafts.sealedRows(draft, cursor ?? undefined);
		for (const row of page.rows) yield row;
		cursor = page.next;
	} while (cursor);
}

/** Same SHA-256 bytes as the original JSON.stringify({ configuration, choices })
 * identity, without collecting or sorting a whole review in memory. The draft
 * index supplies the exact folded-path order used by the original sort. */
export async function retainedReviewIdentity(configuration: FileSyncConfiguration, rows: AsyncIterable<ReviewedSyncConflict>) {
	const hash = sha256.create(), encode = new TextEncoder();
	let prior: string | undefined;
	try {
		hash.update(encode.encode('{"configuration":' + JSON.stringify(configuration) + ',"choices":['));
		for await (const row of rows) {
			const key = syncPathKey(row.conflict.path);
			if (prior !== undefined && key <= prior) throw Error('Retained review paths must be unique and ordered.');
			hash.update(encode.encode((prior === undefined ? '' : ',') + JSON.stringify(row)));
			prior = key;
		}
		hash.update(encode.encode(']}'));
		return [...hash.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('');
	} finally { hash.destroy(); }
}

/** Validate the entire fresh plan before any run can start. This is a bounded
 * merge, so even a changed conflict on the final page prevents all effects. */
export async function verifyFreshReview(
	plans: ReturnType<Journal['plans']>, plan: PagedPlanSpec,
	drafts: ReviewDraftJournal, draft: ReviewDraftSpec, scope: SyncScope
) {
	const state = await drafts.begin(draft);
	if (state.phase !== 'sealed') throw Error('Seal conflict choices before checking current files.');
	const rows = sealedReviewRows(drafts, draft)[Symbol.asyncIterator]();
	let cursor: PagedPlanCursor | null = null;
	try {
		do {
			const page = await plans.read(plan, cursor ?? undefined), selected: ReviewedSyncConflict[] = [];
			for (const decision of page.decisions) if (decision.kind === 'conflict') {
				const row = await rows.next();
				if (row.done || !row.value) throw new SyncReviewChangedError();
				selected.push(row.value);
			}
			try { resolveReviewedPage(page.decisions, selected, state.kind!, plan.policy.mode, scope); }
			catch { throw new SyncReviewChangedError(); }
			cursor = page.next;
		} while (cursor);
		if (!(await rows.next()).done) throw new SyncReviewChangedError();
	} finally { await rows.return(undefined); }
}

/** Retry from ordinal zero: the run journal compares immutable page receipts,
 * including the final-page bit, before accepting an already-imported page. */
export async function importReviewDraft(
	runs: ReturnType<Journal['pagedRuns']>, run: Parameters<ReturnType<Journal['pagedRuns']>['appendReview']>[0],
	drafts: ReviewDraftJournal, draft: ReviewDraftSpec
) {
	let cursor: ReviewDraftCursor | null = null, ordinal = 0;
	do {
		const page = await drafts.sealedRows(draft, cursor ?? undefined);
		await runs.appendReview(run, { ordinal: ordinal++, rows: page.rows, complete: !page.next });
		cursor = page.next;
	} while (cursor);
}
