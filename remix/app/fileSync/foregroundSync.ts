import { localTrashContexts } from './localTrash';
import type { LocalSyncTarget } from './localSyncTarget';
import { planConflictRetention, resolveFileSyncConflicts, type SyncConflict, type SyncConflictReviewResult } from './conflictResolution';
import { parseFileSyncConfiguration } from './configuration';
import { planConfiguredFileSync, readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration, type SyncConditions } from './configuredPlan';
import { createSyncRun, executeSyncRun, executeRetentionRun, type SyncRun } from './execute';
import { advanceSyncBaseline, validateSyncCheckpoint } from './checkpoint';
import { parseCloudSyncRun, prepareCloudInventoryRun, isCloudFolderWrite, type CloudSyncRun } from './cloudWrite';
import { inventorySyncEntry, parseCloudInventory, type CloudInventory } from './cloudInventory';
import { createCloudSyncPort } from './cloudSyncPort.client';
import { createCloudFileTransport, createCloudFolderTransport, type CloudTransportRuntime } from './cloudTransport';
import type { FingerprintSource } from './contentFingerprint';
import type { openSyncJournal } from './journal.client';
import { sameSyncScope, type SyncEntry, type SyncScope, type SyncBaseline } from './reconcile';

export type ForegroundSyncProgress = {
	stage: 'checking' | 'scanning' | 'reviewing' | 'transferring' | 'verifying' | 'complete' | 'retaining' | 'retained';
	confirmed: number;
	total: number;
	path?: string;
	bytes?: number;
	size?: number;
};
type ConfiguredRun = CloudSyncRun & { configuration: ReturnType<typeof parseFileSyncConfiguration>; startingBaseline: SyncBaseline };
/** One explicitly requested foreground run. The caller owns a root lock for
 * this whole lifecycle; this never launches work merely because a Thing exists. */
export async function runForegroundCloudSync(
	reviewed: SavedFileSyncConfiguration,
	scope: SyncScope,
	input: {
		currentScope(): SyncScope;
		readConfiguration(): Promise<unknown>;
		authorizeDevice(): Promise<void>;
		conditions(): Promise<SyncConditions>;
		scanLocal(): Promise<SyncEntry[]>;
		inventory(): Promise<CloudInventory>;
		source(entry: SyncEntry): Promise<FingerprintSource>;
		localTarget?: LocalSyncTarget;
		journal: Awaited<ReturnType<typeof openSyncJournal>>;
		runtime: CloudTransportRuntime;
		progress(value: ForegroundSyncProgress): void;
		reviewConflicts?(conflicts: SyncConflict[]): Promise<SyncConflictReviewResult>;
	},
	signal: AbortSignal
) {
	const configuration = parseFileSyncConfiguration(reviewed.configuration);
	if (
		['download', 'two-way'].includes(configuration.mode) &&
		(!input.localTarget || (configuration.propagateDeletes && (!input.localTarget.trash || !input.localTarget.trashExpected)))
	)
		throw Error('Downloads and two-way sync require native write approval; deletion propagation requires recoverable native Trash.');
	const approved = { ...structuredClone(reviewed), configuration, scope: { ...scope } };
	const empty = { scope, complete: true, entries: [] };
	const check = () => {
		signal.throwIfAborted();
		if (!sameSyncScope(scope, input.currentScope())) throw Error('Sync context changed.');
	};
	const authorize = async () => {
		check();
		const current = readOwnedFileSyncConfiguration(await input.readConfiguration(), scope.ownerId);
		check();
		await input.authorizeDevice();
		check();
		const conditions = await input.conditions();
		check();
		const result = planConfiguredFileSync({
			saved: current,
			approval: approved,
			local: empty,
			remote: empty,
			baseline: { scope, entries: [] },
			localRootId: configuration.localRootId,
			remoteFolderId: configuration.remoteFolderId,
			conditions
		});
		if (result.status === 'waiting')
			throw Error(
				{
					paused: 'This connection is paused.',
					offline: 'Waiting for an internet connection.',
					network: 'Waiting for the selected network.',
					charging: 'Waiting for this device to charge.'
				}[result.reason]
			);
		return conditions;
	};
	input.progress({ stage: 'checking', confirmed: 0, total: 0 });
	await authorize();
	const checkpoint = await input.journal.checkpoint(scope);
	check();
	let baseline: SyncBaseline =
		checkpoint && checkpoint.localRootId === configuration.localRootId && checkpoint.remoteFolderId === configuration.remoteFolderId
			? checkpoint.baseline
			: { scope, entries: [] };
	const scan = async () => {
		const entries = await input.scanLocal();
		check();
		const inventory = parseCloudInventory(await input.inventory(), configuration.remoteFolderId);
		check();
		return {
			local: { scope, complete: true, entries },
			remote: { scope, complete: true, entries: inventory.nodes.map(inventorySyncEntry) },
			inventory
		};
	};
	const runtime: CloudTransportRuntime = {
		...input.runtime,
		currentScope: input.currentScope,
		authorizeMutation: async () => {
			check();
			await input.runtime.authorizeMutation?.(signal);
			await authorize();
			check();
		},
		fetch: async (url, init) => {
			check();
			const result = await input.runtime.fetch(url, init);
			check();
			return result;
		}
	};
	const existing = await input.journal.read(scope);
	check();
	const recordedBaseline = async (saved: ConfiguredRun) => {
		validateSyncCheckpoint(
			{
				version: 1,
				runId: saved.id,
				localRootId: configuration.localRootId,
				remoteFolderId: configuration.remoteFolderId,
				baseline: saved.startingBaseline
			},
			scope
		);
		const trashContexts = localTrashContexts(saved);
		const pairs = new Map(saved.startingBaseline.entries.map((pair) => [pair.path, pair]));
		const operations = new Map(saved.operations.map((operation) => [operation.id, operation]));
		for (const write of saved.cloudWrites) {
			const operation = operations.get(write.operation.id)!;
			if (!operation.confirmed) continue;
			const downloading = operation.mutation.kind === 'copy' ? operation.mutation.from === 'remote' : operation.mutation.side === 'local';
			const transport = downloading
				? { lookup: () => input.localTarget!.lookup({ ...write.operation, confirmed: false }, scope, trashContexts.get(operation.id)) }
				: isCloudFolderWrite(write)
				? createCloudFolderTransport(runtime, write, signal)
				: createCloudFileTransport(runtime, write, signal);
			const result = await transport.lookup();
			check();
			if (result.status !== 'complete') throw Error('A confirmed operation receipt is unavailable. Its run and prior baseline were preserved.');
			const m = operation.mutation;
			if (m.kind === 'copy' && result.receipt.entry)
				pairs.set(m.path, {
					path: m.path,
					local: downloading ? result.receipt.entry : m.source,
					remote: downloading ? m.source : result.receipt.entry
				});
			else if (m.kind === 'trash') pairs.delete(m.path);
		}
		return { scope, entries: [...pairs.values()] };
	};
	if (
		existing &&
		existing.version === 1 &&
		existing.operations.every((op) => op.confirmed) &&
		checkpoint?.runId !== existing.id &&
		JSON.stringify((existing as ConfiguredRun).configuration) === JSON.stringify(configuration)
	)
		baseline = await recordedBaseline(parseCloudSyncRun(existing) as ConfiguredRun);
	let run: ConfiguredRun;
	let retain = false;
	if (existing && existing.operations.some((op) => !op.confirmed)) {
		run = parseCloudSyncRun(existing) as ConfiguredRun;
		retain = run.version === 2;
		validateSyncCheckpoint(
			{
				version: 1,
				runId: run.id,
				localRootId: configuration.localRootId,
				remoteFolderId: configuration.remoteFolderId,
				baseline: run.startingBaseline
			},
			scope
		);
		if (JSON.stringify(parseFileSyncConfiguration(run.configuration)) !== JSON.stringify(configuration))
			throw Error(
				'An unfinished transfer belongs to different settings. Restore its original settings before retrying; its work has been preserved.'
			);
	} else {
		input.progress({ stage: 'scanning', confirmed: 0, total: 0 });
		let observed = await scan();
		// A completed run may have lost its checkpoint write. Fresh agreement can
		// advance that baseline; divergent content retains the last common evidence.
		baseline = advanceSyncBaseline(baseline, observed.local, observed.remote);
		const conditions = await authorize();
		let planned = planConfiguredFileSync({
			saved: reviewed,
			approval: approved,
			...observed,
			baseline,
			localRootId: configuration.localRootId,
			remoteFolderId: configuration.remoteFolderId,
			conditions
		});
		if (planned.status !== 'ready') throw Error('Transfer conditions changed. Try again.');
		const conflicts = planned.plan.decisions.filter((d) => d.kind === 'conflict');
		if (conflicts.length && !input.reviewConflicts)
			throw Error(
				`${conflicts.length} sync conflict${conflicts.length === 1 ? '' : 's'} need review. Both copies were preserved. First: ${conflicts[0].path}`
			);
		if (conflicts.length) {
			const reviewedConflicts = structuredClone(conflicts);
			input.progress({ stage: 'reviewing', confirmed: 0, total: conflicts.length });
			const choices = structuredClone(await input.reviewConflicts!(structuredClone(reviewedConflicts)));
			check();
			await authorize();
			input.progress({ stage: 'scanning', confirmed: 0, total: 0 });
			observed = await scan();
			planned = planConfiguredFileSync({
				saved: reviewed,
				approval: approved,
				...observed,
				baseline,
				localRootId: configuration.localRootId,
				remoteFolderId: configuration.remoteFolderId,
				conditions: await authorize()
			});
			if (planned.status !== 'ready') throw Error('Transfer conditions changed. Try again.');
			retain = !Array.isArray(choices) && choices.action === 'retain';
			planned = {
				status: 'ready',
				plan: retain
					? planConflictRetention(planned.plan, reviewedConflicts)
					: resolveFileSyncConflicts(
							planned.plan,
							reviewedConflicts,
							choices as Exclude<SyncConflictReviewResult, { action: 'retain' }>,
							configuration.mode
					  )
			};
		}
		run = {
			...prepareCloudInventoryRun(createSyncRun(planned.plan), observed.inventory),
			configuration,
			startingBaseline: structuredClone(baseline)
		};
		if (retain) {
			run = { ...run, version: 2, intent: 'retain-conflicts' };
			// Repeating Ignore for the same pair reuses its saved operation IDs
			// and receipts instead of uploading/accounting a duplicate copy.
			if (existing?.version === 2) {
				const previous = parseCloudSyncRun(existing) as ConfiguredRun;
				const identity = (value: ConfiguredRun) =>
					JSON.stringify({
						configuration: value.configuration,
						writes: value.cloudWrites.map((w) => ({ mutation: w.operation.mutation, folderId: w.folderId, before: w.before }))
					});
				if (identity(previous) === identity(run)) run = previous;
			}
		}
	}
	let confirmedCount = run.operations.filter((op) => op.confirmed).length;
	const report = (value: SyncRun, stage: ForegroundSyncProgress['stage'] = retain ? 'retaining' : 'transferring') => {
		confirmedCount = value.operations.filter((op) => op.confirmed).length;
		input.progress({ stage, confirmed: confirmedCount, total: value.operations.length });
	};
	const port = createCloudSyncPort(
		run,
		{
			cloudRootId: run.configuration.remoteFolderId,
			currentScope: input.currentScope,
			persist: async (value) => {
				check();
				await input.journal.persist({ ...value, configuration } as ConfiguredRun);
				check();
				report(value);
			},
			readLocal: async (path) => {
				const entries = await input.scanLocal();
				check();
				return entries.find((entry) => entry.path === path) ?? null;
			},
			openSource: async (entry) => {
				await authorize();
				return input.source(entry);
			},
			localTarget: input.localTarget
				? {
						lookup: (operation, current, context) => input.localTarget!.lookup(operation, current, context),
						...(input.localTarget.trash
							? {
									trash: async (operation, current, context) => {
										await authorize();
										return input.localTarget!.trash!(operation, current, context);
									}
							  }
							: {}),
						...(input.localTarget.trashExpected
							? {
									trashExpected: async (operation, current, context) => {
										await authorize();
										return input.localTarget!.trashExpected!(operation, current, context);
									}
							  }
							: {}),
						stage: async (operation, current, source) => {
							await authorize();
							return input.localTarget!.stage(operation, current, source);
						},
						publish: async (operation, current, staged) => {
							await authorize();
							return input.localTarget!.publish(operation, current, staged);
						}
				  }
				: undefined,
			signal,
			progress: (path, bytes, size) => {
				check();
				input.progress({
					stage: retain ? 'retaining' : 'transferring',
					confirmed: confirmedCount,
					total: run.operations.length,
					path,
					bytes,
					size
				});
			}
		},
		runtime
	);
	const done = await (retain ? executeRetentionRun : executeSyncRun)(run, port, signal);
	check();
	if (retain) {
		report(done, 'retained');
		return done;
	}
	report(done, 'verifying');
	await authorize();
	baseline = await recordedBaseline({ ...run, operations: done.operations });
	const observed = await scan();
	baseline = advanceSyncBaseline(baseline, observed.local, observed.remote);
	check();
	await input.journal.complete({
		version: 1,
		runId: done.id,
		localRootId: configuration.localRootId,
		remoteFolderId: configuration.remoteFolderId,
		baseline
	});
	check();
	report(done, 'complete');
	return done;
}
