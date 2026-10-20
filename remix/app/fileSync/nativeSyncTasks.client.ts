import { readCloudIndexChanges } from './cloudIndexChanges.client';
import { readNativeIndexChanges } from './streamingIndex';
import { SyncConditionsWait } from './foregroundSyncContext';
import { SyncConnectionWait, isSyncConnectionFailure } from './syncConnectionWait';
import { pauseSyncJobAdmission, type SyncJob } from './syncJobJournal';
import { holdDesktopSyncWindow, setDesktopSyncScheduled } from './desktopSyncWindow.client';
import { createNativeSyncHost, getNativeSyncAdapter, isNativeSyncAdapterCurrent } from './nativeSyncHost.client';
import { watchNativeSyncVisibility } from './nativeSyncVisibility';
import { rootIdentity } from '../utils/rootIdentity';
import { createSyncTaskRuntime } from './syncTaskRuntime';
import { openSyncJournal, withSyncRootLock, syncScopeKey } from './journal.client';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { readNativeInventory, NATIVE_INVENTORY_BATCH_ENTRIES, NativeInventoryRetryWait, type LocalInventoryPage, type NativeBackupCapture } from './nativeInventory';
import type { ForegroundSyncInput } from './foregroundSync';
import type { InventoryIdentity } from './inventoryJournal';
import { readCloudFolderInventoryPages } from './cloudInventoryPages.client';
import { readCloudFolderInventory } from './cloudInventory.client';
import { mobileFolderSource, supportsNativeInventoryPages, supportsNativePathInspection, supportsNativeBackupCapture, supportsNativeIgnoreRules, supportsNativeInventoryBatches, supportsNativeStreamingIndex } from './mobileFolders.client';
import { approveMobileSyncTarget } from './mobileSyncTarget.client';
import { assertPhotoSourcePolicy } from './photoSourcePolicy';
import { createConflictReviewController } from './conflictReviewController';
import type { PagedConflictReviewResult } from './pagedForegroundReview';
import type { SyncConflictReviewResult } from './conflictResolution';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import type { SyncScope } from './reconcile';
import { writeStampedCache, pruneCacheNamespace } from '../hooks/localCache';
import { TIMELINE_CHANGED_EVENT } from '../timeline/clientEvents';

export const nativeSyncTasks = createSyncTaskRuntime();
export const supportsNativeSyncTasks = () => !!getNativeSyncAdapter();

/** Explicit runs persist admission separately from editable connection Things.
 * Relaunch resumes only that admitted job, using existing native consent. */
export async function startNativeSyncTask(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number, resume?: SyncJob, intervalMs?: number) {
	const adapter = getNativeSyncAdapter();
	if (!adapter) throw Error('Update Thingtime to continue sync outside this screen.');
	const reviewed = structuredClone(saved), binding = structuredClone(scope);
	if (binding.dataPlane !== 'home' || binding.rootId !== reviewed.id || binding.deviceId !== reviewed.configuration.deviceId)
		throw Error('The file sync connection changed.');
	let stopRequested = false, saveStop: (() => Promise<void>) | undefined, cancelCapture: (() => Promise<void>) | undefined;
	await nativeSyncTasks.start(binding, async (signal, update) => {
		const checkIdentity = () => {
			if (rootIdentity.read().pending || rootIdentity.read().generation !== generation || !isNativeSyncAdapterCurrent(adapter))
				throw Error('The active account changed. Reopen folder access.');
		};
		const visibility = adapter.platform === 'ios' ? watchNativeSyncVisibility(signal, message => nativeSyncTasks.suspend(message)) : undefined;
		const check = () => { signal.throwIfAborted(); checkIdentity(); visibility?.check(); };
		const changed = () => { if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) nativeSyncTasks.invalidate(); };
		const unsubscribe = rootIdentity.subscribe(changed);
		const leave = () => nativeSyncTasks.invalidate();
		window.addEventListener('pagehide', leave);
		let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
		let releaseWindow: (() => Promise<void>) | undefined, job: SyncJob | null = null;
		let jobs: ReturnType<Awaited<ReturnType<typeof openSyncJournal>>['jobs']> | undefined;
		try {
			check();
			journal = await openSyncJournal(); check();
			jobs = journal.jobs({ scope: binding, currentScope: () => { checkIdentity(); return binding; } });
			saveStop = async () => { const stopping = job ?? resume; if (stopping) await pauseSyncJobAdmission(jobs!, stopping.id); await cancelCapture?.().catch(() => {}); };
			if (adapter.platform === 'macos') releaseWindow = await holdDesktopSyncWindow(adapter.bridge); check();
			const host = await createNativeSyncHost({ ownerId: binding.ownerId, deviceId: binding.deviceId, adapter, signal, assertCurrent: check });
			if (host.origin() !== binding.origin) throw Error('The selected sync server changed.');
			await host.requireCapability('api.things', reviewed.configuration.ignoreRules ? '1.38.0' : '1.36.0');
			// Views may render once with their prior props during cancellation.
			// The origin is display/binding metadata; every IO method and the
			// explicit assertCurrent still use the live, abortable host checks.
			update({ host: { ...host, origin: () => binding.origin } });
			const request = host.request, capabilities = host.capabilities;
			if (reviewed.configuration.ignoreRules && !supportsNativeIgnoreRules(capabilities)) throw Error('Update Thingtime Mac before using this connection’s Gitignore rules.');
			const currentScope = () => { check(); host.assertCurrent(); return binding; };
			const runtime = { currentScope, origin: host.origin, fetch: host.fetch, requireCapability: host.requireCapability };
			const backup = supportsNativeBackupCapture(capabilities) && reviewed.configuration.mode === 'backup' && !reviewed.configuration.propagateDeletes;
			let capturedSource: NativeBackupCapture | undefined;
			const releaseLocalImport = async (inventory: InventoryIdentity) => {
				if (!job?.localImport || JSON.stringify(job.localImport.inventory) !== JSON.stringify(inventory)) return;
				const source = capturedSource?.id === job.nativeCaptureId ? capturedSource : undefined;
				const changed = await jobs!.finishImport(job, inventory); check();
				if (!changed) throw Error('The sync job changed before import handoff.'); job = changed;
				// Its durable consumer owns the journal now. Cleanup is best effort;
				// interrupted cleanup leaves only the native cache's bounded retention.
				if (source) await request(binding.ownerId, { action: 'scan-discard', rootId: reviewed.configuration.localRootId,
					inventoryDeviceId: binding.deviceId, capture: source, capturePolicy: 'backup-supported',
					...(reviewed.configuration.ignoreRules ? { ignoreRules: reviewed.configuration.ignoreRules } : {}) }, signal).catch(() => {});
				capturedSource = undefined; check();
			};
			const beginLocalImport = async (purpose: 'initial' | 'review') => {
				if (job!.localImport?.purpose === purpose) return structuredClone(job!.localImport.inventory);
				if (job!.localImport) await releaseLocalImport(job!.localImport.inventory);
				const legacy = purpose === 'initial' && job!.nativeCaptureId && job!.nativeCaptureGeneration
					? await journal!.inventory({ scope: binding, currentScope, signal }).latestNativeImport(job!.nativeCaptureId, job!.nativeCaptureGeneration) : null;
				check(); const inventory = legacy ?? { id: crypto.randomUUID(), generation: crypto.randomUUID(), source: 'local' as const };
				const changed = await jobs!.beginImport(job!, purpose, inventory); check();
				if (!changed) throw Error('The sync job changed before inventory import.'); job = changed;
				return structuredClone(job.localImport!.inventory);
			};
			cancelCapture = async () => {
				const streaming = await journal!.pagedRuns({ scope: binding, currentScope }).active();
				if (streaming?.spec.streaming?.source === 'local') await request(binding.ownerId, { action: 'scan-cancel', rootId: reviewed.configuration.localRootId, inventoryDeviceId: binding.deviceId,
					captureId: streaming.spec.streaming.captureId, capturePolicy: 'one-way-supported', excludedPaths: reviewed.configuration.excludedPaths, ignoreRules: reviewed.configuration.ignoreRules }, signal);
				if (!job?.nativeCaptureId) return;
				await request(binding.ownerId, { action: 'scan-cancel', rootId: reviewed.configuration.localRootId, inventoryDeviceId: binding.deviceId,
					captureId: job.nativeCaptureId, capturePolicy: 'backup-supported', excludedPaths: reviewed.configuration.excludedPaths, ...(reviewed.configuration.ignoreRules ? { ignoreRules: reviewed.configuration.ignoreRules } : {}) }, signal);
			};
			const nativePages = async function* (options?: Parameters<NonNullable<ForegroundSyncInput['scanLocalPages']>>[0]): AsyncGenerator<LocalInventoryPage> {
				if (backup && !job!.nativeCaptureId) {
					const changed = await jobs!.capture(job!, crypto.randomUUID()); check();
					if (!changed) throw Error('The sync job changed before indexing.'); job = changed;
				}
				for await (const page of readNativeInventory({ ownerId: binding.ownerId, deviceId: binding.deviceId, rootId: reviewed.configuration.localRootId,
					excludedPaths: reviewed.configuration.excludedPaths, ...(reviewed.configuration.ignoreRules ? { ignoreRules: reviewed.configuration.ignoreRules } : {}), signal, request, ...options, ...(supportsNativeInventoryBatches(capabilities) ? { pageSize: NATIVE_INVENTORY_BATCH_ENTRIES } : {}), ...(backup ? { backupPolicy: reviewed.configuration, captureId: job!.nativeCaptureId,
						onCaptureStatus: async value => {
							if (value.state === 'complete') capturedSource = value;
							if (job!.nativeCaptureGeneration === value.generation) return;
							const resetImport = !!job!.localImport && !!job!.nativeCaptureGeneration;
							const changed = await jobs!.observeCapture(job!, value.generation); check();
							if (!changed) throw Error('The sync job changed during indexing.'); job = changed;
							if (resetImport) throw new NativeInventoryRetryWait('The native scan changed. Its new generation will import separately.');
						},
						onProgress: value => publish({ stage: 'scanning', confirmed: 0, total: 0, indexed: value.totalEntries, skipped: value.totalSkipped,
							coverage: value.coverage, consistency: value.consistency }) } : {}) })) yield page;
				if (backup && !options?.retainCaptureUntilHandoff) {
					const changed = await jobs!.capture(job!, null); check();
					if (!changed) throw Error('The sync job changed after indexing.'); job = changed;
				}
			};
			const publish = (progress: Parameters<typeof update>[0]['progress']) => {
				check(); if (!progress) return; update({ progress });
				const key = 'tt:sync-progress:' + syncScopeKey(binding);
				writeStampedCache(key, progress); pruneCacheNamespace('tt:sync-progress:', key, 32);
				if (progress.stage === 'retained') window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			};
			await withSyncRootLock(binding, async () => {
				const roots = (await request(binding.ownerId, { action: 'list' }, signal)).roots;
				assertPhotoSourcePolicy(reviewed.configuration, roots); check();
				const inspect = supportsNativePathInspection(capabilities) && roots.some(root => root.id === reviewed.configuration.localRootId && root.sourceKind !== 'photos');
				const localTarget = ['download', 'two-way'].includes(reviewed.configuration.mode)
					? await approveMobileSyncTarget(reviewed, binding, signal, request, capabilities, resume ? 'existing' : 'request') : undefined;
				if (!resume) {
					const prior = await jobs!.read(); check();
					// A new approved revision cannot borrow the earlier native job.
					// Cancel its same-connection scan before dropping that ticket.
					if (prior?.nativeCaptureId && (prior.state === 'paused' || JSON.stringify(prior.reviewed.configuration) === JSON.stringify(reviewed.configuration)) && JSON.stringify(prior.reviewed) !== JSON.stringify(reviewed)) {
						await request(binding.ownerId, { action: 'scan-cancel', rootId: prior.reviewed.configuration.localRootId, inventoryDeviceId: binding.deviceId,
							captureId: prior.nativeCaptureId, capturePolicy: 'backup-supported', excludedPaths: prior.reviewed.configuration.excludedPaths, ...(prior.reviewed.configuration.ignoreRules ? { ignoreRules: prior.reviewed.configuration.ignoreRules } : {}) }, signal); check();
					}
				}
				job = resume ? await jobs!.begin(resume, Date.now(), crypto.randomUUID()) : await jobs!.admit(reviewed, crypto.randomUUID(), intervalMs);
				if (!job) return; // A stopped/completed/replaced discovery is never replayed.
				if (stopRequested) await jobs!.transition(job, 'paused');
				check();
				await runPagedForegroundCloudSync(reviewed, binding, {
					currentScope, localTarget, journal: journal!, runtime, progress: publish,
					...(inspect && supportsNativeStreamingIndex(capabilities) && !reviewed.configuration.propagateDeletes ? {
						streamLocalChanges: (captureId: string, afterSequence: number, streamSignal?: AbortSignal, readyToFinish?: () => Promise<boolean>) => readNativeIndexChanges({ ownerId: binding.ownerId, deviceId: binding.deviceId,
							rootId: reviewed.configuration.localRootId, captureId, afterSequence, readyToFinish, signal: streamSignal ?? signal, request, excludedPaths: reviewed.configuration.excludedPaths, ignoreRules: reviewed.configuration.ignoreRules }),
						streamRemoteChanges: (captureId: string, afterSequence: number, streamSignal?: AbortSignal, readyToFinish?: () => Promise<boolean>, resume?: { cursor?: string; snapshotComplete?: boolean; checkpoint(cursor: string, snapshotComplete: boolean): Promise<void> }) => {
							if (!readyToFinish || !resume) throw Error('The durable cloud index consumer is unavailable.');
							return readCloudIndexChanges(binding, reviewed.configuration.remoteFolderId, { ...runtime, signal: streamSignal ?? signal }, captureId, afterSequence, readyToFinish, resume);
						}
					} : {}),
					inventorySession: descriptor => {
						check(); update({ inventoryDescriptor: descriptor });
						const key = 'tt:sync-inventory:' + syncScopeKey(binding);
						writeStampedCache(key, descriptor); pruneCacheNamespace('tt:sync-inventory:', key, 32);
					},
					transfer: value => { check(); update({ transfer: value }); },
					progressSession: descriptor => {
						check(); update({ progressDescriptor: descriptor });
						const key = 'tt:sync-progress-tree:' + syncScopeKey(binding);
						writeStampedCache(key, descriptor); pruneCacheNamespace('tt:sync-progress-tree:', key, 32);
					},
					readConfiguration: async () => {
						const url = new URL('/api/v1/things', binding.origin); url.searchParams.set('id', reviewed.id);
						const response = await host.fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal,
							headers: { 'X-Thingtime-Expected-Actor': binding.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
						if (!response.ok) throw Error('The saved sync connection could not be verified.');
						const value = await response.json(); check(); return value.thing;
					},
					authorizeDevice: async () => {
						await host.authorizeDevice(binding.ownerId, binding.deviceId, signal);
						assertPhotoSourcePolicy(reviewed.configuration, (await request(binding.ownerId, { action: 'list' }, signal)).roots); check();
					},
					conditions: async () => (await request(binding.ownerId, { action: 'conditions' }, signal)).conditions!,
					scanLocal: async () => (await request(binding.ownerId, { action: 'scan', rootId: reviewed.configuration.localRootId, excludedPaths: reviewed.configuration.excludedPaths, ...(reviewed.configuration.ignoreRules ? { ignoreRules: reviewed.configuration.ignoreRules } : {}) }, signal)).entries!,
					...(inspect && supportsNativeInventoryPages(capabilities) ? {
						scanLocalPages: nativePages, ...(backup ? { beginLocalImport, releaseLocalImport } : {})
					} : {}),
					...(inspect ? { inspectLocal: async (path: string) => (await request(binding.ownerId,
						{ action: 'inspect', rootId: reviewed.configuration.localRootId, path }, signal)).inspectedEntry! } : {}),
					inventory: () => readCloudFolderInventory(binding, reviewed.configuration.remoteFolderId, { ...runtime, signal }),
					inventoryPages: (options?: { signal?: AbortSignal }) => readCloudFolderInventoryPages(binding, reviewed.configuration.remoteFolderId, { ...runtime, signal: options?.signal ?? signal }),
					source: async entry => mobileFolderSource(binding.ownerId, reviewed.configuration.localRootId, entry, signal, request, capabilities),
					reviewPagedConflicts: session => new Promise<PagedConflictReviewResult>((resolve, reject) => {
						let settled = false;
						const finish = (value?: PagedConflictReviewResult) => {
							if (settled) return; settled = true; signal.removeEventListener('abort', abort);
							if (!signal.aborted) update({ pagedReview: undefined });
							if (signal.aborted) reject(signal.reason);
							else if (value) resolve(value); else reject(Error('Conflict review interrupted. Saved choices can be resumed.'));
						};
						const controller = createConflictReviewController(session, finish);
						const abort = () => { controller.dispose(); finish(); };
						signal.addEventListener('abort', abort, { once: true });
						if (signal.aborted) { abort(); return; }
						update({ pagedReview: controller }); void controller.reload().catch(() => {});
					}),
					reviewConflicts: conflicts => new Promise<SyncConflictReviewResult>((resolve, reject) => {
						let settled = false;
						const finish = (value?: SyncConflictReviewResult) => {
							if (settled) return; settled = true; signal.removeEventListener('abort', abort);
							if (!signal.aborted) update({ legacyReview: undefined });
							if (signal.aborted) reject(signal.reason);
							else if (value) resolve(value); else reject(Error('Conflict review cancelled. Both folders were preserved.'));
						};
						const abort = () => finish(); signal.addEventListener('abort', abort, { once: true });
						if (signal.aborted) { abort(); return; }
						update({ legacyReview: { conflicts, apply: finish, retain: () => finish({ action: 'retain' }), cancel: () => finish() } });
					})
				}, signal);
				check(); const finished = await jobs!.finish(job, Date.now()); check();
				if (finished?.state === 'scheduled' && adapter.platform === 'macos') await setDesktopSyncScheduled(true, adapter.bridge);
			}, undefined, signal);
		} catch (error) {
			const failed = job ?? (resume?.intervalMs !== undefined ? resume : null);
			if (failed && jobs && !signal.aborted && isSyncConnectionFailure(error))
				throw new SyncConnectionWait('Waiting for the connection to return. Saved transfer progress will continue automatically.');
			if (failed && jobs && !signal.aborted && !(error instanceof SyncConditionsWait) && !(error instanceof NativeInventoryRetryWait)) await jobs.attention(failed);
			throw error;
		} finally {
			visibility?.dispose(); journal?.close(); unsubscribe(); window.removeEventListener('pagehide', leave);
			await releaseWindow?.();
		}
	}, async () => {
		stopRequested = true;
		try { await saveStop?.(); } catch { throw Error('Transfer stopped, but its pause could not be saved. It may resume when Thingtime reopens.'); }
	});
}

/** Stop works while the scheduler is idle as well as during a transfer. CAS
 * fences a concurrent discovery, and cancellation only targets this root. */
export async function pauseNativeSyncJob(scope: SyncScope, generation: number) {
	const check = () => {
		if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) throw Error('The active account changed.');
		return scope;
	};
	check(); const journal = await openSyncJournal();
	try {
		const jobs = journal.jobs({ scope, currentScope: check });
		for (let attempt = 0; attempt < 3; attempt++) {
			await nativeSyncTasks.cancel(scope); check();
			const job = await jobs.read();
			if (!job || ['paused', 'complete'].includes(job.state) || await jobs.pause(job)) {
				await nativeSyncTasks.cancel(scope); return;
			}
		}
		throw Error('The sync job changed while stopping. Please retry.');
	} finally { journal.close(); }
}
