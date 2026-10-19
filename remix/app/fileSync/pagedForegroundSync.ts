import { assertBackupCapturePolicy, parseNativeBackupCapture, type NativeBackupCapture } from './nativeInventory';
import { foregroundSyncContext } from './foregroundSyncContext';
import { runForegroundCloudSync, type ForegroundSyncInput, type ForegroundSyncProgress } from './foregroundSync';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { resolveFileSyncConflicts, planConflictRetention, type SyncConflict, type SyncConflictReviewResult } from './conflictResolution';
import { importReviewDraft, retainedReviewIdentity, sealedReviewRows, SyncReviewChangedError, verifyFreshReview, type PagedConflictReviewResult } from './pagedForegroundReview';
import type { ReviewDraftCursor, ReviewDraftSpec } from './pagedReviewDraft';
import { createPagedCloudSyncPort } from './cloudSyncPort.client';
import { executePreparedPagedSyncRun } from './pagedExecute';
import { INVENTORY_PAGE_BYTES, INVENTORY_PAGE_ENTRIES, type InventoryIdentity, type InventoryCursor } from './inventoryJournal';
import type { PagedPlanSpec } from './pagedPlanJournal';
import type { PagedRunSpec, PagedRunProgress } from './pagedRunJournal';
import { MAX_SYNC_SCAN_ENTRIES, planFileSync, type SyncScope, type SyncEntry } from './reconcile';
import { inventorySyncEntry, type CloudInventoryNode } from './cloudInventory';
import { parseCloudInventoryPage } from './cloudInventoryPages';

/** Import one already complete bounded scan. Native/cloud producers still use
 * their existing limits; pages here do not turn a partial scan into a full one. */
async function pages<T>(rows: readonly T[], write: (page: T[], ordinal: number, final: boolean) => Promise<unknown>, size: (row: T) => number) {
	let offset = 0, ordinal = 0;
	do {
		const page: T[] = []; let bytes = 16_384;
		while (offset < rows.length && page.length < INVENTORY_PAGE_ENTRIES) {
			const count = size(rows[offset]) + 1;
			if (bytes + count > INVENTORY_PAGE_BYTES) { if (!page.length) throw Error('Sync row exceeds its page byte bound.'); break; }
			page.push(rows[offset++]); bytes += count;
		}
		await write(page, ordinal++, offset === rows.length);
	} while (offset < rows.length);
}
const size = (row: unknown) => new TextEncoder().encode(JSON.stringify(row)).length;
const identity = (source: 'local' | 'remote'): InventoryIdentity => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });

/** Called inside the foreground root lock, including review and checkpoint
 * publication. Android keeps its existing runner while its work is deferred. */
export async function runPagedForegroundCloudSync(reviewed: SavedFileSyncConfiguration, scope: SyncScope, input: ForegroundSyncInput, signal: AbortSignal) {
	const { configuration, check, authorize, scanCloud, readLocal, runtime, localTarget } = foregroundSyncContext(reviewed, scope, input, signal);
	const access = { scope, currentScope: input.currentScope, signal, cleanup: 'foreground' as const }, inventory = input.journal.inventory(access),
		plans = input.journal.plans(access), runs = input.journal.pagedRuns(access), checkpoints = input.journal.pagedCheckpoints(access), drafts = input.journal.reviewDrafts(access);
	input.progress({ stage: 'checking', confirmed: 0, total: 0 }); await authorize();
	await input.journal.maintenance(access).collect(); check();
	let active = await runs.active(); check();
	let draft = await drafts.active(); check();
	const previousHead = await checkpoints.current(), legacy = await input.journal.read(scope), legacyCheckpoint = previousHead ? null : await input.journal.checkpoint(scope); check();
	// Finish legacy uncertain work and lost checkpoints using its original IDs,
	// receipts and approval contract before migrating a connection's baseline.
	if (!active && !draft && !previousHead && legacy && (legacy.operations.some(op => !op.confirmed) || legacy.version === 2 ||
		(legacyCheckpoint?.runId !== legacy.id && JSON.stringify((legacy as { configuration?: unknown }).configuration) === JSON.stringify(configuration))))
		return runForegroundCloudSync(reviewed, scope, input, signal);
	if (active && JSON.stringify(active.spec.configuration) !== JSON.stringify(configuration))
		throw Error('An unfinished transfer belongs to different settings. Restore its original settings before retrying; its work has been preserved.');
	if (draft && JSON.stringify(draft.spec.configuration) !== JSON.stringify(configuration))
		throw Error('A saved conflict review belongs to different settings. Restore its original settings before retrying or cancelling it.');
	if (draft && active && (draft.spec.id !== active.spec.id || (active.spec.review
		? draft.progress.phase !== 'sealed' || draft.progress.kind !== active.spec.review.kind || draft.progress.count !== active.spec.review.count
		: draft.progress.phase !== 'reviewing' || draft.progress.count !== 0)))
		throw Error('The saved review does not belong to the active transfer. Both were preserved.');
	if (active?.review && !active.review.complete && !draft) {
		// No operation can start until the entire review is imported. A crash
		// here requires fresh review, never invented choices for missing pages.
		await runs.discard(active.spec); await plans.discard(active.spec.plan); active = null;
	}
	const restoredInventory = active?.spec.plan.local ?? draft?.spec.plan.local;
	if (restoredInventory && await inventory.coverage(restoredInventory)) {
		check(); await inventory.retainLatest(restoredInventory);
		input.inventorySession?.({ scope: structuredClone(scope), inventory: structuredClone(restoredInventory) });
	}
	const importEntries = async (id: InventoryIdentity, rows: readonly SyncEntry[]) => {
		await inventory.begin(id);
		await pages<SyncEntry>(rows, (entries, ordinal, final) => inventory.append(id, { ordinal, entries, ...(final ? { totalEntries: rows.length } : {}) }), size);
		await inventory.seal(id); check();
	};
	const importLocal = async (id: InventoryIdentity, reportIndex = true) => {
		if (!input.scanLocalPages) {
			const entries = await input.scanLocal(); check();
			planFileSync({ scope, complete: true, entries }, { scope, complete: true, entries: [] }, { scope, entries: [] }, { mode: 'backup', propagateDeletes: false });
			await importEntries(id, entries);
			if (reportIndex) input.progress({ stage: 'scanning', confirmed: 0, total: 0, indexed: entries.length, indexTotal: entries.length });
			return;
		}
		await inventory.begin(id);
		if (reportIndex) await inventory.retainLatest(id);
		let generation: string | undefined, ordinal = 0, terminal = false, indexed = 0, skipped = 0;
		let coverage: NativeBackupCapture | undefined;
		for await (const page of input.scanLocalPages()) {
			check();
			if (terminal || !page || typeof page.generation !== 'string' ||
				!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(page.generation) || (generation !== undefined && page.generation !== generation))
				throw Error('Native inventory generation or page order changed.');
			if (page.backupCapture) {
				assertBackupCapturePolicy(configuration);
				const next = parseNativeBackupCapture(page.backupCapture);
				if (next.generation !== page.generation || (coverage && JSON.stringify(coverage) !== JSON.stringify(next)) || (!coverage && ordinal !== 0))
					throw Error('Native backup coverage changed.');
				coverage = next; await inventory.setCoverage(id, coverage, configuration);
			} else if (coverage) throw Error('Native backup coverage is missing.');
			generation = page.generation;
			if (page.skippedPage) {
				if (!coverage || ordinal !== 0 || page.entries.length !== 0 || page.totalEntries !== undefined) throw Error('Invalid skipped inventory frame.');
				await inventory.appendSkips(id, page.skippedPage); skipped += page.skippedPage.skipped.length;
				if (reportIndex) input.progress({ stage: 'scanning', confirmed: 0, total: 0, indexed, indexTotal: coverage.totalEntries,
					skipped, coverage: coverage.coverage, consistency: coverage.consistency });
				continue;
			}
			if (page.ordinal !== ordinal) throw Error('Native inventory generation or page order changed.');
			generation = page.generation; ordinal++;
			await inventory.append(id, { ordinal: page.ordinal, entries: page.entries,
				...(page.totalEntries === undefined ? {} : { totalEntries: page.totalEntries }) });
			indexed += page.entries.length;
			if (reportIndex) input.progress({ stage: 'scanning', confirmed: 0, total: 0, indexed,
				...(page.totalEntries === undefined ? {} : { indexTotal: page.totalEntries }), ...(coverage ? { skipped, coverage: coverage.coverage, consistency: coverage.consistency } : {}) });
			terminal = page.totalEntries !== undefined;
		}
		check();
		if (!terminal) throw Error('Native inventory has no final page. Keep the last complete scan.');
		await inventory.seal(id); check();
		// Publish only once coverage and every skip page are durable. A viewer
		// mounted earlier could mistake an unfilled capture for strict coverage.
		if (reportIndex && coverage) input.inventorySession?.({ scope: structuredClone(scope), inventory: structuredClone(id) });
	};
	const importObservations = async (local: InventoryIdentity, remote: InventoryIdentity, checkpoint = false) => {
		await importLocal(local, !checkpoint);
		if (input.inventoryPages) {
			// A checkpoint stores stamps, but must first validate the complete physical tree.
			const observed = checkpoint ? identity('remote') : remote;
			let generation: string | undefined, revision: string | undefined, ordinal = 0, count = 0, terminal = false;
			for await (const value of input.inventoryPages()) {
				check(); const page = parseCloudInventoryPage(value, configuration.remoteFolderId);
				if (terminal || page.ordinal !== ordinal || (generation !== undefined && page.generation !== generation) ||
					(revision !== undefined && page.rootRevision !== revision)) throw Error('Cloud inventory generation or page order changed.');
				generation = page.generation; revision = page.rootRevision;
				if (!ordinal) await inventory.beginCloud(observed, page);
				ordinal++; count += page.nodes.length;
				if (!Number.isSafeInteger(count) || (page.totalEntries !== undefined && page.totalEntries !== count))
					throw Error('Cloud inventory completion count changed.');
				const metadata = { ordinal: page.ordinal, ...(page.totalEntries === undefined ? {} : { totalEntries: page.totalEntries }) };
				await inventory.appendCloud(observed, { ...metadata, nodes: page.nodes });
				terminal = page.totalEntries !== undefined;
			}
			check(); if (!terminal) throw Error('Cloud inventory has no final page. Keep the last complete scan.');
			await inventory.seal(observed); check();
			if (checkpoint) {
				await inventory.begin(remote);
				let next: InventoryCursor | null = null, pageOrdinal = 0;
				do {
					const page = await inventory.read(observed, next ?? undefined); check();
					await inventory.append(remote, { ordinal: pageOrdinal++, entries: page.entries,
						...(page.next ? {} : { totalEntries: page.totalEntries }) });
					next = page.next;
				} while (next);
				await inventory.seal(remote); check(); await inventory.discard(observed);
			}
			return;
		}
		const observed = await scanCloud(); check();
		// Checkpoints own pre-created plain observation captures. Destination
		// metadata belongs to planning captures; a baseline stores content stamps.
		if (checkpoint) return importEntries(remote, observed.nodes.map(inventorySyncEntry));
		await inventory.beginCloud(remote, observed);
		await pages<CloudInventoryNode>(observed.nodes,
			(nodes, ordinal, final) => inventory.appendCloud(remote, { ordinal, nodes, ...(final ? { totalEntries: observed.nodes.length } : {}) }),
			node => size(node) * 2 + 1024);
		await inventory.seal(remote); check();
	};
	const capture = async (baseline: PagedPlanSpec['baseline']) => {
		input.progress({ stage: 'scanning', confirmed: 0, total: 0 });
		await authorize();
		const local = identity('local'), remote = identity('remote');
		await importObservations(local, remote);
		const spec: PagedPlanSpec = { id: crypto.randomUUID(), local, remote, baseline,
			policy: { mode: configuration.mode, propagateDeletes: configuration.propagateDeletes }, excludedPaths: configuration.excludedPaths };
		const result = await plans.build(spec);
		// Every whole-tree compatibility boundary must stay bounded. The native
		// paged path can keep its plan, review and baseline on disk throughout.
		if (result.indexed > MAX_SYNC_SCAN_ENTRIES &&
			!(input.scanLocalPages && input.inventoryPages && input.inspectLocal && input.reviewPagedConflicts))
			throw Error('Large folders require paged native/cloud inventories, individual path checks and paged conflict review.');
		return spec;
	};
	const releaseDraft = async (saved: ReviewDraftSpec, keepPlan = false) => {
		await drafts.release(saved); if (!keepPlan) await plans.discard(saved.plan); draft = null;
	};
	const reviewDraft = async (saved: ReviewDraftSpec) => {
		let state = await drafts.build(saved); check();
		if (state.phase === 'sealed' || !state.count) return state;
		if (!input.reviewPagedConflicts && !input.reviewConflicts) throw Error(`${state.count} sync conflicts need review. Both copies were preserved.`);
		input.progress({ stage: 'reviewing', confirmed: state.selected, total: state.count });
		let result: PagedConflictReviewResult;
		if (input.reviewPagedConflicts) {
			let open = true;
			const current = () => { check(); if (!open) throw Error('This conflict review is no longer open.'); };
			try { result = structuredClone(await input.reviewPagedConflicts({
				read: cursor => { current(); return drafts.read(saved, cursor); },
				choose: (path, from, revision) => { current(); return drafts.choose(saved, path, from, revision); }
			})); } finally { open = false; }
		} else {
			// Compatibility for the existing bounded popup. The Builder adapter
			// uses reviewPagedConflicts; only this legacy boundary collects arrays.
			const conflicts: SyncConflict[] = []; let cursor: ReviewDraftCursor | null = null;
			do { const page = await drafts.read(saved, cursor ?? undefined); conflicts.push(...page.rows.map(r => r.conflict)); cursor = page.next; } while (cursor);
			let selected: SyncConflictReviewResult;
			try { selected = structuredClone(await input.reviewConflicts!(structuredClone(conflicts))); }
			catch (error) { if (!signal.aborted) await releaseDraft(saved); throw error; }
			check(); const retain = !Array.isArray(selected) && selected.action === 'retain';
			if (retain) planConflictRetention({ scope, decisions: conflicts }, conflicts);
			else {
				resolveFileSyncConflicts({ scope, decisions: conflicts }, conflicts, selected as Exclude<typeof selected, { action: 'retain' }>, configuration.mode);
				const choices = new Map(Array.isArray(selected) ? selected.map(c => [c.path, c.from]) : []);
				do { const page = await drafts.read(saved, cursor ?? undefined);
					for (const row of page.rows) await drafts.choose(saved, row.conflict.path, choices.get(row.conflict.path)!, row.revision);
					cursor = page.next;
				} while (cursor);
			}
			state = await drafts.begin(saved); result = { action: retain ? 'retain' : 'resolve', revision: state.revision };
		}
		check();
		if (result?.action === 'cancel') { await releaseDraft(saved); throw Error('Conflict review cancelled. Both folders were preserved.'); }
		if (!result || !['resolve', 'retain'].includes(result.action)) throw Error('Invalid conflict review result.');
		await authorize(); return drafts.seal(saved, result.action, result.revision);
	};
	let spec: PagedRunSpec;
	if (active) {
		spec = active.spec;
		if (draft) {
			if (spec.review && !active.review?.complete) await importReviewDraft(runs, spec, drafts, draft.spec);
			await releaseDraft(draft.spec, draft.spec.plan.id === spec.plan.id);
		}
	}
	else {
		await checkpoints.changeRoots(configuration.localRootId, configuration.remoteFolderId);
		const head = await checkpoints.current(); check();
		let baseline = draft?.spec.plan.baseline ?? head?.baseline;
		if (draft && head && JSON.stringify(draft.spec.plan.baseline) !== JSON.stringify(head.baseline))
			throw Error('The baseline changed while this conflict review was saved. Its choices were preserved.');
		if (!baseline) {
			baseline = { local: identity('local'), remote: identity('remote') };
			const old = legacyCheckpoint?.localRootId === configuration.localRootId && legacyCheckpoint.remoteFolderId === configuration.remoteFolderId
				? legacyCheckpoint.baseline.entries : [];
			await importEntries(baseline.local, old.map(p => p.local)); await importEntries(baseline.remote, old.map(p => p.remote));
		}
		const saved = draft?.spec ?? { id: crypto.randomUUID(), plan: await capture(baseline), configuration };
		const state = await reviewDraft(saved); let plan = saved.plan;
		let review: PagedRunSpec['review'];
		if (state.count) {
			plan = await capture(baseline);
			try { await verifyFreshReview(plans, plan, drafts, saved, scope); }
			catch (error) {
				if (error instanceof SyncReviewChangedError) { await releaseDraft(saved); await plans.discard(plan); }
				throw error;
			}
			review = { id: saved.id, kind: state.kind!, count: state.count };
			if (review.kind === 'retain') {
				review.id = await retainedReviewIdentity(configuration, sealedReviewRows(drafts, saved));
				const retained = await runs.retained(); check();
				if (retained?.spec.review?.id === review.id && JSON.stringify(retained.spec.configuration) === JSON.stringify(configuration)) {
					await releaseDraft(saved); await plans.discard(plan);
					input.progress({ stage: 'retained', confirmed: retained.progress.confirmed, total: retained.progress.operations });
					return retained;
				}
			}
		}
		spec = { id: saved.id, plan, configuration, ...(review ? { review } : {}) };
		await authorize(); await runs.begin(spec);
		if (review) await importReviewDraft(runs, spec, drafts, saved);
		await releaseDraft(saved, !review);
	}
	await runs.prepare(spec); await runs.prepareCloud(spec, configuration); check();
	input.progressSession?.({ scope: structuredClone(scope), run: structuredClone(spec) });
	const planningCoverage = await inventory.coverage(spec.plan.local);
	let state = await runs.begin(spec); const retain = spec.review?.kind === 'retain';
	const report = (value: PagedRunProgress, stage: ForegroundSyncProgress['stage'] = retain ? 'retaining' : 'transferring') => {
		state = value; input.progress({ stage, confirmed: value.confirmed, total: value.operations, ...(planningCoverage ? { coverage: planningCoverage.coverage, skipped: planningCoverage.totalSkipped, consistency: planningCoverage.consistency } : {}) });
	};
	const port = await createPagedCloudSyncPort(spec, configuration, runs, {
		currentScope: input.currentScope, signal, localTarget,
		transfer: input.transfer,
		readLocal,
		openSource: async entry => { await authorize(); return input.source(entry); },
		progress: (path, bytes, size) => { check(); input.progress({ stage: retain ? 'retaining' : 'transferring', confirmed: state.confirmed, total: state.operations, path, bytes, size, ...(planningCoverage ? { coverage: planningCoverage.coverage, skipped: planningCoverage.totalSkipped, consistency: planningCoverage.consistency } : {}) }); }
	}, runtime);
	const done = await executePreparedPagedSyncRun(spec, scope, runs, port, { signal, changed: p => report(p) }); check();
	if (retain) { await runs.finishRetention(spec); report(done, 'retained'); return { spec, progress: done }; }
	report(done, 'verifying'); await authorize();
	const checkpoint = { run: spec, localRootId: configuration.localRootId, remoteFolderId: configuration.remoteFolderId };
	let checkpointDraft = await checkpoints.begin(checkpoint); check();
	if (checkpointDraft.phase === 'collecting') {
		checkpointDraft = await checkpoints.restartCollection(checkpoint);
		await importObservations(checkpointDraft.after.local, checkpointDraft.after.remote, true);
	}
	await checkpoints.build(checkpoint); check(); report(done, 'complete'); return { spec, progress: done };
}
