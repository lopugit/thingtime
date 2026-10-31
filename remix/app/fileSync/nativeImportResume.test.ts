import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { readNativeInventory, NativeInventoryRetryWait } from './nativeInventory';
import type { ForegroundSyncInput } from './foregroundSync';
import type { SyncJob } from './syncJobJournal';

for (const interruption of ['page', 'seal', 'plan'] as const) test(`native import resumes committed work after ${interruption} interruption and reopen`, async () => {
	const f = await foregroundFixture(260), binding = { scope, currentScope: () => scope, cleanup: 'foreground' as const };
	const captureId = crypto.randomUUID(), generation = crypto.randomUUID();
	const held = { id: crypto.randomUUID(), generation: crypto.randomUUID(), source: 'local' as const };
	let job: SyncJob = await f.journal().jobs(binding).admit(saved, 'job', 300_000), failed = false, released = 0, initialScans = 0;
	const offsets: number[] = [];
	const makeInput = (): ForegroundSyncInput => {
		const input: ForegroundSyncInput = f.input(), journal = f.journal(), inventory = journal.inventory.bind(journal), plans = journal.plans.bind(journal);
		input.inspectLocal = async path => structuredClone(f.local.find(row => row.path === path) ?? null);
		input.journal = { ...journal, inventory: access => {
			const port = inventory(access);
			return { ...port, seal: (id, changed) => port.seal(id, progress => {
				changed?.(progress);
				if (interruption === 'seal' && !failed && id.id === held.id && progress.phase === 'captured') {
					failed = true; throw Error('interrupted seal');
				}
			}) };
		}, plans: access => {
			const port = plans(access);
			return { ...port, build: async spec => {
				const result = await port.build(spec);
				if (interruption === 'plan' && !failed) { failed = true; throw Error('interrupted plan handoff'); }
				return result;
			} };
		} };
		input.beginLocalImport = async purpose => {
			job = (await journal.jobs(binding).beginImport(job, purpose, held))!;
			return job.localImport!.inventory;
		};
		input.releaseLocalImport = async id => {
			if (JSON.stringify(job.localImport?.inventory) !== JSON.stringify(id)) return;
			const draft = await journal.reviewDrafts(binding).active(), active = await journal.pagedRuns(binding).active();
			assert.ok(draft?.spec.plan.local.id === id.id || active?.spec.plan.local.id === id.id, 'consumer head must own the import before release');
			job = (await journal.jobs(binding).finishImport(job, id))!; released++;
		};
		input.scanLocalPages = async function* (options) {
			const initial = !!options?.resume;
			if (initial) initialScans++;
			const source = { id: initial ? captureId : crypto.randomUUID(), generation: initial ? generation : crypto.randomUUID(),
				totalEntries: f.local.length, totalSkipped: 0, coverage: 'full' as const, consistency: 'per-entry' as const };
			yield* readNativeInventory({ ownerId: scope.ownerId, deviceId: scope.deviceId, rootId: saved.configuration.localRootId,
				captureId: source.id, backupPolicy: saved.configuration, signal: new AbortController().signal, ...options,
				request: async (_owner, request) => {
					if (request.action === 'scan-capture') return { roots: [], backupCapture: { ...source, state: 'complete' } };
					if (request.action === 'scan-skips') return { roots: [], skippedPage: { capture: source, offset: 0, skipped: [], nextOffset: null, totalSkipped: 0 } };
					if (request.action === 'scan-discard') { assert.ok(!initial, 'held source must survive until consumer handoff'); return { roots: [] }; }
					assert.equal(request.action, 'scan-page');
					if (request.action !== 'scan-page') throw Error('Unexpected native request');
					if (initial) offsets.push(request.offset);
					if (initial && interruption === 'page' && !failed && request.offset === 134) { failed = true; throw new NativeInventoryRetryWait('interrupted page'); }
					const entries = structuredClone(f.local.slice(request.offset, request.offset + 67)), next = request.offset + entries.length;
					return { roots: [], inventoryPage: { capture: source, offset: request.offset, entries, nextOffset: next === source.totalEntries ? null : next } };
				}
			});
		};
		return input;
	};
	try {
		await assert.rejects(runPagedForegroundCloudSync(saved, scope, makeInput(), new AbortController().signal), /interrupted/);
		assert.equal(f.creates(), 0); assert.equal(released, 0);
		const before = await f.journal().inventory(binding).importState(held);
		assert.equal(before.entries, interruption === 'page' ? 134 : 260);
		if (interruption === 'seal') assert.equal(before.validatedEntries, 128);
		await f.reload(); job = (await f.journal().jobs(binding).read())!;
		await runPagedForegroundCloudSync(saved, scope, makeInput(), new AbortController().signal);
		assert.equal(f.creates(), 260); assert.equal(released, 1);
		assert.equal(offsets.filter(offset => offset === 0).length, 1, 'committed prefix is never fetched again');
		assert.equal(initialScans, interruption === 'page' ? 2 : 1, 'captured/sealed journal resumes without native reads');
		assert.equal(job.localImport, undefined);
		const head = (await f.journal().pagedCheckpoints(binding).current())!;
		assert.equal((await f.journal().inventory(binding).read(head.baseline.local)).totalEntries, 260);
	} finally { f.journal().close(); }
});
