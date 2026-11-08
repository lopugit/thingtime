import { nativePathObserver } from './nativePathObservation';
import { reportDeviceSyncHistoryStorage } from './deviceSyncHistory.client';
import { createDeviceSyncHistoryRecorder } from './deviceSyncHistoryRecorder';
import { deviceResourceKey, nativeDeviceSyncGovernor, readDeviceSyncResourcePolicy } from './deviceResourcePolicy';
import { activityManager } from '~/activity/activityManager';
import { fileSyncDownloadRequirements } from './signedDownloadTarget';
import { createSyncProgressCache } from './syncProgressCache';
import { type SyncResourceStatus } from './resourceGovernor';
import { readCloudIndexChanges } from './cloudIndexChanges.client';
import { readNativeIndexChanges } from './streamingIndex';
import { FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS, PHOTO_AUTOMATION_INTERVAL_MS } from './configuration';
import { samePhotoBackupSource } from './photoSettingsPolicy';
import { SyncConditionsWait } from './foregroundSyncContext';
import { cloudSyncHttpError, SYNC_RETRY_MAX_MS, SyncConnectionWait, isSyncConnectionFailure } from './syncConnectionWait';
import { pauseSyncJobAdmission, retireStrictCapture, syncJobDue, type SyncJob } from './syncJobJournal';
import { holdDesktopSyncWindow, setDesktopSyncScheduled } from './desktopSyncWindow.client';
import { createNativeSyncHost, getNativeSyncAdapter, isNativeSyncAdapterCurrent } from './nativeSyncHost.client';
import { watchNativeSyncVisibility } from './nativeSyncVisibility';
import { rootIdentity } from '../utils/rootIdentity';
import { createSyncTaskRuntime, cancelSyncForActivity } from './syncTaskRuntime';
import { createSyncStopCleanup } from './syncStopCleanup';
import { openSyncJournal, withSyncRootLock, syncScopeKey } from './journal.client';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { readNativeInventory, parseNativePhotoQueueBatch, NATIVE_INVENTORY_BATCH_ENTRIES, NativeInventoryRetryWait, type LocalInventoryPage, type NativeBackupCapture, type NativePhotoQueueApproval, type NativePhotoQueueBatch } from './nativeInventory';
import type { ForegroundSyncInput, ForegroundSyncProgress } from './foregroundSync';
import type { InventoryIdentity } from './inventoryJournal';
import { readCloudFolderInventoryPages } from './cloudInventoryPages.client';
import { readCloudFolderInventory } from './cloudInventory.client';
import { CLOUD_SYNC_DESTINATION_REQUIREMENTS } from './cloudSyncDestination';
import { CLOUD_FOLDER_REQUIREMENTS, parseCloudFolder } from './cloudFolder';
import { cloudRequests } from './cloudTransport';
import { preparePhotoSettingsRecovery } from './photoSettingsRecovery';
import { mobileFolderSource, requestMobileFolders, assertNativeFolderInventoryCoverage, supportsNativeInventoryPages, supportsNativePhotoInventoryPages, supportsNativePhotoCloudGaps, supportsNativePhotoCloudFetch, supportsNativePhotoQueue, supportsNativeDeferredUploads, supportsNativePathInspection, supportsNativeBackupCapture, supportsNativeStrictCapture, supportsNativeIgnoreRules, supportsNativeInventoryBatches, supportsNativeStreamingIndex, supportsNativeStreamingBatches, supportsNativeAuthorizationContext, supportsNativeCloudStaging, supportsNativeResourceLimits, supportsNativePhotoAutomation } from './mobileFolders.client';
import { approveMobileSyncTarget } from './mobileSyncTarget.client';
import { runNativePhotoQueue, runPhotoBackupPasses } from './photoBackupPasses';
import { assertPhotoSourcePolicy } from './photoSourcePolicy';
import { createConflictReviewController } from './conflictReviewController';
import type { PagedConflictReviewResult } from './pagedForegroundReview';
import type { SyncConflictReviewResult } from './conflictResolution';
import { assertConfiguredSyncApproval, readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from './configuredPlan';
import type { SyncScope } from './reconcile';
import { clearLocalCache, writeStampedCache, pruneCacheNamespace } from '../hooks/localCache';
import { TIMELINE_CHANGED_EVENT } from '../timeline/clientEvents';

export const nativeSyncTasks = createSyncTaskRuntime();
export const supportsNativeSyncTasks = () => !!getNativeSyncAdapter();

async function cancelSavedStrictCapture(job: SyncJob, adapter: NonNullable<ReturnType<typeof getNativeSyncAdapter>>, checkIdentity: () => void) {
	if (!job.strictCaptureId) return;
	const signal = AbortSignal.timeout(10_000), { scope, reviewed } = job;
	const assertCurrent = () => {
		signal.throwIfAborted(); checkIdentity();
		if (!isNativeSyncAdapterCurrent(adapter)) throw Error('The active sync host changed.');
	};
	const host = await createNativeSyncHost({ ownerId: scope.ownerId, deviceId: scope.deviceId, adapter, signal, assertCurrent });
	if (host.origin() !== scope.origin) throw Error('The selected sync server changed.');
	await host.request(scope.ownerId, { action: 'scan-cancel', rootId: reviewed.configuration.localRootId,
		inventoryDeviceId: scope.deviceId, captureId: job.strictCaptureId, capturePolicy: 'strict-async', excludedPaths: reviewed.configuration.excludedPaths,
		...(reviewed.configuration.ignoreRules ? { ignoreRules: reviewed.configuration.ignoreRules } : {}) }, signal);
}

/** Explicit runs persist admission separately from editable connection Things.
 * Relaunch resumes only that admitted job, using existing native consent. */
export async function startNativeSyncTask(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number, resume?: SyncJob, intervalMs?: number, automaticPhoto?: { wakeConditions: boolean }) {
	if (!activityManager.enabled('sync.execution')) throw Error('File sync is disabled in Activity manager. Enable it before starting a transfer.');
	const adapter = getNativeSyncAdapter();
	if (!adapter) throw Error('Update Thingtime to continue sync outside this screen.');
	const reviewed = structuredClone(saved), binding = structuredClone(scope);
	const photoHost = adapter.platform === 'ios' && supportsNativePhotoAutomation(adapter.bridge);
	const photoAutomation = photoHost && samePhotoBackupSource(reviewed.configuration, reviewed.configuration);
	if (automaticPhoto && !photoAutomation) throw Error('Automatic Photos backup requires this device’s current Photos connection.');
	if (reviewed.configuration.photoAutomation && !photoHost) throw Error('Update Thingtime before using this connection’s Photos upload settings.');
	if (binding.dataPlane !== 'home' || binding.rootId !== reviewed.id || binding.deviceId !== reviewed.configuration.deviceId)
		throw Error('The file sync connection changed.');
	const progressKey = 'tt:sync-progress:' + syncScopeKey(binding);
	const persistProgress = (value: ForegroundSyncProgress) => writeStampedCache(progressKey, value);
	const stopCleanup = createSyncStopCleanup(async () => { if (resume) throw Error('Transfer stopped, but saved native cleanup could not be opened. Reopen this connection before resuming.'); });
	let stopRequested = false, saveStop: (() => Promise<void>) | undefined, cancelCapture: (() => Promise<void>) | undefined;
	await nativeSyncTasks.start(binding, async (signal, update) => {
		const disposeActivity = activityManager.register({id:'sync.execution',title:'File transfer and filesystem indexing',kind:'watcher',background:true,detail:'Owns the current index, upload/download runner, index change reads and their native tasks. Disable to cancel this runner; saved transfer work is retained.'}, activitySignal => {
			const disabled=()=>{if(activitySignal.reason==='disabled') void cancelSyncForActivity(nativeSyncTasks).catch(() => {});};
			activitySignal.addEventListener('abort',disabled,{once:true});return()=>activitySignal.removeEventListener('abort',disabled);
		});
		const checkIdentity = () => {
			if (rootIdentity.read().pending || rootIdentity.read().generation !== generation || !isNativeSyncAdapterCurrent(adapter))
				throw Error('The active account changed. Reopen folder access.');
		};
		let deferredCount = 0, deferredScheduled: boolean | undefined;
		const visibility = adapter.platform === 'ios' ? watchNativeSyncVisibility(signal, message =>
			nativeSyncTasks.suspend(deferredCount > 0 ?
				deferredScheduled ?
					'Prepared files can upload in the background when iOS allows. Reopen Thingtime to verify and continue the backup.' :
					'iOS did not schedule background processing. Open Thingtime to resume.' : message, true)) : undefined;
		const check = () => { signal.throwIfAborted(); checkIdentity(); visibility?.check(); };
		const changed = () => { if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) nativeSyncTasks.invalidate(); };
		const unsubscribe = rootIdentity.subscribe(changed);
		const leave = () => nativeSyncTasks.invalidate();
		window.addEventListener('pagehide', leave);
		let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
		let releaseWindow: (() => Promise<void>) | undefined, job: SyncJob | null = null;
		let admissionPending: Promise<SyncJob | null> | undefined;
		let strictCancellation: Promise<void> | undefined;
		const cancelStrictCapture = () => {
			if (!job?.strictCaptureId) return Promise.resolve();
			return strictCancellation ??= cancelSavedStrictCapture(job, adapter, checkIdentity);
		};
		let disposeProgressCache: (() => void) | undefined;
		let history: ReturnType<typeof createDeviceSyncHistoryRecorder> | undefined;
		let historyStatus: 'paused' | 'complete' | 'error' = 'paused';
		let jobs: ReturnType<Awaited<ReturnType<typeof openSyncJournal>>['jobs']> | undefined;
		try {
			check();
			journal = await openSyncJournal(); checkIdentity();
			jobs = journal.jobs({ scope: binding, currentScope: () => { checkIdentity(); return binding; } });
			saveStop = async () => {
				let admitted: SyncJob | null | undefined, failure: Error | undefined;
				try { admitted = await admissionPending; }
				catch { failure = Error('Transfer stopped, but its pending admission could not be verified. Automatic restart is blocked until Resume; review saved work before reopening.'); }
				const stopping = job ?? admitted ?? resume;
				try { if (stopping) await pauseSyncJobAdmission(jobs!, stopping.id); }
				catch { failure = Error('Transfer stopped, but its pause could not be saved. Automatic restart is blocked until Resume; it may resume when Thingtime reopens.'); }
				try { await cancelCapture?.(); }
				catch { failure ??= Error('Pause saved. Native indexing cleanup could not be confirmed; reopen this connection before resuming.'); }
				if (failure) throw failure;
			};
			cancelCapture = async () => {
				await cancelStrictCapture();
				// Cleanup must outlive the aborted execution host, while retaining
				// the same account generation, adapter, origin, device and root.
				const cleanupSignal = AbortSignal.timeout(10_000);
				const cleanupCheck = () => { cleanupSignal.throwIfAborted(); checkIdentity(); };
				const streaming = await journal!.pagedRuns({ scope: binding, currentScope: () => { cleanupCheck(); return binding; } }).active();
				const captures = [
					...(streaming?.spec.streaming && streaming.spec.streaming.source !== 'remote' ? [{ id: streaming.spec.streaming.captureId, policy: 'one-way-supported' as const }] : []),
					...((job ?? resume)?.nativeCaptureId ? [{ id: (job ?? resume)!.nativeCaptureId!, policy: 'backup-supported' as const }] : [])
				];
				const cancelDeferred = reviewed.configuration.sourceKind === 'photos' && adapter.platform === 'ios' && supportsNativeDeferredUploads(adapter.bridge);
				if (cancelDeferred) {
					cleanupCheck();
					if (window.location.origin !== binding.origin || !isNativeSyncAdapterCurrent(adapter)) throw Error('The selected sync server changed.');
					await requestMobileFolders(binding.ownerId, { action: 'cancel-deferred-upload',
						rootId: reviewed.configuration.localRootId, configurationId: reviewed.id, deviceId: binding.deviceId }, cleanupSignal);
				}
				if (!captures.length) return;
				const cleanupHost = await createNativeSyncHost({ ownerId: binding.ownerId, deviceId: binding.deviceId, adapter, signal: cleanupSignal, assertCurrent: cleanupCheck });
				if (cleanupHost.origin() !== binding.origin) throw Error('The selected sync server changed.');
				for (const capture of captures) {
					cleanupCheck();
					await cleanupHost.request(binding.ownerId, { action: 'scan-cancel', rootId: reviewed.configuration.localRootId, inventoryDeviceId: binding.deviceId,
						captureId: capture.id, capturePolicy: capture.policy, excludedPaths: reviewed.configuration.excludedPaths,
						...(reviewed.configuration.ignoreRules ? { ignoreRules: reviewed.configuration.ignoreRules } : {}) }, cleanupSignal);
				}
			};
			stopCleanup.install(saveStop); check();
			if (adapter.platform === 'macos') releaseWindow = await holdDesktopSyncWindow(adapter.bridge); check();
			if (photoAutomation && (reviewed.configuration.ignoreRules || reviewed.configuration.resourceLimits))
				throw Error('This Photos connection has folder-only resource or Gitignore settings. Review its settings before continuing.');
			const resourceKey = deviceResourceKey(binding.origin, binding.ownerId, binding.deviceId);
			const resources = nativeDeviceSyncGovernor(resourceKey, adapter.platform === 'macos' || supportsNativeResourceLimits(adapter.bridge), reviewed.configuration.resourceLimits);
			let nativeResources: SyncResourceStatus | undefined;
			const host = await createNativeSyncHost({ ...(resources ? { resourcePolicy: { resourceLimits: reviewed.configuration.resourceLimits, resourceScope: reviewed.id, deviceResourceLimits: () => readDeviceSyncResourcePolicy(resourceKey), observe: (value: SyncResourceStatus) => { nativeResources = value; resources.observe(value); history?.observe(value); } } } : {}), ownerId: binding.ownerId, deviceId: binding.deviceId, adapter, signal, assertCurrent: check });
			if (host.origin() !== binding.origin) throw Error('The selected sync server changed.');
			await host.requireCapability('api.things', reviewed.configuration.resourceLimits ? '1.39.0' : reviewed.configuration.ignoreRules ? '1.38.0' : '1.36.0');
			if (reviewed.configuration.resourceLimits) await host.requireCapability('api.file-sync-batches', '1.2.0');
			if (photoAutomation) for (const [feature, minimum] of Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS)) await host.requireCapability(feature, minimum);
			const downloadRequirements = fileSyncDownloadRequirements(reviewed.configuration);
			for (const [feature, minimum] of Object.entries(downloadRequirements)) await host.requireCapability(feature, minimum);
			if (Object.keys(downloadRequirements).length && !supportsNativeCloudStaging(host.capabilities)) throw Error('Update Thingtime before using a CPU target for downloads. This connection requires scoped native signed-range downloads.');
			// Views may render once with their prior props during cancellation.
			// The origin is display/binding metadata; every IO method and the
			// explicit assertCurrent still use the live, abortable host checks.
			update({ host: { ...host, origin: () => binding.origin } });
			const request = host.request, capabilities = host.capabilities;
			if (reviewed.configuration.ignoreRules && !supportsNativeIgnoreRules(capabilities)) throw Error('Update Thingtime Mac before using this connection’s Gitignore rules.');
			const currentScope = () => { check(); host.assertCurrent(); return binding; };
			const runtime = { ...(resources ? { resources } : {}), currentScope, origin: host.origin, fetch: host.fetch, requireCapability: host.requireCapability };
			const readConfiguration = async () => {
				const url = new URL('/api/v1/things', binding.origin); url.searchParams.set('id', reviewed.id);
				const response = await host.fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal,
					headers: { 'X-Thingtime-Expected-Actor': binding.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
				if (!response.ok) throw cloudSyncHttpError(response.status, response.headers.get('retry-after'));
				const value = await response.json(); check(); return value.thing;
			};
			let photoSource = false, backup = false, strictAsync = false, downloadCloudForPlan = false;
			let photoAccess: ForegroundSyncProgress['photoAccess'];
			const updatePhotoAccess = (roots: Awaited<ReturnType<typeof request>>['roots']) => {
				const selected = roots.find(root => root.id === reviewed.configuration.localRootId);
				photoSource = selected?.sourceKind === 'photos';
				photoAccess = photoSource && (selected?.photoAccess === 'limited' || selected?.photoAccess === 'full') ? selected.photoAccess : undefined;
			};
			const photoDownloadApproval = () => photoSource && reviewed.configuration.sourceKind === 'photos' && reviewed.configuration.network === 'any' && supportsNativePhotoCloudFetch(capabilities)
				? { ...reviewed, scope: binding } : undefined;
			const photoQueueApproval = (): NativePhotoQueueApproval | undefined => photoSource && strictAsync && job?.photoQueueEpoch &&
				supportsNativePhotoQueue(capabilities) ? { request: { epoch: job.photoQueueEpoch, configurationId: reviewed.id, configurationRevision: reviewed.updatedAt },
					authorization: { ...reviewed, scope: binding } } : undefined;
			let lastPhotoQueue: ForegroundSyncProgress['photoQueue'];
			let observedPhotoBatch: NativePhotoQueueBatch | undefined;
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
			const nativePages = async function* (options?: Parameters<NonNullable<ForegroundSyncInput['scanLocalPages']>>[0]): AsyncGenerator<LocalInventoryPage> {
				if (backup && !job!.nativeCaptureId) {
					const changed = await jobs!.capture(job!, crypto.randomUUID()); check();
					if (!changed) throw Error('The sync job changed before indexing.'); job = changed;
				}
				const captureId = strictAsync ? crypto.randomUUID() : undefined;
				if (captureId) {
					const recorded = await jobs!.strictCapture(job!, captureId);
					if (!recorded) throw Error('The sync job changed before strict indexing.');
					job = recorded; strictCancellation = undefined; check();
				}
				let finished = false;
				try {
					for await (const page of readNativeInventory({ ownerId: binding.ownerId, deviceId: binding.deviceId, rootId: reviewed.configuration.localRootId,
						...(photoSource && supportsNativePhotoCloudGaps(capabilities) ? {
							photoGapPolicy: reviewed.configuration,
							photoQueueApproval: photoQueueApproval(),
							onPhotoBatch: batch => { observedPhotoBatch = batch; lastPhotoQueue = { pending: batch.pending, unavailable: batch.unavailable }; },
							photoDownloadAuthorization: downloadCloudForPlan && options?.observationPurpose !== 'checkpoint' ? photoDownloadApproval() : undefined
						} : {}),
						excludedPaths: reviewed.configuration.excludedPaths, ...(reviewed.configuration.ignoreRules ? { ignoreRules: reviewed.configuration.ignoreRules } : {}), signal, request, ...options, ...(captureId ? { strictAsync, captureId,
							onStrictProgress: (indexed: number, skipped?: number, fraction?: number) => publish({ stage: 'scanning', confirmed: 0, total: 0, indexed,
								...(skipped ? { skipped, coverage: 'partial' as const } : {}), ...(fraction !== undefined ? { photoDownload: { fraction } } : {}) }) } : {}),
							...(!photoSource && supportsNativeInventoryBatches(capabilities) ? { pageSize: NATIVE_INVENTORY_BATCH_ENTRIES } : {}), ...(backup ? { backupPolicy: reviewed.configuration, captureId: job!.nativeCaptureId,
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
					finished = true;
				} finally {
					if (captureId && !finished) await cancelStrictCapture().catch(() => {});
				}
				if (captureId) {
					const cleared = await retireStrictCapture(jobs!, job!, cancelStrictCapture); check();
					if (!cleared) throw Error('The sync job changed after strict indexing.');
					job = cleared;
				}
				if (backup && !options?.retainCaptureUntilHandoff) {
					const changed = await jobs!.capture(job!, null); check();
					if (!changed) throw Error('The sync job changed after indexing.'); job = changed;
				}
			};
			const progressCache = createSyncProgressCache<NonNullable<Parameters<typeof update>[0]['progress']>>({ signal, check,
				persist: persistProgress, prune: () => pruneCacheNamespace('tt:sync-progress:', progressKey, 32) });
			disposeProgressCache = progressCache.dispose;
			const publish = (progress: Parameters<typeof update>[0]['progress']) => {
				check(); if (!progress) return;
				progress = { ...progress, statisticsObservedAt: Date.now(), ...(photoAccess ? { photoAccess } : {}),
					...(lastPhotoQueue && !progress.photoQueue ? { photoQueue: lastPhotoQueue } : {}),
					...(deferredCount > 0 && deferredScheduled !== undefined ? { backgroundTransfer: deferredScheduled ? 'queued' as const : 'foreground-only' as const } : {}),
					...(photoAccess === 'limited' && progress.stage === 'complete' && progress.coverage !== 'partial' &&
						!progress.photoQueue?.pending && !progress.photoQueue?.unavailable ?
						{ message: 'Selected photos backed up. Thingtime has limited Photos access.' } : {}) };
				if (resources) progress = { ...progress, resources: nativeResources ?? resources.status() };
				update({ progress });
				history?.stage(progress.stage);
				progressCache.write(progress);
				if (progress.stage === 'retained') window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			};
			await withSyncRootLock(binding, async () => {
				let prior = await jobs!.read(); check();
				if ((resume || automaticPhoto) && (prior?.id !== resume?.id || prior?.revision !== resume?.revision)) return;
				if (automaticPhoto && (nativeSyncTasks.isPaused(binding) || prior?.state === 'paused' ||
					(prior && !samePhotoBackupSource(prior.reviewed.configuration, reviewed.configuration)))) return;
				const roots = (await request(binding.ownerId, { action: 'list' }, signal)).roots;
				assertPhotoSourcePolicy(reviewed.configuration, roots); check();
				updatePhotoAccess(roots);
				if (!photoSource) assertNativeFolderInventoryCoverage(capabilities, reviewed.configuration);
				backup = !photoSource && supportsNativeBackupCapture(capabilities) && reviewed.configuration.mode === 'backup' && !reviewed.configuration.propagateDeletes;
				const photoPages = photoSource && supportsNativePhotoInventoryPages(capabilities);
				strictAsync = photoPages || (!photoSource && capabilities.platform === 'macos' && !backup && supportsNativeStrictCapture(capabilities));
				const inspect = photoSource ? photoPages : supportsNativePathInspection(capabilities);
				const localTarget = ['download', 'two-way'].includes(reviewed.configuration.mode)
					? await approveMobileSyncTarget(reviewed, binding, signal, request, capabilities, resume ? 'existing' : 'request') : undefined;
				let resumeJob = resume;
				if (automaticPhoto && (prior?.state === 'attention' || prior?.state === 'complete' ||
					JSON.stringify(prior?.reviewed) !== JSON.stringify(reviewed))) resumeJob = undefined;
				if (automaticPhoto && resumeJob && !syncJobDue(resumeJob, Date.now(), automaticPhoto.wakeConditions)) return;
				const verifyCurrentPhoto = async () => {
					const { localRootId, remoteFolderId } = reviewed.configuration;
					await host.authorizeDevice(binding.ownerId, binding.deviceId, signal); check();
					const latest = (await request(binding.ownerId, { action: 'list' }, signal)).roots;
					assertPhotoSourcePolicy(reviewed.configuration, latest); check();
					const { json, negotiate } = cloudRequests(runtime, binding, signal);
					await negotiate(CLOUD_FOLDER_REQUIREMENTS);
					const value = await json('/api/v1/files?' + new URLSearchParams({ folderId: remoteFolderId }));
					if (parseCloudFolder(value.folder).id !== remoteFolderId) throw Error('The cloud folder changed.');
					const saved = readOwnedFileSyncConfiguration(await readConfiguration(), binding.ownerId);
					assertConfiguredSyncApproval(saved, { ...reviewed, scope: binding }, binding, localRootId, remoteFolderId);
					if (saved.configuration.paused) throw new SyncConditionsWait('paused');
				};
				if (automaticPhoto) await verifyCurrentPhoto();
				if (prior?.strictCaptureId) {
					prior = await retireStrictCapture(jobs!, prior, saved => cancelSavedStrictCapture(saved, adapter, checkIdentity)); check();
					if (!prior) return;
					if (resumeJob) resumeJob = prior;
				}
				const cancelPriorBackupCapture = async () => {
					if (!prior?.nativeCaptureId) return;
					const { configuration } = prior.reviewed;
					await request(binding.ownerId, { action: 'scan-cancel', rootId: configuration.localRootId, inventoryDeviceId: binding.deviceId,
						captureId: prior.nativeCaptureId, capturePolicy: 'backup-supported', excludedPaths: configuration.excludedPaths,
						...(configuration.ignoreRules ? { ignoreRules: configuration.ignoreRules } : {}) }, signal); check();
				};
				const photoSettings = !resumeJob && photoSource && adapter.platform === 'ios' ? await preparePhotoSettingsRecovery(
					journal!, { scope: binding, currentScope, signal }, prior, reviewed, {
						check,
						verify: verifyCurrentPhoto,
						disarm: async () => {
							await cancelPriorBackupCapture();
							if (supportsNativeDeferredUploads(capabilities)) {
								const { localRootId } = reviewed.configuration;
								const retired = await request(binding.ownerId, { action: 'cancel-deferred-upload',
									rootId: localRootId, configurationId: reviewed.id, deviceId: binding.deviceId }, signal);
								if (retired.cancelled !== true)
									throw Error('The earlier Photos transfer could not be disarmed. Retry before starting with the saved settings.');
							}
						}
					}
				) : undefined;
				// A new approved revision cannot borrow the earlier native job.
				// Cancel its same-connection scan before dropping that ticket.
				if (!resumeJob && !photoSettings && prior?.nativeCaptureId &&
					(prior.state === 'paused' || JSON.stringify(prior.reviewed.configuration) === JSON.stringify(reviewed.configuration)) &&
					JSON.stringify(prior.reviewed) !== JSON.stringify(reviewed)) await cancelPriorBackupCapture();
				check();
				admissionPending = resumeJob ? jobs!.begin(resumeJob, Date.now(), crypto.randomUUID(), automaticPhoto) :
					jobs!.admit(reviewed, crypto.randomUUID(), photoAutomation ? PHOTO_AUTOMATION_INTERVAL_MS : intervalMs, photoSettings, automaticPhoto ? { previous: prior } : undefined);
				job = await admissionPending;
				if (!job) return; // A stopped/completed/replaced discovery is never replayed.
				if (photoSettings) {
					for (const prefix of ['tt:sync-progress:', 'tt:sync-inventory:', 'tt:sync-progress-tree:'])
						clearLocalCache(prefix + syncScopeKey(binding));
				}
				if (stopRequested) await jobs!.transition(job, 'paused');
				check();
				if (photoSource && strictAsync && supportsNativePhotoQueue(capabilities) && !job.photoQueueEpoch) {
					const savedQueue = await jobs!.photoQueue(job, crypto.randomUUID()); check();
					if (!savedQueue) throw Error('The sync job changed before Photos preparation.');
					job = savedQueue;
				}

				// Use the same admitted device/origin, and fence by account
				// generation without the run's abort so Stop can record its end.
				const historyJournal = journal!.deviceHistory({ scope: binding, assertCurrent: checkIdentity });
				history = createDeviceSyncHistoryRecorder({
					write: sample => historyJournal.append(sample),
					...(adapter.platform === 'macos' ? { readResources: async (readSignal: AbortSignal) => {
						check(); readSignal.throwIfAborted();
						const result = await request(binding.ownerId, { action: 'resources' }, readSignal);
						check(); readSignal.throwIfAborted();
						if (result.roots.length || !result.deviceResourceLimits) throw Error('The device did not confirm sync resources.');
						return result.resources;
					} } : {}),
					onStorageStatus: available => { checkIdentity(); reportDeviceSyncHistoryStorage(binding, available); }
				});
				let deferredUploads: ForegroundSyncInput['deferredUploads'];
				if (photoSource && supportsNativeDeferredUploads(capabilities)) {
					try {
						await host.requireCapability('api.file-sync-transfer-admissions', '1.0.0'); check();
						deferredUploads = { queued: (count, scheduled) => { deferredCount = count; if (scheduled !== undefined) deferredScheduled = scheduled; } };
						if (photoAutomation) {
							await host.requireCapability('api.file-sync-transfer-admissions', '1.1.0');
							await host.requireCapability('api.files', CLOUD_SYNC_DESTINATION_REQUIREMENTS['api.files']); check();
							deferredUploads.publishPhotos = true;
						}
					} catch { check(); } // Older origins retain ordinary foreground uploads.
				}
				const executePass = async (downloadCloud: boolean) => {
					downloadCloudForPlan = downloadCloud;
					observedPhotoBatch = undefined;
					const result = await runPagedForegroundCloudSync(reviewed, binding, {
						currentScope, localTarget, journal: journal!, runtime, progress: publish, ...(deferredUploads ? { deferredUploads } : {}),
						...(host.uploadBatch ? { uploadBatch: host.uploadBatch } : {}),
						...(host.folderBatch ? { folderBatch: host.folderBatch } : {}),
						...(supportsNativeAuthorizationContext(capabilities) ? { nativeOperationGuards: true as const } : {}),
						...(!photoSource && inspect && supportsNativeStreamingIndex(capabilities) && !reviewed.configuration.propagateDeletes ? {
							streamLocalChanges: (captureId: string, afterSequence: number, streamSignal?: AbortSignal, readyToFinish?: () => Promise<boolean>, waitForFinish?: (signal: AbortSignal) => Promise<void>) => readNativeIndexChanges({ ownerId: binding.ownerId, deviceId: binding.deviceId,
								rootId: reviewed.configuration.localRootId, captureId, afterSequence, readyToFinish, waitForFinish, signal: streamSignal ?? signal, request, excludedPaths: reviewed.configuration.excludedPaths, ignoreRules: reviewed.configuration.ignoreRules,
								...(supportsNativeStreamingBatches(capabilities) ? { pageSize: NATIVE_INVENTORY_BATCH_ENTRIES } : {}) }),
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
						transfer: value => { check(); update({ transfer: value }); history?.transfer(value); },
						progressSession: descriptor => {
							check(); update({ progressDescriptor: descriptor });
							const key = 'tt:sync-progress-tree:' + syncScopeKey(binding);
							writeStampedCache(key, descriptor); pruneCacheNamespace('tt:sync-progress-tree:', key, 32);
						},
						readConfiguration,
						...(host.authorizeContext ? { authorizeContext: async () => {
							const authorization = await host.authorizeContext!(binding.ownerId, binding.deviceId!, signal);
							assertPhotoSourcePolicy(reviewed.configuration, authorization.roots); updatePhotoAccess(authorization.roots); check();
							return authorization.conditions;
						} } : {}),
						authorizeDevice: async () => {
							await host.authorizeDevice(binding.ownerId, binding.deviceId, signal);
							const latest = (await request(binding.ownerId, { action: 'list' }, signal)).roots;
							assertPhotoSourcePolicy(reviewed.configuration, latest); updatePhotoAccess(latest); check();
						},
						conditions: async () => (await request(binding.ownerId, { action: 'conditions' }, signal)).conditions!,
						scanLocal: async () => (await request(binding.ownerId, { action: 'scan', rootId: reviewed.configuration.localRootId, excludedPaths: reviewed.configuration.excludedPaths, ...(reviewed.configuration.ignoreRules ? { ignoreRules: reviewed.configuration.ignoreRules } : {}) }, signal)).entries!,
						...(inspect && supportsNativeInventoryPages(capabilities) ? {
							scanLocalPages: nativePages, ...(backup ? { beginLocalImport, releaseLocalImport } : {})
						} : {}),
						observeLocal: nativePathObserver(host, binding.ownerId, signal),
						...(inspect ? { inspectLocal: async (path: string) => (await request(binding.ownerId,
							{ action: 'inspect', rootId: reviewed.configuration.localRootId, path }, signal)).inspectedEntry! } : {}),
						inventory: () => readCloudFolderInventory(binding, reviewed.configuration.remoteFolderId, { ...runtime, signal }),
						inventoryPages: (options?: { signal?: AbortSignal }) => readCloudFolderInventoryPages(binding, reviewed.configuration.remoteFolderId, { ...runtime, signal: options?.signal ?? signal }),
						source: async entry => mobileFolderSource(binding.ownerId, reviewed.configuration.localRootId, entry, signal, request, capabilities, !resume, photoDownloadApproval()),
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
					const photoQueue = result && 'photoQueue' in result && result.photoQueue !== undefined ? parseNativePhotoQueueBatch(result.photoQueue) : undefined;
					const observed = observedPhotoBatch as NativePhotoQueueBatch | undefined;
					const reported = nativeSyncTasks.read()?.progress;
					const verified = result && 'progress' in result && result.progress.phase === 'complete';
					// Nonempty batches still say verifying in the card until a
					// fresh empty selection; the durable checkpoint can advance.
					const progress = photoQueue && verified && reported ? { ...reported, stage: 'complete' as const } : reported;
					return { progress, photoQueue, replacedPhotoBatch: !!(photoQueue && ((observed && observed.id !== photoQueue.id) ||
						(result && 'progress' in result && result.progress.photoSourceChanged))) };
				};
				const queueApproval = photoQueueApproval();
				const queuedResult = queueApproval ? await runNativePhotoQueue(
					() => executePass(true),
					async batch => {
						await request(binding.ownerId, { action: 'photo-queue-finish', rootId: reviewed.configuration.localRootId,
							photoBatchId: batch.id, photoQueueApproval: queueApproval }, signal);
					}, check, queueApproval.request.epoch
				) : undefined;
				const finishedProgress = queuedResult?.progress ?? (queueApproval ? undefined :
					await runPhotoBackupPasses(async downloadCloud => (await executePass(downloadCloud)).progress,
						check, () => photoDownloadApproval() !== undefined));
				const count = queuedResult?.photoQueue?.unavailable ?? (finishedProgress?.coverage === 'partial' ? finishedProgress.skipped : undefined);
				if (photoSource && finishedProgress?.stage === 'complete' && count) {
					if (queueApproval) {
						const savedQueue = await jobs!.photoQueue(job, null); check();
						if (!savedQueue) throw Error('The sync job changed before the unavailable originals could be scheduled for retry.');
						job = savedQueue;
					}
					const action = reviewed.configuration.network === 'wifi' ?
						'Download the remaining originals in Photos, or explicitly allow cellular in this connection to let Thingtime fetch them.' :
						'Thingtime will retry. You can also download the remaining originals in Photos.';
					throw new SyncConnectionWait(
						`${count} ${count === 1 ? 'original is' : 'originals are'} only in iCloud. ${action}`,
						SYNC_RETRY_MAX_MS);
				}
				const finished = await jobs!.finish(job, Date.now()); check();
				if (finished) historyStatus = 'complete';
				if (finished?.state === 'scheduled' && adapter.platform === 'macos') await setDesktopSyncScheduled(true, adapter.bridge);
			}, undefined, signal);
		} catch (error) {
			// If the remote feed or a guarded transfer fails, stop only this
			// connection's native scanner. The durable stream ID/cursors stay
			// intact for retry, and a failed account check cannot cancel another run.
			if (reviewed.configuration.mode === 'two-way' && !signal.aborted) await cancelCapture?.().catch(() => {});
			const failed = job ?? (automaticPhoto || resume?.intervalMs !== undefined ? resume : null);
			if (failed && jobs && !signal.aborted && error instanceof SyncConditionsWait)
				await jobs.defer(failed, Date.now(), undefined, error, photoAutomation);
			if (failed && jobs && !signal.aborted && (isSyncConnectionFailure(error) || (photoAutomation && error instanceof NativeInventoryRetryWait))) {
				const delay = error instanceof SyncConnectionWait ? error.retryAfterMs : undefined;
				await jobs.defer(failed, Date.now(), delay, undefined, photoAutomation);
				if (error instanceof NativeInventoryRetryWait) throw error;
				throw new SyncConnectionWait(error instanceof SyncConnectionWait ? error.message :
					'Waiting for the connection to return. Saved transfer progress will continue automatically.', delay);
			}
			if (failed && jobs && !signal.aborted && !(error instanceof SyncConditionsWait) && !(error instanceof NativeInventoryRetryWait)) {
				historyStatus = 'error';
				await jobs.attention(failed, error, automaticPhoto ? reviewed.updatedAt : undefined);
			}
			throw error;
		} finally {
			disposeProgressCache?.();
			// The stop hook uses this journal after immediate abort. Keep it open
			// until durable pause and independent capture cancellation settle.
			const cleanup = stopCleanup.finish().then(() => historyStatus, () => 'error' as const);
			const historyFinish = history?.finish(cleanup);
			await cleanup;
			// A slow optional sample write must not hold the run or host open.
			// Only the journal handle outlives the runner, until its write settles.
			if (historyFinish) void historyFinish.finally(() => journal?.close());
			else journal?.close();
			disposeActivity(); visibility?.dispose(); unsubscribe(); window.removeEventListener('pagehide', leave);
			await releaseWindow?.();
		}
	}, () => {
		stopRequested = true;
		return stopCleanup.request();
	}, { automatic: !!resume || !!automaticPhoto, persistTerminal: progress => {
		if (!rootIdentity.read().pending && rootIdentity.read().generation === generation && isNativeSyncAdapterCurrent(adapter)) {
			persistProgress({ ...progress, statisticsObservedAt: Date.now() });
			pruneCacheNamespace('tt:sync-progress:', progressKey, 32);
		}
	} });
}

/** Stop works while the scheduler is idle as well as during a transfer. CAS
 * fences a concurrent discovery, and cancellation only targets this root. */
export async function pauseNativeSyncJob(scope: SyncScope, generation: number, saved?: SavedFileSyncConfiguration) {
	const check = () => {
		if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) throw Error('The active account changed.');
		return scope;
	};
	// Fence discovery before the first asynchronous journal open.
	check();
	const liveStop = nativeSyncTasks.cancel(scope);
	void liveStop.catch(() => {}); // observed below; journal open can fail independently
	let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
	try {
		journal = await openSyncJournal();
		const jobs = journal.jobs({ scope, currentScope: check });
		const currentAdapter = getNativeSyncAdapter();
		const photo = saved?.configuration.sourceKind === 'photos' && currentAdapter?.platform === 'ios' &&
			supportsNativePhotoAutomation(currentAdapter.bridge) && window.location.origin === scope.origin ? saved : undefined;
		if (photo) await jobs.pausePhoto(photo, crypto.randomUUID());
		await liveStop;
		for (let attempt = 0; attempt < 3; attempt++) {
			await nativeSyncTasks.cancel(scope); check();
			const job = await jobs.read();
			const paused = job && (['paused', 'complete'].includes(job.state) ? job : await jobs.pause(job));
			if (job && !paused) continue;
			await nativeSyncTasks.cancel(scope);
			const adapter = getNativeSyncAdapter();
			if (paused?.reviewed.configuration.sourceKind === 'photos' && adapter?.platform === 'ios' && supportsNativeDeferredUploads(adapter.bridge)) {
				const signal = AbortSignal.timeout(10_000);
				check();
				if (window.location.origin !== scope.origin || !isNativeSyncAdapterCurrent(adapter)) throw Error('The selected sync server changed.');
				await requestMobileFolders(scope.ownerId, { action: 'cancel-deferred-upload', rootId: paused.reviewed.configuration.localRootId,
					configurationId: paused.reviewed.id, deviceId: scope.deviceId }, signal);
			}
			if (paused?.strictCaptureId) {
				const adapter = getNativeSyncAdapter();
				if (!adapter) throw Error('Pause saved. Native indexing cleanup could not be confirmed.');
				try {
					await retireStrictCapture(jobs, paused, saved => cancelSavedStrictCapture(saved, adapter, check));
				} catch {
					throw Error('Pause saved. Native indexing cleanup could not be confirmed.');
				}
			}
			return;
		}
		throw Error('The sync job changed while stopping. Please retry.');
	} finally { journal?.close(); }
}
