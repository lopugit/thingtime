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
export async function streamOneWayForegroundSync(
	reviewed: SavedFileSyncConfiguration,
	scope: SyncScope,
	input: ForegroundSyncInput,
	outerSignal: AbortSignal
) {
	const configuration = reviewed.configuration,
		local = configuration.mode !== 'download';
	if (
		configuration.propagateDeletes ||
		!['backup', 'upload', 'download'].includes(configuration.mode) ||
		!input.inspectLocal ||
		(local ? !input.streamLocalChanges : (!input.streamRemoteChanges && (!input.streamCloudChanges || !input.inventoryPages)) || !input.inspectLocal)
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
		if (!(await runs.retireUnstartedInitialUpload(active.spec, configuration))) return;
		retiredLocal = active.spec.plan.local;
		active = null;
		check();
	}
	const head = await checkpoints.current(),
		legacy = await input.journal.read(scope);
	check();
	if (!active && legacy?.operations.some((op) => !op.confirmed)) return;
	const fresh = (source: 'local' | 'remote') => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
	const spec: PagedRunSpec = active?.spec ?? {
		id: crypto.randomUUID(),
		configuration,
		streaming: { source: local ? 'local' : 'remote', captureId: crypto.randomUUID() },
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
	if (local && input.nativeOperationGuards && state.phase !== 'complete') await runs.enableStreamPriorities(spec);
	let priorityReadiness: PriorityReadiness | undefined;
	let lastProgress: ForegroundSyncProgress | undefined;
	const publishProgress = (value: ForegroundSyncProgress) => { lastProgress = value; input.progress(value); };
	const coverage = () => ({
		...(priorityReadiness ? { priorityReadiness } : {}),
		indexState,
		totalFinal: indexState === 'complete' && indexed === state.read,
		direction: local ? ('upload' as const) : ('download' as const),
		...(skipped === undefined ? {} : { skipped, coverage: 'partial' as const, consistency: 'per-entry' as const })
	});
	const ignore = createSyncIgnorePolicy(configuration.ignoreRules, configuration.excludedPaths);
	const report = () => publishProgress({ stage: 'transferring', confirmed: state.confirmed, total: state.operations, indexed, ...coverage() });
	const bulk = local && input.nativeOperationGuards && input.uploadBatch && !input.runtime.authorizeMutation ? input.uploadBatch : undefined;
	const folderBulk = local && input.nativeOperationGuards && input.folderBatch && !input.runtime.authorizeMutation ? input.folderBatch : undefined;
	const batching = !!bulk || !!folderBulk;
	const observableBatchEntry = (entry: SyncEntry) => (!!bulk && eligibleUploadBatchEntry(entry)) || (!!folderBulk && eligibleFolderBatchEntry(entry));
	let readinessRefresh: Promise<void> | undefined;
	let readinessAgain = false;
	const refreshReadiness = (): Promise<void> => {
		if (!local) return Promise.resolve();
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
	if (!local) report();
	input.progressSession?.({ scope: structuredClone(scope), run: structuredClone(spec) });
	const port = await createPagedCloudSyncPort(
		spec,
		configuration,
		runs,
		{
			currentScope: input.currentScope,
			signal,
			localTarget,
			readLocal,
			transfer: input.transfer,
			openSource,
			progress: (path, bytes, size) => {
				check();
				publishProgress({ stage: 'transferring', confirmed: state.confirmed, total: state.operations, indexed, path, bytes, size, ...coverage() });
			}
		},
		runtime
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
	const prepare = async (change: NativeIndexChangesPage['changes'][number], generation: string) => {
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
			try {
				const rebind = local ? await runs.targetRebind(spec, operation.id) : null;
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
					await runs.markStreamCanonicalDispatch(spec, op.id); check(); return port.apply(op, currentScope);
				} }, signal);
				check();
				state = await runs.confirm(spec, receipt);
				port.confirmed?.(operation, receipt);
			} catch (error) {
				if (!(error instanceof SyncObservationChangedError)) throw error;
				// Only a lookup=missing preflight error permits supersession.
				state = await runs.skipUnpublishedStreamOperation(spec, operation.id, error.targetChanged);
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
			const change = await runs.nextStreamInput(spec, input.nativeOperationGuards === true);
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
			await prepare(change, change.generation);
			check();
			wake();
			report();
		}
	};

	const migratePriorityInputs = async () => {
		if (!local || !input.nativeOperationGuards) return;
		const priorities = input.journal.priorities(access);
		let unpublished = 0;
		for (;;) {
			check();
			const page = await runs.backfillStreamInputs(spec);
			check();
			unpublished += page.paths.length;
			if (page.complete || unpublished >= 4096) { await refreshReadiness(); unpublished = 0; }
			const preferences = await priorities.read();
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
		const results = await Promise.allSettled([guarded(consume), guarded(plan), guarded(produce), guarded(migratePriorityInputs)]);
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
