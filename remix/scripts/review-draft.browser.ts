// Generated-data IndexedDB acceptance. No account, native files or remote API.
import { openSyncJournal, withSyncRootLock } from '../app/fileSync/journal.client';
import { createConflictReviewController } from '../app/fileSync/conflictReviewController';
import type { PagedConflictReviewResult } from '../app/fileSync/pagedForegroundReview';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import type { SyncEntry } from '../app/fileSync/reconcile';
import type { ReviewDraftSpec } from '../app/fileSync/pagedReviewDraft';
import { importReviewDraft, retainedReviewIdentity, sealedReviewRows, verifyFreshReview } from '../app/fileSync/pagedForegroundReview';

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
				await drafts.build(draft);
				const controller = createConflictReviewController({ read: cursor => drafts.read(draft, cursor),
					choose: (path, from, revision) => drafts.choose(draft, path, from, revision) }, () => { throw Error('Unexpected completion'); });
				await controller.reload(); const page = controller.getSnapshot().page!;
				await controller.choose(page.rows[0].conflict.path, 'remote', 0); controller.dispose();
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
				let decision: PagedConflictReviewResult | undefined, maxPage = 0;
				const controller = createConflictReviewController({ read: cursor => drafts.read(draft, cursor),
					choose: (path, from, revision) => drafts.choose(draft, path, from, revision) }, result => { decision = result; });
				await controller.reload();
				for (;;) {
					const page = controller.getSnapshot().page!; maxPage = Math.max(maxPage, page.rows.length);
					for (const row of page.rows) if (row.from === null) await controller.choose(row.conflict.path, 'local', row.revision);
					if (!page.next) break;
					await controller.next();
				}
				await controller.previous(); const previousStart = controller.getSnapshot().page!.start;
				await controller.next(); const lastStart = controller.getSnapshot().page!.start;
				await controller.finish('resolve');
				if (!decision || decision.action !== 'resolve') throw Error('Review did not finish');
				await drafts.seal(draft, 'resolve', decision.revision);
				const fresh = spec('fresh'); await seed(journal, fresh);
				await verifyFreshReview(journal.plans(access), fresh.plan, drafts, draft, scope);
				const streamedDigest = await retainedReviewIdentity(configuration, sealedReviewRows(drafts, draft));
				// Independent reference in this small fixture only; production streams.
				const choices = []; for await (const row of sealedReviewRows(drafts, draft)) choices.push(row);
				const reference = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ configuration, choices }))))]
					.map(byte => byte.toString(16).padStart(2, '0')).join('');
				const runs = journal.pagedRuns(access), run = { id: 'review-run', plan: fresh.plan, configuration,
					review: { id: draft.id, kind: 'resolve' as const, count: 270 } };
				await runs.begin(run); let maxImportPage = 0;
				const append = runs.appendReview;
				runs.appendReview = (s, page) => { maxImportPage = Math.max(maxImportPage, page.rows.length); return append(s, page); };
				await importReviewDraft(runs, run, drafts, draft);
				await drafts.release(draft); const cleanup = await journal.maintenance(access).collect();
				return { saved, maxPage, maxImportPage, navigation: { previousStart, lastStart, closed: controller.getSnapshot().closed }, digestMatchesWebCrypto: streamedDigest === reference, cleanup, draft: await drafts.active(), prepared: await runs.prepare(run) };
			} finally { journal.close(); }
		});
	}
} });
