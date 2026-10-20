import type { SavedFileSyncConfiguration } from './configuredPlan';
import type { ForegroundSyncInput } from './foregroundSync';
import { foregroundSyncContext } from './foregroundSyncContext';
import { createPagedCloudSyncPort } from './cloudSyncPort.client';
import { cloudRequests } from './cloudTransport';
import { readCloudPathEntry } from './cloudPath.client';
import { cloudFileSyncEntry, parseCloudFile } from './cloudFile';
import { inventorySyncEntry, type CloudInventoryNode } from './cloudInventory';
import { parseCloudInventoryPage } from './cloudInventoryPages';
import { prepareCloudOperationBinding } from './cloudBinding';
import { executeSyncOperation, SyncObservationChangedError, type SyncOperation } from './execute';
import { decideSyncPath, sameSyncStamp, type SyncEntry, type SyncScope } from './reconcile';
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
	const coverage = () => ({
		indexState,
		totalFinal: indexState === 'complete' && indexed === state.read,
		direction: local ? ('upload' as const) : ('download' as const),
		...(skipped === undefined ? {} : { skipped, coverage: 'partial' as const, consistency: 'per-entry' as const })
	});
	const ignore = createSyncIgnorePolicy(configuration.ignoreRules, configuration.excludedPaths);
	const report = () => input.progress({ stage: 'transferring', confirmed: state.confirmed, total: state.operations, indexed, ...coverage() });
	report();
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
				input.progress({ stage: 'transferring', confirmed: state.confirmed, total: state.operations, indexed, path, bytes, size, ...coverage() });
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
	const cloudNode = async (path: string): Promise<CloudInventoryNode | null> => {
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
				continue;
			}
			if (!input.nativeOperationGuards) await authorize();
			check();
			const source = local
				? await readLocal(change.entry.path)
				: await readCloudPathEntry(runtime, scope, configuration.remoteFolderId, change.entry.path, signal);
			check();
			const event = { ...change, generation };
			if (!sameSyncStamp(source, change.entry) || ignore.ignored(change.entry.path, change.entry.kind)) {
				state = await runs.appendStream(spec, event, null, false, false);
				wake();
				return;
			}
			const node = await cloudNode(change.entry.path),
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
				node: (path) => (path === change.entry.path ? Promise.resolve(node) : cloudNode(path)),
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
			const operation = await runs.claimNext(spec);
			check();
			if (!operation) {
				const status = await runs.streamState(spec);
				check();
				if (status.terminal) return;
				await wait(observed);
				continue;
			}
			try {
				const receipt = await executeSyncOperation(operation, scope, port, signal);
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
			const page = parseNativeIndexChangesPage(raw, spec.streaming!.captureId, status.indexedSequence ?? status.sequence, local ? NATIVE_INVENTORY_BATCH_ENTRIES : undefined);
			if (status.generation !== null && status.generation !== page.generation) throw Error('Streaming source generation changed.');
			const terminal = page.state === 'complete' && !page.hasMore;
			// Large native transport batches amortize host authentication and code
			// verification; durable writes and first-ready wakes remain bounded.
			for (let offset = 0; offset < Math.max(1, page.changes.length); offset += INVENTORY_PAGE_ENTRIES) {
				const chunk = page.changes.slice(offset, offset + INVENTORY_PAGE_ENTRIES), last = offset + chunk.length === page.changes.length;
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
			const change = await runs.nextStreamInput(spec);
			check();
			if (!change) {
				if (status.sourceTerminal) {
					state = await runs.sealStream(spec, status.generation!, status.indexedSequence ?? status.sequence);
					check();
					wake();
					return;
				}
				await wait(observed);
				continue;
			}
			while (state.operations - state.confirmed >= 128) {
				const observed = wakeRevision;
				await wait(observed);
			}
			await prepare(change, change.generation);
			check();
			wake();
			report();
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
		const results = await Promise.allSettled([guarded(consume), guarded(plan), guarded(produce)]);
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
