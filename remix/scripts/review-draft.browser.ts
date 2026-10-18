// Generated-data IndexedDB acceptance. No account, native files or remote API.
import { openSyncJournal, withSyncRootLock } from '../app/fileSync/journal.client';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import type { SyncEntry } from '../app/fileSync/reconcile';
import type { ReviewDraftCursor, ReviewDraftSpec } from '../app/fileSync/pagedReviewDraft';

const scope = { origin: location.origin, ownerId: 'review-browser-fixture', dataPlane: 'home', deviceId: 'review-device', rootId: 'review-connection' };
const access = { scope, currentScope: () => scope, cleanup: 'foreground' as const };
const configuration = newFileSyncConfiguration({ name: 'Review fixture', deviceId: scope.deviceId, localRootId: 'local', remoteFolderId: 'remote' });
const spec = (id: string): ReviewDraftSpec => ({ id, configuration, plan: { id: 'plan-' + id,
	local: { id: 'local-' + id, generation: 'one', source: 'local' }, remote: { id: 'remote-' + id, generation: 'one', source: 'remote' },
	baseline: { local: { id: 'before-local-' + id, generation: 'one', source: 'local' }, remote: { id: 'before-remote-' + id, generation: 'one', source: 'remote' } },
	policy: { mode: 'two-way', propagateDeletes: false }, excludedPaths: [] } });
const draft = spec('review');
async function seed(journal: Awaited<ReturnType<typeof openSyncJournal>>, s: ReviewDraftSpec) {
	const inventory = journal.inventory(access);
	for (const [i, capture] of [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote].entries()) {
		const total = i < 2 ? 270 : 0; await inventory.begin(capture);
		for (let offset = 0, ordinal = 0; offset < total || !ordinal; offset += 128, ordinal++) {
			const entries: SyncEntry[] = Array.from({ length: Math.min(128, total - offset) }, (_, n) => ({
				path: 'file-' + String(offset + n).padStart(5, '0'), id: `${i}-${offset + n}`, version: 'one', kind: 'file', size: 2, sha256: (i ? 'b' : 'a').repeat(64)
			}));
			await inventory.append(capture, { ordinal, entries, ...(offset + entries.length === total ? { totalEntries: total } : {}) });
		}
		await inventory.seal(capture);
	}
	await journal.plans(access).build(s.plan);
}
Object.assign(window, { syncReviewDraftFixture: {
	async seedAndStop() {
		return withSyncRootLock(scope, async () => {
			const journal = await openSyncJournal();
			try {
				await seed(journal, draft); const drafts = journal.reviewDrafts(access);
				await drafts.build(draft); const page = await drafts.read(draft);
				await drafts.choose(draft, page.rows[0].conflict.path, 'remote', 0);
				await journal.maintenance(access).collect();
				return { progress: (await drafts.active())!.progress, pageSize: page.rows.length };
			} finally { journal.close(); }
		});
	},
	async finishAfterRestart() {
		return withSyncRootLock(scope, async () => {
			const journal = await openSyncJournal();
			try {
				const drafts = journal.reviewDrafts(access), restored = await drafts.active(), first = await drafts.read(draft);
				const saved = { count: restored!.progress.count, selected: restored!.progress.selected, from: first.rows[0].from };
				let cursor: ReviewDraftCursor | undefined, maxPage = 0;
				do { const page = await drafts.read(draft, cursor); maxPage = Math.max(maxPage, page.rows.length);
					for (const row of page.rows) if (row.from === null) await drafts.choose(draft, row.conflict.path, 'local', row.revision);
					cursor = page.next ?? undefined;
				} while (cursor);
				await drafts.seal(draft, 'resolve', (await drafts.active())!.progress.revision);
				const fresh = spec('fresh'); await seed(journal, fresh);
				const runs = journal.pagedRuns(access), run = { id: 'review-run', plan: fresh.plan, configuration,
					review: { id: draft.id, kind: 'resolve' as const, count: 270 } };
				await runs.begin(run); let ordinal = 0, maxImportPage = 0;
				do { const page = await drafts.sealedRows(draft, cursor); maxImportPage = Math.max(maxImportPage, page.rows.length);
					await runs.appendReview(run, { ordinal: ordinal++, rows: page.rows, complete: !page.next }); cursor = page.next ?? undefined;
				} while (cursor);
				await drafts.release(draft); const cleanup = await journal.maintenance(access).collect();
				return { saved, maxPage, maxImportPage, cleanup, draft: await drafts.active(), prepared: await runs.prepare(run) };
			} finally { journal.close(); }
		});
	}
} });
