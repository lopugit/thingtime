import { foregroundSyncContext } from './foregroundSyncContext';
import { runForegroundCloudSync, type ForegroundSyncInput, type ForegroundSyncProgress } from './foregroundSync';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { resolveFileSyncConflicts, planConflictRetention, type SyncConflict } from './conflictResolution';
import { createPagedCloudSyncPort } from './cloudSyncPort.client';
import { executePreparedPagedSyncRun } from './pagedExecute';
import { INVENTORY_PAGE_BYTES, INVENTORY_PAGE_ENTRIES, type InventoryIdentity } from './inventoryJournal';
import type { PagedPlanSpec, PagedPlanCursor } from './pagedPlanJournal';
import type { PagedRunSpec, PagedRunProgress } from './pagedRunJournal';
import { parseReviewedConflict, type ReviewedSyncConflict } from './pagedRunReview';
import { MAX_SYNC_SCAN_ENTRIES, planFileSync, syncPathKey, type SyncScope, type SyncEntry } from './reconcile';
import type { CloudInventoryNode } from './cloudInventory';

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
	const { configuration, check, authorize, scan, runtime, localTarget } = foregroundSyncContext(reviewed, scope, input, signal);
	const access = { scope, currentScope: input.currentScope, signal }, inventory = input.journal.inventory(access),
		plans = input.journal.plans(access), runs = input.journal.pagedRuns(access), checkpoints = input.journal.pagedCheckpoints(access);
	input.progress({ stage: 'checking', confirmed: 0, total: 0 }); await authorize();
	let active = await runs.active(); check();
	const previousHead = await checkpoints.current(), legacy = await input.journal.read(scope), legacyCheckpoint = previousHead ? null : await input.journal.checkpoint(scope); check();
	// Finish legacy uncertain work and lost checkpoints using its original IDs,
	// receipts and approval contract before migrating a connection's baseline.
	if (!active && !previousHead && legacy && (legacy.operations.some(op => !op.confirmed) || legacy.version === 2 ||
		(legacyCheckpoint?.runId !== legacy.id && JSON.stringify((legacy as { configuration?: unknown }).configuration) === JSON.stringify(configuration))))
		return runForegroundCloudSync(reviewed, scope, input, signal);
	if (active && JSON.stringify(active.spec.configuration) !== JSON.stringify(configuration))
		throw Error('An unfinished transfer belongs to different settings. Restore its original settings before retrying; its work has been preserved.');
	if (active?.review && !active.review.complete) {
		// No operation can start until the entire review is imported. A crash
		// here requires fresh review, never invented choices for missing pages.
		await runs.discard(active.spec); await plans.discard(active.spec.plan); active = null;
	}
	const importEntries = async (id: InventoryIdentity, rows: readonly SyncEntry[]) => {
		await inventory.begin(id);
		await pages<SyncEntry>(rows, (entries, ordinal, final) => inventory.append(id, { ordinal, entries, ...(final ? { totalEntries: rows.length } : {}) }), size);
		await inventory.seal(id); check();
	};
	const capture = async (baseline: PagedPlanSpec['baseline']) => {
		input.progress({ stage: 'scanning', confirmed: 0, total: 0 });
		await authorize(); const observed = await scan(); check();
		// Keep the current complete-scan contract until paged producers ship.
		planFileSync(observed.local, { scope, complete: true, entries: [] }, { scope, entries: [] }, { mode: 'backup', propagateDeletes: false });
		const local = identity('local'), remote = identity('remote');
		await importEntries(local, observed.local.entries);
		await inventory.beginCloud(remote, observed.inventory);
		await pages<CloudInventoryNode>(observed.inventory.nodes,
			(nodes, ordinal, final) => inventory.appendCloud(remote, { ordinal, nodes, ...(final ? { totalEntries: observed.inventory.nodes.length } : {}) }),
			// Cloud pages carry both canonical metadata and the sync projection.
			node => size(node) * 2 + 1024);
		await inventory.seal(remote); check();
		const spec: PagedPlanSpec = { id: crypto.randomUUID(), local, remote, baseline,
			policy: { mode: configuration.mode, propagateDeletes: configuration.propagateDeletes }, excludedPaths: configuration.excludedPaths };
		const result = await plans.build(spec);
		if (result.indexed > MAX_SYNC_SCAN_ENTRIES) throw Error('Combined sync scan exceeds its bounded partition.');
		return spec;
	};
	const conflicts = async (plan: PagedPlanSpec) => {
		let next: PagedPlanCursor | null = null; const rows: SyncConflict[] = [];
		do { const page = await plans.read(plan, next ?? undefined); check();
			rows.push(...page.decisions.filter((d): d is SyncConflict => d.kind === 'conflict')); next = page.next;
		} while (next);
		return rows;
	};
	let spec: PagedRunSpec;
	if (active) spec = active.spec;
	else {
		await checkpoints.changeRoots(configuration.localRootId, configuration.remoteFolderId);
		const head = await checkpoints.current(); check();
		let baseline = head?.baseline;
		if (!baseline) {
			baseline = { local: identity('local'), remote: identity('remote') };
			const old = legacyCheckpoint?.localRootId === configuration.localRootId && legacyCheckpoint.remoteFolderId === configuration.remoteFolderId
				? legacyCheckpoint.baseline.entries : [];
			await importEntries(baseline.local, old.map(p => p.local)); await importEntries(baseline.remote, old.map(p => p.remote));
		}
		let plan = await capture(baseline); const reviewedConflicts = await conflicts(plan);
		let review: PagedRunSpec['review'], choices: ReviewedSyncConflict[] = [];
		if (reviewedConflicts.length) {
			if (!input.reviewConflicts) throw Error(`${reviewedConflicts.length} sync conflicts need review. Both copies were preserved. First: ${reviewedConflicts[0].path}`);
			input.progress({ stage: 'reviewing', confirmed: 0, total: reviewedConflicts.length });
			const result = structuredClone(await input.reviewConflicts(structuredClone(reviewedConflicts))); check(); await authorize();
			const original = plan; plan = await capture(baseline); await plans.discard(original);
			const fresh = { scope, decisions: await conflicts(plan) }, retain = !Array.isArray(result) && result.action === 'retain';
			if (retain) planConflictRetention(fresh, reviewedConflicts);
			else resolveFileSyncConflicts(fresh, reviewedConflicts, result as Exclude<typeof result, { action: 'retain' }>, configuration.mode);
			const selected = new Map(Array.isArray(result) ? result.map(c => [c.path, c.from]) : []);
			review = { id: crypto.randomUUID(), kind: retain ? 'retain' : 'resolve', count: reviewedConflicts.length };
			choices = reviewedConflicts.map(conflict => parseReviewedConflict({ conflict, from: retain ? 'local' : selected.get(conflict.path)! }, review!, configuration.mode, scope));
			if (retain) {
				choices.sort((a, b) => syncPathKey(a.conflict.path) < syncPathKey(b.conflict.path) ? -1 : 1);
				const payload = new TextEncoder().encode(JSON.stringify({ configuration, choices }));
				review.id = [...new Uint8Array(await crypto.subtle.digest('SHA-256', payload))].map(b => b.toString(16).padStart(2, '0')).join('');
				const retained = await runs.retained(); check();
				if (retained?.spec.review?.id === review.id && JSON.stringify(retained.spec.configuration) === JSON.stringify(configuration)) {
					await plans.discard(plan);
					input.progress({ stage: 'retained', confirmed: retained.progress.confirmed, total: retained.progress.operations });
					return retained;
				}
			}
		}
		spec = { id: crypto.randomUUID(), plan, configuration, ...(review ? { review } : {}) };
		await authorize(); await runs.begin(spec);
		if (review) await pages<ReviewedSyncConflict>(choices, (rows, ordinal, final) => runs.appendReview(spec, { ordinal, rows, complete: final }), size);
	}
	await runs.prepare(spec); await runs.prepareCloud(spec, configuration); check();
	let state = await runs.begin(spec); const retain = spec.review?.kind === 'retain';
	const report = (value: PagedRunProgress, stage: ForegroundSyncProgress['stage'] = retain ? 'retaining' : 'transferring') => {
		state = value; input.progress({ stage, confirmed: value.confirmed, total: value.operations });
	};
	const port = await createPagedCloudSyncPort(spec, configuration, runs, {
		currentScope: input.currentScope, signal, localTarget,
		readLocal: async path => { const rows = await input.scanLocal(); check(); return rows.find(e => e.path === path) ?? null; },
		openSource: async entry => { await authorize(); return input.source(entry); },
		progress: (path, bytes, size) => { check(); input.progress({ stage: retain ? 'retaining' : 'transferring', confirmed: state.confirmed, total: state.operations, path, bytes, size }); }
	}, runtime);
	const done = await executePreparedPagedSyncRun(spec, scope, runs, port, { signal, changed: p => report(p) }); check();
	if (retain) { await runs.finishRetention(spec); report(done, 'retained'); return { spec, progress: done }; }
	report(done, 'verifying'); await authorize();
	const checkpoint = { run: spec, localRootId: configuration.localRootId, remoteFolderId: configuration.remoteFolderId };
	let draft = await checkpoints.begin(checkpoint); check();
	if (draft.phase === 'collecting') {
		draft = await checkpoints.restartCollection(checkpoint);
		const observed = await scan(); check();
		planFileSync(observed.local, observed.remote, { scope, entries: [] }, { mode: 'backup', propagateDeletes: false });
		await importEntries(draft.after.local, observed.local.entries); await importEntries(draft.after.remote, observed.remote.entries);
	}
	await checkpoints.build(checkpoint); check(); report(done, 'complete'); return { spec, progress: done };
}
