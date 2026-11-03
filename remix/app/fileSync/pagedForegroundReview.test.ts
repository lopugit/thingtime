import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { newFileSyncConfiguration } from './configuration';
import { importReviewDraft, retainedReviewIdentity, sealedReviewRows, verifyFreshReview } from './pagedForegroundReview';
import type { ReviewDraftSpec } from './pagedReviewDraft';
import type { ReviewedSyncConflict } from './pagedRunReview';
import type { SyncEntry } from './reconcile';

const scope = { origin: 'https://review.test', ownerId: 'owner', deviceId: 'device', dataPlane: 'home', rootId: 'connection' };
const configuration = newFileSyncConfiguration({ name: 'Photos 🥰 "é"', deviceId: 'device', localRootId: 'local-root', remoteFolderId: 'cloud-root' });
const spec = (id: string): ReviewDraftSpec => ({ id, configuration, plan: { id: 'plan-' + id,
	local: { id: 'local-' + id, source: 'local', generation: 'one' }, remote: { id: 'remote-' + id, source: 'remote', generation: 'one' },
	baseline: { local: { id: 'before-local-' + id, source: 'local', generation: 'one' }, remote: { id: 'before-remote-' + id, source: 'remote', generation: 'one' } },
	policy: { mode: 'two-way', propagateDeletes: false }, excludedPaths: [] } });
const file = (path: string, side: string): SyncEntry => ({ path, id: side + path, version: 'one', kind: 'file', size: 2, sha256: (side === 'local' ? 'a' : 'b').repeat(64) });

test('streamed retention identity is byte-compatible across Unicode, escaping and large reviews', async () => {
	for (const count of [0, 1, 270, 10_001]) {
		const rows: ReviewedSyncConflict[] = Array.from({ length: count }, (_, i) => {
			const path = String(i).padStart(5, '0') + '-é🥰"file';
			return { conflict: { kind: 'conflict', path, reason: 'both-changed', local: file(path, 'local'), remote: file(path, 'remote') }, from: 'local' };
		});
		const expected = createHash('sha256').update(JSON.stringify({ configuration, choices: rows })).digest('hex');
		assert.equal(await retainedReviewIdentity(configuration, (async function* () { for (const row of rows) yield row; })()), expected);
		if (count > 1) await assert.rejects(retainedReviewIdentity(configuration, (async function* () { yield rows[1]; yield rows[0]; })()), /unique and ordered/);
	}
});

test('fresh-review merge rejects final-page edits, additions and removals before operation creation', async () => {
	for (const change of ['same', 'edit', 'add', 'remove']) {
		const journal = await openSyncJournal(new IDBFactory(), 'review', IDBKeyRange), access = { scope, currentScope: () => scope },
			inventory = journal.inventory(access), plans = journal.plans(access), drafts = journal.reviewDrafts(access), runs = journal.pagedRuns(access);
		const original = spec('original'), fresh = spec('fresh');
		for (const s of [original, fresh]) {
			for (const [i, capture] of [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote].entries()) {
				const count = i > 1 ? 0 : 270 + (s === fresh && change === 'add' ? 1 : s === fresh && change === 'remove' ? -1 : 0);
				await inventory.begin(capture);
				for (let offset = 0, ordinal = 0; offset < count || !ordinal; offset += 128, ordinal++) {
					const entries = Array.from({ length: Math.min(128, count - offset) }, (_, n) => {
						const value = file(String(offset + n).padStart(5, '0'), i ? 'remote' : 'local');
						if (s === fresh && change === 'edit' && offset + n === 269) value.version = 'edited';
						return value;
					});
					await inventory.append(capture, { ordinal, entries, ...(offset + entries.length === count ? { totalEntries: count } : {}) });
				}
				await inventory.seal(capture);
			}
			await plans.build(s.plan);
		}
		await drafts.build(original); await drafts.seal(original, 'retain', (await drafts.active())!.progress.revision);
		if (change !== 'same') {
			await assert.rejects(verifyFreshReview(plans, fresh.plan, drafts, original, scope), /Files changed during conflict review/);
			assert.equal(await runs.active(), null);
		} else {
			await verifyFreshReview(plans, fresh.plan, drafts, original, scope);
			const run = { id: original.id, plan: fresh.plan, configuration, review: { id: await retainedReviewIdentity(configuration, sealedReviewRows(drafts, original)), kind: 'retain' as const, count: 270 } };
			await runs.begin(run); const first = await drafts.sealedRows(original); await runs.appendReview(run, { ordinal: 0, rows: first.rows });
			let max = 0; const append = runs.appendReview;
			runs.appendReview = (s, page) => { max = Math.max(max, page.rows.length); return append(s, page); };
			await importReviewDraft(runs, run, drafts, original); assert.equal(max, 128);
			assert.equal((await runs.active())!.review?.entries, 270); assert.equal((await runs.prepare(run)).operations, 270);
		}
		journal.close();
	}
});
