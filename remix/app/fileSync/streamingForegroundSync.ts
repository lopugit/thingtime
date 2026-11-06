import { CLOUD_SYNC_DESTINATION_REQUIREMENTS, ExactCloudSyncDestinationChanged } from './cloudSyncDestination';
import { executeCloudFolderBatch, folderBatchFailure } from './cloudFolderBatch.client';
import { eligibleFolderBatchEntry } from './folderBatch';
import type { PriorityReadiness } from './priorityReadiness';
import { executeCloudUploadBatch, uploadBatchFailure } from './cloudUploadBatch.client';
import { eligibleUploadBatchEntry, parseUploadBatchObservations, UPLOAD_BATCH_FILES, UPLOAD_BATCH_METADATA_BYTES } from './uploadBatch';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import type { ForegroundSyncInput, ForegroundSyncProgress } from './foregroundSync';
import { foregroundSyncContext } from './foregroundSyncContext';
import { createPagedCloudSyncPort } from './cloudSyncPort.client';
import { cloudRequests } from './cloudTransport';
import { readCloudPathEntry } from './cloudPath.client';
import { cloudFileSyncEntry, parseCloudFile } from './cloudFile';
import { inventorySyncEntry, type CloudInventoryNode } from './cloudInventory';
import { parseCloudInventoryPage } from './cloudInventoryPages';
import { prepareCloudOperationBinding } from './cloudBinding';
import { executeSyncOperation, SyncObservationChangedError, type SyncOperation } from './execute';
import { decideSyncPath, sameSyncStamp, syncPathKey, type SyncEntry, type SyncScope } from './reconcile';
import { createSyncIgnorePolicy } from './syncIgnore';
import { parseNativeIndexChangesPage, type NativeIndexChangesPage } from './streamingIndex';
import type { PagedRunProgress, PagedRunSpec } from './pagedRunJournal';
import { NATIVE_INVENTORY_BATCH_ENTRIES } from './nativeInventory';
import { INVENTORY_PAGE_ENTRIES } from './inventoryJournal';

/** Streaming uses the existing durable run, scheduler and guarded transports.
 * A terminal feed releases no baseline: sealed reconciliation owns that proof. */
export async function streamForegroundSync(
	reviewed: SavedFileSyncConfiguration,
	scope: SyncScope,
	input: ForegroundSyncInput,
	outerSignal: AbortSignal
) {
	const configuration = reviewed.configuration,
		twoWay = configuration.mode === 'two-way',
		local = configuration.mode !== 'download',
		remoteFeed = !!input.streamRemoteChanges || !!(input.streamCloudChanges && input.inventoryPages),
		priorities = local && !twoWay && input.nativeOperationGuards === true;
	if (
		configuration.propagateDeletes ||
		!input.inspectLocal ||
		(local && !input.streamLocalChanges) ||
		((twoWay || !local) && !remoteFeed)
	)
		return;
	const controller = new AbortController(),
		signal = AbortSignal.any([outerSignal, controller.signal]);
	const { check, authorize, runtime, readLocal, openSource, localTarget } = foregroundSyncContext(reviewed, scope, input, signal);
	const access = { scope, currentScope: input.currentScope, signal, cleanup: 'foreground' as const };
	const runs = input.journal.pagedRuns(access),
		inventory = input.journal.inventory(access),
		checkpoints = input.journal.pagedCheckpoints(access);
	await authorize();
	let active = await runs.active();
	check();
	let retiredLocal: import('./inventoryJournal').InventoryIdentity | undefined;
	if (active && !active.spec.streaming) {
		if (twoWay || !(await runs.retireUnstartedInitialUpload(active.spec, configuration))) return;
		retiredLocal = active.spec.plan.local;
		active = null;
		check();
	}
	if (twoWay) {
		// Deploy independently of older selected origins. An unfinished early
		// run cannot fall back because its original durable effects may exist.
		try {
			for (const [feature, minimum] of Object.entries(CLOUD_SYNC_DESTINATION_REQUIREMENTS))
				await runtime.requireCapability(feature, minimum);
		} catch (error) { check(); if (active) throw error; return; }
	}
	const head = await checkpoints.current(),
		legacy = await input.journal.read(scope);
	check();
	if (!active && legacy?.operations.some((op) => !op.confirmed)) return;
	if (twoWay && head && (head.localRootId !== configuration.localRootId || head.remoteFolderId !== configuration.remoteFolderId)) return;
	if (twoWay && !active && (await runs.streamAwaitingReconciliation() || await input.journal.reviewDrafts(access).active() ||
		(!head && (legacy || await input.journal.checkpoint(scope))))) return;
	check();
	const fresh = (source: 'local' | 'remote') => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
	const spec: PagedRunSpec = active?.spec ?? {
		id: crypto.randomUUID(),
		configuration,
		streaming: { source: twoWay ? 'both' : local ? 'local' : 'remote', captureId: crypto.randomUUID() },
		plan: {
			id: crypto.randomUUID(),
			local: retiredLocal ?? fresh('local'),
			remote: fresh('remote'),
			baseline: head?.baseline ?? { local: fresh('local'), remote: fresh('remote') },
			policy: { mode: configuration.mode, propagateDeletes: false },
			excludedPaths: configuration.excludedPaths,
			...(configuration.ignoreRules ? { ignoreRules: configuration.ignoreRules } : {})
		}
	};
	if (JSON.stringify(spec.configuration) !== JSON.stringify(configuration))
		throw Error('Restore the streaming transfer’s original settings before retrying.');
	let state: PagedRunProgress = await runs.begin(spec),
		indexed = (await runs.streamState(spec)).indexedSequence ?? (await runs.streamState(spec)).sequence,
		indexState: 'indexing' | 'watching' | 'complete' = 'indexing',
		skipped: number | undefined;
	if (priorities && state.phase !== 'complete') await runs.enableStreamPriorities(spec);
	if (!state.directions) state = await runs.backfillDirections(spec) ?? state;
 let priorityReadiness: PriorityReadiness | undefined;
	let lastProgress: ForegroundSyncProgress | undefined;
	let activeFile: Pick<ForegroundSyncProgress, 'path' | 'bytes' | 'size' | 'direction'> | undefined;
	const publishProgress = (value: ForegroundSyncProgress) => { lastProgress = value; input.progress(value); };
	const coverage = () => ({
		...(priorityReadiness ? { priorityReadiness } : {}),
		indexState,
		totalFinal: !twoWay && indexState === 'complete' && indexed === state.read,
		...(!twoWay ? { direction: local ? ('upload' as const) : ('download' as const) } : {}),
		...(skipped === undefined ? {} : { skipped, coverage: 'partial' as const, consistency: 'per-entry' as const })
	});
	const ignore = createSyncIgnorePolicy(configuration.ignoreRules, configuration.excludedPaths);
	const report = () => publishProgress({ stage: 'transferring', confirmed: state.confirmed, total: state.operations, directions: state.directions, indexed, ...coverage(), ...activeFile });
	const bulk = local && !twoWay && input.nativeOperationGuards && input.uploadBatch && !input.runtime.authorizeMutation ? input.uploadBatch : undefined;
	const folderBulk = local && !twoWay && input.nativeOperationGuards && input.folderBatch && !input.runtime.authorizeMutation ? input.folderBatch : undefined;
	const batching = !!bulk || !!folderBulk;
	const observableBatchEntry = (entry: SyncEntry) => (!!bulk && eligibleUploadBatchEntry(entry)) || (!!folderBulk && eligibleFolderBatchEntry(entry));
	let readinessRefresh: Promise<void> | undefined;
	let readinessAgain = false;
	const refreshReadiness = (): Promise<void> => {
		if (!local || twoWay) return Promise.resolve();
		if (readinessRefresh) { readinessAgain = true; return readinessRefresh; }
		readinessRefresh = (async () => {
			do {
				readinessAgain = false;
				const next = await runs.streamPriorityReadiness(spec, input.nativeOperationGuards === true, folderBulk ? 'enabled' : input.runtime.authorizeMutation ? 'custom-policy' : 'not-negotiated');
				check();
				if (JSON.stringify(next) !== JSON.stringify(priorityReadiness)) {
					priorityReadiness = next;
					if (lastProgress) publishProgress({ ...lastProgress, priorityReadiness }); else report();
				}
			} while (readinessAgain);
		})().finally(() => { readinessRefresh = undefined; });
		return readinessRefresh;
	};
	await refreshReadiness();
	if (!local || twoWay) report();
	input.progressSession?.({ scope: structuredClone(scope), run: structuredClone(spec) });
	let dispatching: { id: string; first: boolean; marked: boolean } | undefined;
	const markPublication = async (operationId: string) => {
		if (dispatching?.id !== operationId || dispatching.marked) throw Error('Early publication identity changed.');
		dispatching.first = await runs.markStreamCanonicalDispatch(spec, operationId);
		dispatching.marked = true;
		check();
	};
	const port = await createPagedCloudSyncPort(
		spec,
		configuration,
		runs,
		{
			currentScope: input.currentScope,
			signal,
			localTarget,
			...(twoWay ? { beforeLocalPublication: markPublication } : {}),
			readLocal,
			transfer: input.transfer,
			openSource,
			progress: (path, bytes, size, direction) => {
				check();
				activeFile = { path, bytes, size, ...(direction ? { direction } : {}) };
				report();
			}
		},
		twoWay ? { ...runtime, beforeFilePublication: markPublication } : runtime
	);
	// A revision counter closes the lost-wakeup race around durable reads.
	let wakeRevision = 0;
	const waiters = new Set<() => void>();
	const wake = () => {
		wakeRevision++;
		for (const fn of [...waiters]) fn();
	};
	const wait = (observed: number) => {
		check();
		if (wakeRevision !== observed) return Promise.resolve();
		return new Promise<void>((resolve, reject) => {
			const done = () => {
				waiters.delete(done);
				signal.removeEventListener('abort', abort);
				resolve();
			};
			const abort = () => {
				waiters.delete(done);
				signal.removeEventListener('abort', abort);
				reject(signal.reason);
			};
			waiters.add(done);
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
		});
	};
	let observationSequences = new Map<string, number>();
	let observationNodes = new Map<string, CloudInventoryNode | null>();
	const observeBatch = async (change: NativeIndexChangesPage['changes'][number]) => {
		if (observationSequences.get(change.entry.path) === change.sequence) return observationNodes;
		const candidates = await runs.peekUploadBatchInputs(spec);
		check();
		const pathsSeen = new Set<string>();
		const inputs = [change, ...candidates].filter(input => {
			const path = syncPathKey(input.entry.path);
			if (!observableBatchEntry(input.entry) || pathsSeen.has(path)) return false;
			pathsSeen.add(path); return true;
		}).slice(0, UPLOAD_BATCH_FILES);
		const paths = inputs.map(input => input.entry.path);
		// This specific POST observes metadata only. Server auth/config/root
		// checks stay fresh; no native mutation authorization is borrowed/cached.
		const { json } = cloudRequests({ ...runtime, authorizeMutation: undefined }, scope, signal, UPLOAD_BATCH_METADATA_BYTES);
		const result = parseUploadBatchObservations(await json('/api/v1/files/batches', {
			phase: 'observe', scope, configuration: reviewed, paths
		}), paths);
		check();
		observationSequences = new Map(inputs.map(input => [input.entry.path, input.sequence]));
		observationNodes = new Map();
		const cacheNode = (path: string, node: CloudInventoryNode | null) => {
			if (observationNodes.has(path) && JSON.stringify(observationNodes.get(path)) !== JSON.stringify(node))
				throw Error('Batch parent observations changed.');
			observationNodes.set(path, node);
		};
		for (const o of result.observations) {
			cacheNode(o.path, o.node);
			const parent = o.path.split('/').slice(0, -1).join('/');
			if (parent) {
				cacheNode(parent, o.parent);
			}
		}
		return observationNodes;
	};
	const cloudNode = async (path: string, observed?: Map<string, CloudInventoryNode | null>): Promise<CloudInventoryNode | null> => {
		if (observed?.has(path)) { check(); return structuredClone(observed.get(path)!); }
		if (!input.nativeOperationGuards) await authorize();
		check();
		const entry = await readCloudPathEntry(runtime, scope, configuration.remoteFolderId, path, signal);
		check();
		if (!entry) return null;
		if (entry.kind === 'file') {
			const { negotiate, json } = cloudRequests(runtime, scope, signal);
			await negotiate({ 'api.files': '1.0.0' });
			const result = await json('/api/v1/files?' + new URLSearchParams({ id: entry.id })),
				file = parseCloudFile(result.file);
			check();
			if (!sameSyncStamp(entry, cloudFileSyncEntry(file, path))) throw Error('Cloud path changed while preparing its indexed revision.');
			return { kind: 'file', path, file };
		}
		const parent = path.split('/').slice(0, -1).join('/');
		const ancestor = parent ? await readCloudPathEntry(runtime, scope, configuration.remoteFolderId, parent, signal) : null;
		check();
		if (parent && ancestor?.kind !== 'folder') throw Error('Cloud path ancestry changed.');
		return { kind: 'folder', path, id: entry.id, revision: entry.version, folderId: ancestor?.id ?? configuration.remoteFolderId };
	};
	// A partial feed supplies only a positive source hint. A complete point
	// read from each guarded replica must independently prove the exact source
	// and destination; neither feed's missing rows can authorize anything.
    // This bounded record can only suppress an already-observed no-op folder
    // echo. It never supplies authority, ancestry or a future copy binding.
    const deferredFolderEchoes = new Map<string, { from: 'local' | 'remote'; local: SyncEntry; remote: SyncEntry }>();
	const prepareTwoWay = async (event: NonNullable<Awaited<ReturnType<typeof runs.nextStreamInput>>>) => {
		const entry = event.entry, from = event.replica!;
		const defer = async () => {
			// Keep positive folder rows for the provisional progress tree. A
			// matching ancestor often needs no operation of its own.
			state = await runs.appendStream(spec, event, null, false, entry.kind === 'folder' && !ignore.ignored(entry.path, entry.kind));
		};
		// The other replica's echo cannot supersede an in-flight publication.
		// Preserve its receipt (or uncertain ID) before advancing this path.
		for (;;) {
			const observed = wakeRevision, previous = await runs.streamPrevious(spec, entry.path);
			check();
			if (!previous) break;
			if (previous.operation.confirmed) { await defer(); return; }
			await wait(observed);
		}
		if (entry.symbolicLink || ignore.ignored(entry.path, entry.kind)) { await defer(); return; }
		if (input.nativeOperationGuards && entry.kind === 'folder' && await runs.queuedFolderPeer(spec, event)) {
			// Two positive folder hints need no early effect. They are not fresh
			// observations: strict reconciliation still decides their real state.
			check(); await defer(); return;
		}
        const echo = input.nativeOperationGuards && entry.kind === 'folder' ? deferredFolderEchoes.get(entry.path) : undefined;
        if (echo && echo.from !== from && sameSyncStamp(entry, echo[from])) {
            deferredFolderEchoes.delete(entry.path);
            await defer(); return;
        }
		let beforeLocal: SyncEntry | null = null, beforeRemote: SyncEntry | null = null;
		if (head) {
			try {
				[beforeLocal] = await inventory.entriesForPaths(head.baseline.local, [entry.path]);
				[beforeRemote] = await inventory.entriesForPaths(head.baseline.remote, [entry.path]);
			} catch {
				// Alias or unavailable baseline cannot authorize an early copy.
				check(); await defer(); return;
			}
			check();
		}
		const priorSource = from === 'local' ? beforeLocal : beforeRemote,
			priorTarget = from === 'local' ? beforeRemote : beforeLocal;
		// Most initial-feed entries already match the sealed checkpoint.
		// Save their cursor without hashing or point-reading either replica.
		if (sameSyncStamp(entry, priorSource) || priorSource?.kind === 'folder' || priorTarget?.kind === 'folder' ||
			(entry.kind === 'folder' && (priorSource || priorTarget))) { await defer(); return; }
		await authorize();
		let node: CloudInventoryNode | null, left: SyncEntry | null, right: SyncEntry | null;
		let cloudParent: CloudInventoryNode | null = null;
		const parent = entry.path.split('/').slice(0, -1).join('/');
		// Keep an evidence chain for every ancestor. A new parent must
		// already have a confirmed early creation; an existing parent must
		// be represented in the sealed baseline. Otherwise a child receipt
		// alone could not preserve a valid subtree if a parent later vanishes.
		const parts = entry.path.split('/'), ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
		const oldLeft = head ? await inventory.entriesForPaths(head.baseline.local, ancestors) : [];
		const oldRight = head ? await inventory.entriesForPaths(head.baseline.remote, ancestors) : [];
		for (const [i, ancestor] of ancestors.entries()) {
			if (oldLeft[i]?.kind === 'folder' && oldRight[i]?.kind === 'folder') continue;
			for (;;) {
				const observed = wakeRevision, dependency = await runs.streamPrevious(spec, ancestor);
				check();
				if (!dependency) { await defer(); return; }
				if (!dependency.operation.confirmed) { await wait(observed); continue; }
				if (dependency.operation.mutation.kind !== 'copy' || dependency.operation.mutation.source.kind !== 'folder' ||
					dependency.receipt?.entry?.kind !== 'folder') { await defer(); return; }
				break;
			}
		}
		let parentsReady = !parent;
		try {
			left = await readLocal(entry.path);
			node = await cloudNode(entry.path);
			right = node && inventorySyncEntry(node);
			if (parent) {
				const localParent = await readLocal(parent);
				cloudParent = await cloudNode(parent);
				parentsReady = localParent?.kind === 'folder' && cloudParent?.kind === 'folder' && !ignore.ignored(parent, 'folder');
			}
		} catch {
			// An unstable/unavailable point observation cannot produce a copy.
			// Strict reconciliation reauthorizes and reports persistent failures.
			check(); await defer(); return;
		}
		if (!parentsReady) { await defer(); return; }
		check();
		const source = from === 'local' ? left : right,
			target = from === 'local' ? right : left;
		if (!sameSyncStamp(source, entry) || target?.symbolicLink) { await defer(); return; }
        if (input.nativeOperationGuards && entry.kind === 'folder' && left?.kind === 'folder' && right?.kind === 'folder') {
            // Both current point reads proved this folder needs no early copy.
            // Only its opposite-feed, exact-stamp echo may skip those reads;
            // all actual preparation/effects keep the fresh policy checks.
            deferredFolderEchoes.delete(entry.path);
            deferredFolderEchoes.set(entry.path, { from, local: structuredClone(left), remote: structuredClone(right) });
            if (deferredFolderEchoes.size > INVENTORY_PAGE_ENTRIES) deferredFolderEchoes.delete(deferredFolderEchoes.keys().next().value!);
            await defer(); return;
        }
		// A missing previously recorded destination and all conflicting
		// edits wait for strict reconciliation.
		if (!sameSyncStamp(target, priorTarget) || (entry.kind === 'folder' && target)) { await defer(); return; }
		const decision = decideSyncPath({ path: entry.path, local: left, remote: right, beforeLocal, beforeRemote },
			{ mode: 'two-way', propagateDeletes: false }, false, false);
		if (decision.kind !== 'copy' || decision.from !== from) { await defer(); return; }
		const operation: SyncOperation = { id: crypto.randomUUID(), mutation: decision, confirmed: false };
		const binding = await prepareCloudOperationBinding(operation, scope, configuration.remoteFolderId, {
			node: path => Promise.resolve(path === entry.path ? node : cloudParent),
			operation: async () => null,
			previousTrash: async () => undefined
		});
		check();
		if (from === 'local') binding.write.guardDestination = true;
		state = await runs.appendStream(spec, event, binding);
	};
	const prepare = async (change: NonNullable<Awaited<ReturnType<typeof runs.nextStreamInput>>>) => {
		if (twoWay) return prepareTwoWay(change);
		const generation = change.generation;
		for (;;) {
			const observed = wakeRevision,
				previous = await runs.streamPrevious(spec, change.entry.path);
			check();
			if (previous && !previous.operation.confirmed) {
				await wait(observed);
				observationSequences.delete(change.entry.path);
				continue;
			}
			if (!input.nativeOperationGuards) await authorize();
			check();
			const observations = observableBatchEntry(change.entry) ? await observeBatch(change) : undefined;
			const provisional = observations?.has(change.entry.path) && observations.get(change.entry.path) === null;
			const source = local
				? provisional ? structuredClone(change.entry) : await readLocal(change.entry.path)
				: await readCloudPathEntry(runtime, scope, configuration.remoteFolderId, change.entry.path, signal);
			check();
			const event = { ...change, generation };
			if (!sameSyncStamp(source, change.entry) || ignore.ignored(change.entry.path, change.entry.kind)) {
				state = await runs.appendStream(spec, event, null, false, false);
				wake();
				return;
			}
			const node = await cloudNode(change.entry.path, provisional ? observations : undefined),
				target = local ? node && inventorySyncEntry(node) : await readLocal(change.entry.path);
			check();
			let beforeLocal: SyncEntry | null = null,
				beforeRemote: SyncEntry | null = null;
			if (head) {
				[beforeLocal] = await inventory.entriesForPaths(head.baseline.local, [change.entry.path]);
				[beforeRemote] = await inventory.entriesForPaths(head.baseline.remote, [change.entry.path]);
				check();
			}
			if (previous?.receipt && previous.operation.mutation.kind === 'copy') {
				if (local) {
					beforeLocal = previous.operation.mutation.source;
					beforeRemote = previous.receipt.entry;
				} else {
					beforeLocal = previous.receipt.entry;
					beforeRemote = previous.operation.mutation.source;
				}
			}
			const decision = decideSyncPath(
				{ path: change.entry.path, local: local ? source : target, remote: local ? target : source, beforeLocal, beforeRemote },
				{ mode: configuration.mode, propagateDeletes: false },
				false,
				false
			);
			if (decision.kind !== 'copy') {
				state = await runs.appendStream(spec, event, null, decision.kind === 'conflict');
				wake();
				report();
				return;
			}
			const operation: SyncOperation = { id: crypto.randomUUID(), mutation: decision, confirmed: false };
			const binding = await prepareCloudOperationBinding(operation, scope, configuration.remoteFolderId, {
				node: (path) => (path === change.entry.path ? Promise.resolve(node) : cloudNode(path, provisional ? observations : undefined)),
				operation: (path) => runs.find(spec, path),
				previousTrash: async () => undefined
			});
			check();
			state = await runs.appendStream(spec, event, binding);
			wake();
			report();
			return;
		}
	};
	const cloudChanges = async function* (after: number): AsyncGenerator<NativeIndexChangesPage> {
		let sequence = after,
			ordinal = 0,
			generation: string | undefined,
			revision: string | undefined,
			count = 0,
			terminal = false;
		// Restart with a fresh snapshot after draining uncertain original IDs.
		// Confirmed equal paths settle without copying the same bytes again.
		for await (const value of input.inventoryPages!({ signal })) {
			check();
			const page = parseCloudInventoryPage(value, configuration.remoteFolderId);
			if (
				terminal ||
				page.ordinal !== ordinal++ ||
				(generation !== undefined && generation !== page.generation) ||
				(revision !== undefined && revision !== page.rootRevision)
			)
				throw Error('Cloud streaming generation changed.');
			generation = page.generation;
			revision = page.rootRevision;
			count += page.nodes.length;
			if (page.totalEntries !== undefined && page.totalEntries !== count) throw Error('Cloud streaming completion changed.');
			const changes = page.nodes.map((node) => {
				const entry = inventorySyncEntry(node);
				return { sequence: ++sequence, revision: entry.version, entry };
			});
			terminal = page.totalEntries !== undefined;
			yield {
				id: spec.streaming!.captureId,
				generation: spec.streaming!.captureId,
				state: terminal ? 'complete' : 'running',
				revision: sequence,
				changes,
				nextSequence: sequence,
				hasMore: false
			};
		}
		if (!terminal) throw Error('Cloud streaming inventory is incomplete.');
	};
	const consume = async () => {
		for (;;) {
			const observed = wakeRevision;
			check();
			if (batching) {
				const batch = await runs.claimTransferBatch(spec, reviewed, !!folderBulk);
				if (batch) {
					await refreshReadiness();
					try {
						if (('kind' in batch && !folderBulk) || (!('kind' in batch) && !bulk)) { await runs.recoverUploadBatch(spec); wake(); continue; }
						const failures = 'kind' in batch ? await executeCloudFolderBatch(batch, folderBulk!, runtime, signal, {
							markCommit: ordinals => runs.markUploadBatchCommit(spec, batch.batchId, ordinals),
							confirm: async receipt => { state = await runs.confirm(spec, receipt); check(); },
							folder: () => input.transfer?.({ direction: 'upload', kind: 'folder' })
						}) : await executeCloudUploadBatch(batch, bulk!, runtime, signal, {
							markCommit: ordinals => runs.markUploadBatchCommit(spec, batch.batchId, ordinals),
							confirm: async receipt => { state = await runs.confirm(spec, receipt); check(); },
							transfer: input.transfer
						});
						if (failures.length) {
							await runs.recoverUploadBatch(spec);
							const stop = failures.find(f => f.retryable || f.code === 'authority-changed' || f.code === 'invalid-member' || f.code === 'cancelled');
							if (stop) throw 'kind' in batch ? folderBatchFailure(stop as import('./folderBatch').FolderBatchFailure) : uploadBatchFailure(stop as import('./uploadBatch').UploadBatchFailure);
						}
					} catch (error) {
						// Never regroup effects with lost replies. The durable per-member
						// dispatch fence follows them into receipt-first single recovery.
						if (!signal.aborted) await runs.recoverUploadBatch(spec);
						throw error;
					}
					await refreshReadiness();
					wake(); report(); continue;
				}
			} else await runs.recoverUploadBatch(spec);
			const operation = await runs.claimNext(spec, input.nativeOperationGuards === true, batching ? 512 : 128, batching, false, !!folderBulk);
			await refreshReadiness();
			check();
			if (!operation) {
				const status = await runs.streamState(spec);
				check();
				if (status.terminal) return;
				await wait(observed);
				continue;
			}
			let applyEntered = false;
			dispatching = { id: operation.id, first: false, marked: false };
			try {
				const rebind = local && !twoWay ? await runs.targetRebind(spec, operation.id) : null;
				check();
				if (rebind) {
					const prior = await port.lookup(operation.id, scope);
					check();
					if (prior.status === 'pending') throw Error('Original dependent publication is still pending; retain its identity.');
					if (prior.status === 'complete') {
						state = await runs.confirm(spec, prior.receipt); port.confirmed?.(operation, prior.receipt);
					} else if (!rebind.undispatched) {
						throw Error('Original child publication may still be in flight; preserve its identity for reconciliation.');
					} else if (rebind.recovery || !rebind.parentId) {
						await runs.deferTargetRebind(spec, operation.id);
					} else {
						const source = await readLocal(operation.mutation.path);
						check();
						if (operation.mutation.kind !== 'copy' || !sameSyncStamp(source, operation.mutation.source)) throw new SyncObservationChangedError(true, false);
						const parentPath = operation.mutation.path.split('/').slice(0, -1).join('/');
						const parent = await readCloudPathEntry(runtime, scope, configuration.remoteFolderId, parentPath, signal);
						check();
						if (parent?.kind !== 'folder' || parent.id !== rebind.parentId) throw Error('Replacement parent changed; retain the original target intent.');
						await runs.rebindStreamTarget(spec, operation.id, source!, rebind.parentId);
					}
					await refreshReadiness();
					wake(); report(); continue;
				}
				const receipt = await executeSyncOperation(operation, scope, { ...port, apply: async (op, currentScope) => {
					applyEntered = true;
					if (!twoWay) await markPublication(op.id);
					check(); return port.apply(op, currentScope);
				} }, signal);
				check();
				state = await runs.confirm(spec, receipt);
				port.confirmed?.(operation, receipt);
			} catch (error) {
				// An explicit, transactional rejection of the first guarded
				// dispatch proves no effect. A previous uncertain attempt still
				// owns its original ID even if this retry is refused.
				if (twoWay && dispatching.first && error instanceof ExactCloudSyncDestinationChanged) {
					state = await runs.skipUnpublishedStreamOperation(spec, operation.id, true, true);
				} else if (error instanceof SyncObservationChangedError) {
					state = await runs.skipUnpublishedStreamOperation(spec, operation.id, error.targetChanged);
				} else if (twoWay && applyEntered && !dispatching.marked && operation.mutation.kind === 'copy') {
					// Staging bytes has no live effect. A source or target may
					// change mid-transfer; exact point reads decide whether to
					// defer, while a persisted prior dispatch still forbids it.
					check();
					const m = operation.mutation, targetSide = m.from === 'local' ? 'remote' : 'local';
					let sourceChanged = false, targetChanged = false;
					try {
						sourceChanged = !sameSyncStamp(m.source, await port.read(m.from, m.path));
						targetChanged = !sameSyncStamp(m.expectedTarget, await port.read(targetSide, m.path));
					} catch { check(); throw error; }
					if (!sourceChanged && !targetChanged) throw error;
					state = await runs.skipUnpublishedStreamOperation(spec, operation.id, targetChanged);
				} else throw error;
			} finally {
				dispatching = undefined; activeFile = undefined;
			}
			check();
			wake();
			report();
		}
	};
	const readyToFinish = () => runs.streamReadyToFinish(spec);
	const produce = async () => {
		let status = await runs.streamState(spec);
		check();
		if (status.terminal || status.sourceTerminal) return;
		const after = status.indexedSequence ?? status.sequence;
		const source = local
			? input.streamLocalChanges!(spec.streaming!.captureId, after, signal, readyToFinish)
			: input.streamRemoteChanges
			? input.streamRemoteChanges(spec.streaming!.captureId, after, signal, readyToFinish, {
					cursor: status.sourceCursor,
					snapshotComplete: status.snapshotComplete,
					checkpoint: async (cursor, complete) => {
						const current = await runs.streamState(spec);
						check();
						await runs.checkpointStreamSource(spec, current.indexedSequence ?? current.sequence, cursor, complete);
					}
			  })
			: cloudChanges(after);
		for await (const raw of source) {
			check();
			const page = parseNativeIndexChangesPage(
				raw,
				spec.streaming!.captureId,
				status.indexedSequence ?? status.sequence,
				local ? NATIVE_INVENTORY_BATCH_ENTRIES : undefined
			);
			if (status.generation !== null && status.generation !== page.generation) throw Error('Streaming source generation changed.');
			const terminal = page.state === 'complete' && !page.hasMore;
			// Large native transport batches amortize host authentication and code
			// verification; durable writes and first-ready wakes remain bounded.
			for (let offset = 0; offset < Math.max(1, page.changes.length); offset += INVENTORY_PAGE_ENTRIES) {
				const chunk = page.changes.slice(offset, offset + INVENTORY_PAGE_ENTRIES),
					last = offset + chunk.length === page.changes.length;
				await runs.appendStreamInput(spec, page.generation, chunk, terminal && last);
				check();
				indexed = chunk.at(-1)?.sequence ?? page.nextSequence;
				skipped = page.totalSkipped;
				if (last) indexState = terminal ? 'complete' : ['indexed', 'complete'].includes(page.state) ? 'watching' : 'indexing';
				wake();
				if (offset === 0 || last) report();
			}
			status = await runs.streamState(spec);
			check();
			wake();
			report();
			if (terminal) return;
		}
		throw Error('Streaming source ended without a terminal watermark.');
	};
	const produceReplica = async (replica: 'local' | 'remote') => {
		const status = await runs.streamState(spec);
		check();
		if (status.terminal || status.replicaFeeds?.[replica]?.terminal) return;
		let after = status.replicaFeeds?.[replica]?.sequence ?? 0;
		const captureId = spec.streaming!.captureId;
		// Local and cloud watchers have independent upstream watermarks; the
		// shared journal assigns an ordered input position on each append.
		const source = replica === 'local'
			? input.streamLocalChanges!(captureId, after, signal, readyToFinish)
			: input.streamRemoteChanges
			? input.streamRemoteChanges(captureId, after, signal, readyToFinish, {
				cursor: status.sourceCursor,
				snapshotComplete: status.snapshotComplete,
				checkpoint: (cursor, complete) => runs.checkpointStreamSource(spec, after, cursor, complete)
			})
			: cloudChanges(after);
		for await (const raw of source) {
			check();
			const page = parseNativeIndexChangesPage(raw, captureId, after, replica === 'local' ? NATIVE_INVENTORY_BATCH_ENTRIES : undefined);
			if (page.state === 'interrupted') throw Error('A two-way source was interrupted. Its durable cursor has been preserved.');
			const terminal = page.state === 'complete' && !page.hasMore;
			for (let offset = 0; offset < Math.max(1, page.changes.length); offset += INVENTORY_PAGE_ENTRIES) {
				const chunk = page.changes.slice(offset, offset + INVENTORY_PAGE_ENTRIES);
				await runs.appendReplicaStreamInput(spec, replica, page.generation, after, chunk, terminal && offset + chunk.length === page.changes.length);
				after += chunk.length;
				indexed += chunk.length;
				check(); wake(); report();
			}
			if (terminal) {
				const latest = await runs.streamState(spec);
				check();
				if (latest.sourceTerminal) indexState = 'complete';
				wake(); report();
				return;
			}
		}
		throw Error('A two-way source ended without a terminal watermark.');
	};
	const plan = async () => {
		for (;;) {
			const observed = wakeRevision,
				status = await runs.streamState(spec);
			check();
			if (status.terminal) return;
			// Select only after a slot opens: priorities may have changed while
			// waiting, and the durable producer keeps indexing independently.
			while (state.operations - state.confirmed >= (batching ? 512 : 128)) {
				const observed = wakeRevision;
				await wait(observed);
			}
			const change = await runs.nextStreamInput(spec, priorities);
			await refreshReadiness();
			check();
			if (!change) {
				if (status.sourceTerminal) {
					const caughtUp = await runs.streamState(spec);
					state = await runs.sealStream(spec, caughtUp.generation!, caughtUp.indexedSequence ?? caughtUp.sequence);
					check();
					wake();
					return;
				}
				await wait(observed);
				continue;
			}
			await prepare(change);
			check();
			wake();
			report();
		}
	};

	const migratePriorityInputs = async () => {
		if (!priorities) return;
		const preferencesJournal = input.journal.priorities(access);
		let unpublished = 0;
		for (;;) {
			check();
			const page = await runs.backfillStreamInputs(spec);
			check();
			unpublished += page.paths.length;
			if (page.complete || unpublished >= 4096) { await refreshReadiness(); unpublished = 0; }
			const preferences = await preferencesJournal.read();
			const relevant = page.paths.some((path) =>
				preferences.paths.some((requested) => {
					const prefix = syncPathKey(requested);
					return path === prefix || path.startsWith(prefix + '/');
				})
			);
			if (page.complete || relevant) wake();
			if (page.complete) return;
			// Yield between bounded, resumable local pages. Uploads and the source
			// producer remain independent; no network or model observer is involved.
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}
	};

	try {
		const guarded = async (work: () => Promise<void>) => {
			try {
				await work();
			} catch (error) {
				controller.abort(error);
				wake();
				throw error;
			}
		};
		const producers = twoWay ? [guarded(() => produceReplica('local')), guarded(() => produceReplica('remote'))] : [guarded(produce)];
		const results = await Promise.allSettled([guarded(consume), guarded(plan), ...producers, guarded(migratePriorityInputs)]);
		const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
		if (failed) throw failed.reason;
		check();
		await runs.finishStream(spec);
		check();
		return spec;
	} finally {
		controller.abort();
		wake();
	}
}

// Compatibility for the existing one-way callers and regression fixtures.
export const streamOneWayForegroundSync = streamForegroundSync;
