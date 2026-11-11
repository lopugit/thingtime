import { nativePathObserver } from './nativePathObservation';
import { reportDeviceSyncHistoryStorage } from './deviceSyncHistory.client';
import { createDeviceSyncHistoryRecorder } from './deviceSyncHistoryRecorder';
import { createSyncActivityObservation } from './syncActivityJournal';
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
import { pauseSyncJobAdmission, retireStrictCapture, SYNC_INTERVALS, SYNC_JOBS_CHANGED_EVENT, syncJobDue, syncJobEnabled, type SyncJob } from './syncJobJournal';
import { holdDesktopSyncWindow, setDesktopSyncScheduled } from './desktopSyncWindow.client';
import { createNativeSyncHost, getNativeSyncAdapter, isNativeSyncAdapterCurrent } from './nativeSyncHost.client';
import { armNativePhotoRun, cancelPendingNativePhotoArm } from './nativePhotoRun.client';
import { watchNativeSyncVisibility } from './nativeSyncVisibility';
import { rootIdentity } from '../utils/rootIdentity';
import { createSyncTaskRuntime, cancelSyncForActivity } from './syncTaskRuntime';
import { createSyncStopCleanup } from './syncStopCleanup';
import { openSyncJournal, withSyncRootLock, syncScopeKey } from './journal.client';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { readNativeInventory, parseNativePhotoQueueBatch, NATIVE_INVENTORY_BATCH_ENTRIES, NativeInventoryRetryWait, NativeStrictInventoryInterrupted, type LocalInventoryPage, type NativeBackupCapture, type NativePhotoQueueApproval, type NativePhotoQueueBatch } from './nativeInventory';
import type { ForegroundSyncInput, ForegroundSyncProgress } from './foregroundSync';
import type { InventoryIdentity } from './inventoryJournal';
import { readCloudFolderInventoryPages } from './cloudInventoryPages.client';
import { readCloudFolderInventory } from './cloudInventory.client';
import { CLOUD_SYNC_DESTINATION_REQUIREMENTS } from './cloudSyncDestination';
import { CLOUD_FOLDER_REQUIREMENTS, parseCloudFolder } from './cloudFolder';
import { cloudRequests } from './cloudTransport';
import { REMOTE_SYNC_ENROLLMENT_RECOVERY_REQUIREMENTS } from './remoteSyncProtocol';
import { createAutomaticStoragePlacement } from './automaticStoragePlacement';
import { preparePhotoSettingsRecovery } from './photoSettingsRecovery';
import { mobileFolderSource, requestMobileFolders, assertNativeFolderInventoryCoverage, supportsNativeInventoryPages, supportsNativePhotoInventoryPages, supportsNativePhotoCloudGaps, supportsNativePhotoCloudFetch, supportsNativePhotoQueue, supportsNativeDeferredUploads, supportsNativePathInspection, supportsNativePathStamp, supportsNativeBackupCapture, supportsNativeStrictCapture, supportsNativeIgnoreRules, supportsNativeInventoryBatches, supportsNativeStreamingIndex, supportsNativeStreamingBatches, supportsNativeAuthorizationContext, supportsNativeCloudStaging, supportsNativeResourceLimits, supportsNativePhotoAutomation, supportsNativePhotoRuns, supportsSoleNativePhotoRun, supportsNativeWriteApprovalCheck } from './mobileFolders.client';
import { approveMobileSyncTarget } from './mobileSyncTarget.client';
import { runNativePhotoQueue, runPhotoBackupPasses } from './photoBackupPasses';
import { assertPhotoSourcePolicy } from './photoSourcePolicy';
import { createConflictReviewController } from './conflictReviewController';
import type { PagedConflictReviewResult } from './pagedForegroundReview';
import type { SyncConflictReviewResult } from './conflictResolution';
import { assertConfiguredSyncApproval, readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from './configuredPlan';
import { validateSyncScope, type SyncScope } from './reconcile';
import { clearLocalCache, writeStampedCache, pruneCacheNamespace } from '../hooks/localCache';
import { TIMELINE_CHANGED_EVENT } from '../timeline/clientEvents';

export const nativeSyncTasks = createSyncTaskRuntime();
export const supportsNativeSyncTasks = () => !!getNativeSyncAdapter();

export const DEFAULT_NATIVE_FOLDER_SYNC_INTERVAL_MS = 300_000;
const FOLDER_ENROLLMENT_TIMEOUT_MS = 90_000;
let folderEnrollment: { key: string; controller: AbortController } | undefined;
const queuedFolderEnrollments = new Map<string, AbortController>();


async function readNativeConfiguration(host: Awaited<ReturnType<typeof createNativeSyncHost>>, scope: SyncScope, signal: AbortSignal) {
 const url = new URL('/api/v1/things', scope.origin);
 url.searchParams.set('id', scope.rootId);
 const response = await host.fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal,
  headers: { 'X-Thingtime-Expected-Actor': scope.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
 if (!response.ok) throw cloudSyncHttpError(response.status, response.headers.get('retry-after'));
 return (await response.json()).thing as unknown;
}

/** Only for an explicit Save & Sync on this device. When the native lane is
 * busy, journal the exact saved config without performing any file operation.
 * The runner will verify its grants and existing write consent before work. */
export async function enrollNativeFolderSync(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number,
 intervalMs: number = DEFAULT_NATIVE_FOLDER_SYNC_INTERVAL_MS, signal: AbortSignal = new AbortController().signal,
 options: { queue?: boolean; respectPause?: boolean; recoverSavedIntent?: true } = {}) {
 signal.throwIfAborted();
 if (options.recoverSavedIntent && !options.respectPause) throw Error('Saved automatic setup must respect the current pause.');
 const key = syncScopeKey(scope), task = nativeSyncTasks.read();
 if ((task?.active && syncScopeKey(task.scope) === key) || folderEnrollment?.key === key)
  throw Error('This sync config already has a transfer or approval in progress. Check its current status.');
 if (options.recoverSavedIntent && (task?.active || folderEnrollment))
  throw Error('The device is busy. Saved automatic setup will resume when it is free.');
 if (task?.active || folderEnrollment || options.queue)
  return queueNativeFolderEnrollment(saved, scope, generation, intervalMs, signal, options.respectPause);
 const pending = { key, controller: new AbortController() };
 const timeout = AbortSignal.timeout(FOLDER_ENROLLMENT_TIMEOUT_MS);
 const bounded = AbortSignal.any([signal, pending.controller.signal, timeout]);
 folderEnrollment = pending;
 try {
  return await confirmNativeFolderEnrollment(saved, scope, generation, intervalMs, bounded, options);
 } catch (cause) {
  if (timeout.aborted && !signal.aborted && !pending.controller.signal.aborted)
   throw Error('The device did not confirm automatic sync in time. Check its current status before enabling sync again.');
  throw cause;
 } finally {
  folderEnrollment = undefined;
  // A discovery pass that found the approval barrier should check again.
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_JOBS_CHANGED_EVENT));
 }
}

function folderEnrollmentContext(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number, intervalMs: number, signal: AbortSignal) {
 const reviewed = structuredClone(saved), binding = structuredClone(scope);
 const config = reviewed.configuration;
 validateSyncScope(binding);
 if (binding.dataPlane !== 'home' || binding.rootId !== reviewed.id || binding.deviceId !== config.deviceId || config.paused || config.sourceKind === 'photos')
  throw Error('Save and enable this device folder’s sync config before starting automatic sync.');
 if (!SYNC_INTERVALS.some(interval => interval === intervalMs)) throw Error('Choose a supported sync interval.');
 const adapter = getNativeSyncAdapter();
 if (!adapter) throw Error('Update Thingtime before using automatic folder sync.');
 const check = () => {
  signal.throwIfAborted();
  const identity = rootIdentity.read();
  if (identity.pending || identity.generation !== generation || !isNativeSyncAdapterCurrent(adapter))
   throw Error('The active account changed. Reopen folder access.');
  if (!activityManager.enabled('sync.execution') || !activityManager.enabled('sync.automation'))
   throw Error('Enable file sync and automatic discovery in Activity manager before starting automatic sync.');
  return binding;
 };
 check();
 return { reviewed, binding, config, adapter, check };
}

async function queueNativeFolderEnrollment(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number, intervalMs: number, lifetime: AbortSignal, respectPause = false) {
 const key = syncScopeKey(scope);
 if (queuedFolderEnrollments.has(key)) throw Error('This sync config is already being queued. Check its current status.');
 const pending = new AbortController();
 const signal = AbortSignal.any([lifetime, pending.signal, AbortSignal.timeout(10_000)]);
 const { reviewed, binding, check: assertCurrent } = folderEnrollmentContext(saved, scope, generation, intervalMs, signal);
 const check = () => {
  assertCurrent();
  if (respectPause && nativeSyncTasks.isPaused(binding)) throw Error('Automatic sync setup was paused.');
  return binding;
 };
 check();
 queuedFolderEnrollments.set(key, pending);
 try {
  return await withSyncRootLock(binding, async () => {
   const journal = await openSyncJournal();
   try {
    const jobs = journal.jobs({ scope: binding, currentScope: check, signal });
    const prior = await jobs.read();
    if (prior && syncJobEnabled(prior) && prior.intervalMs === intervalMs && JSON.stringify(prior.reviewed) === JSON.stringify(reviewed)) return prior;
    // A recovered Save & Sync intent can refer to the exact job that needs
    // attention. Re-admit that job under its original ID; the worker will
    // verify the saved config, grants and native write approval before effects.
    // A strict scanner still needs its explicit native cleanup on the idle lane.
    if (prior?.state === 'attention' && prior.nextRunAt === undefined && !prior.strictCaptureId && !prior.folderSetupPaused &&
     prior.intervalMs === intervalMs && JSON.stringify(prior.reviewed) === JSON.stringify(reviewed)) {
     const resumed = await jobs.admit(reviewed, crypto.randomUUID(), intervalMs, undefined, undefined,
      { previous: prior, pendingFolderValidation: true });
     check();
     if (!respectPause) nativeSyncTasks.resumeScope(binding);
     return resumed;
    }
    // Replacing an unfinished old config can require verified native scanner
    // cancellation. Queue only first-time configs while the lane is occupied.
    if (prior && prior.state !== 'complete')
     throw Error('This sync config has saved work. Wait for the device to finish its current transfer before enabling it again.');
    const queued = await jobs.admit(reviewed, crypto.randomUUID(), intervalMs, undefined, undefined, { previous: prior, pendingFolderValidation: true });
    check();
    if (!respectPause) nativeSyncTasks.resumeScope(binding);
    return queued;
   } finally { journal.close(); }
  }, undefined, signal);
 } finally { queuedFolderEnrollments.delete(key); }
}

async function confirmNativeFolderEnrollment(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number, intervalMs: number, signal: AbortSignal,
 options: { respectPause?: boolean; recoverSavedIntent?: true } = {}) {
 const context = folderEnrollmentContext(saved, scope, generation, intervalMs, signal);
 const { reviewed, binding, config, adapter } = context;
 const check = () => {
  context.check();
  if (options.respectPause && nativeSyncTasks.isPaused(binding)) throw Error('Automatic sync setup was paused.');
  if (options.recoverSavedIntent && nativeSyncTasks.read()?.active) throw Error('The device is busy. Saved automatic setup will resume when it is free.');
  return binding;
 };
 check();
 const host = await createNativeSyncHost({ adapter, ownerId: binding.ownerId, deviceId: binding.deviceId, signal, assertCurrent: check });
 if (host.origin() !== binding.origin) throw Error('The selected sync server changed.');
 if (options.recoverSavedIntent) await host.requireCapability('api.devices-sync-control', REMOTE_SYNC_ENROLLMENT_RECOVERY_REQUIREMENTS['api.devices-sync-control']);
 const assertExact = async () => {
  const current = readOwnedFileSyncConfiguration(await readNativeConfiguration(host, binding, signal), binding.ownerId);
  check();
  assertConfiguredSyncApproval(current, { ...reviewed, scope: binding }, binding, config.localRootId, config.remoteFolderId);
 };
 await host.requireCapability('api.things', config.resourceLimits ? '1.39.0' : config.ignoreRules ? '1.38.0' : '1.36.0');
 if (config.resourceLimits) await host.requireCapability('api.file-sync-batches', '1.2.0');
 const downloadRequirements = fileSyncDownloadRequirements(config);
 for (const [feature, minimum] of Object.entries(downloadRequirements)) await host.requireCapability(feature, minimum);
 if (Object.keys(downloadRequirements).length && !supportsNativeCloudStaging(host.capabilities))
  throw Error('Update Thingtime before using a CPU target for downloads. This connection requires scoped native signed-range downloads.');
 if (config.ignoreRules && !supportsNativeIgnoreRules(host.capabilities))
  throw Error('Update Thingtime Mac before using this connection’s Gitignore rules.');
 await assertExact();
 return await withSyncRootLock(binding, async () => {
  check();
  const journal = await openSyncJournal();
  try {
   const jobs = journal.jobs({ scope: binding, currentScope: check, signal });
   let prior = await jobs.read();
   if (prior && !prior.pendingFolderValidation && !nativeSyncTasks.isPaused(binding) && syncJobEnabled(prior) && prior.intervalMs === intervalMs &&
    JSON.stringify(prior.reviewed) === JSON.stringify(reviewed)) return prior;
   if (options.recoverSavedIntent &&
    !(prior?.state === 'attention' && prior.nextRunAt === undefined && !!prior.strictCaptureId && !prior.folderSetupPaused &&
     prior.intervalMs === intervalMs && JSON.stringify(prior.reviewed) === JSON.stringify(reviewed)))
    throw Error('This sync config has saved work. Wait for the device to finish its current transfer before enabling it again.');
   const roots = (await host.request(binding.ownerId, { action: 'list' }, signal)).roots;
   assertPhotoSourcePolicy(config, roots);
   if (roots.find(root => root.id === config.localRootId)?.sourceKind === 'photos') throw Error('Use the Photos backup controls for this source.');
   assertNativeFolderInventoryCoverage(host.capabilities, config);
   const { json, negotiate } = cloudRequests({ currentScope: check, origin: host.origin, fetch: host.fetch, requireCapability: host.requireCapability }, binding, signal);
   await negotiate(CLOUD_FOLDER_REQUIREMENTS);
   if (parseCloudFolder((await json('/api/v1/files?' + new URLSearchParams({ folderId: config.remoteFolderId }))).folder).id !== config.remoteFolderId)
    throw Error('The cloud folder changed.');
   if (prior?.strictCaptureId) {
    // Retire only the old admitted scanner and keep its execution receipts.
    // Pause or another job revision may win while native cleanup is in flight.
    prior = await retireStrictCapture(jobs, prior, job => cancelSavedStrictCapture(job, adapter, check, signal));
    if (!prior) throw Error('The saved sync job changed while retiring its earlier scan. Check its current status.');
   }
   if (prior?.nativeCaptureId) {
    const unfinished = prior.state !== 'complete' && prior.nextRunAt === undefined;
    const samePolicy = JSON.stringify(prior.reviewed.configuration) === JSON.stringify(config);
    const retainsCapture = unfinished && samePolicy && JSON.stringify(prior.reviewed) === JSON.stringify(reviewed);
    if (!retainsCapture && (!unfinished || samePolicy || prior.state === 'paused')) {
     const old = prior.reviewed.configuration;
     const retired = await host.request(binding.ownerId, {
      action: 'scan-cancel', rootId: old.localRootId, inventoryDeviceId: binding.deviceId,
      captureId: prior.nativeCaptureId, capturePolicy: 'backup-supported', excludedPaths: old.excludedPaths,
      ...(old.ignoreRules ? { ignoreRules: old.ignoreRules } : {})
     }, signal);
     check();
     if (retired.cancelled !== true) throw Error('The previous folder scan could not be cancelled. Its saved work is still paused.');
     prior = await jobs.capture(prior, null);
     if (!prior) throw Error('The saved sync job changed while retiring its earlier scan. Check its current status.');
    }
   }
   if (config.mode === 'download' || config.mode === 'two-way') {
    if (!supportsNativeWriteApprovalCheck(host.capabilities))
     throw Error('Update the app to resume with saved folder approval without a dialog.');
    await approveMobileSyncTarget(reviewed, binding, signal, host.request, host.capabilities);
   }
   await assertExact();
   const pending = await jobs.admit(reviewed, crypto.randomUUID(), intervalMs, undefined, undefined, { previous: prior });
   check();
   if (!options.recoverSavedIntent) nativeSyncTasks.resumeScope(binding);
   if (adapter.platform === 'macos') void setDesktopSyncScheduled(true, adapter.bridge).catch(() => {});
   return pending;
  } finally { journal.close(); }
 }, undefined, signal);
}

async function cancelSavedStrictCapture(job: SyncJob, adapter: NonNullable<ReturnType<typeof getNativeSyncAdapter>>, checkIdentity: () => void, lifetime?: AbortSignal) {
	if (!job.strictCaptureId) return;
	const timeout = AbortSignal.timeout(10_000), { scope, reviewed } = job;
	const signal = lifetime ? AbortSignal.any([timeout, lifetime]) : timeout;
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
export async function startNativeSyncTask(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number, resume?: SyncJob, intervalMs?: number, automaticPhoto?: { wakeConditions: boolean; signal?: AbortSignal }, wakeConditions = false) {
	if (folderEnrollment) {
		if (resume || automaticPhoto) return;
		throw Error('Another sync config is waiting for device approval. Finish that approval before starting a transfer.');
	}
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
	if (photoHost && supportsSoleNativePhotoRun(adapter.bridge) && reviewed.configuration.sourceKind === 'photos') {
		if (!activityManager.enabled('sync.automation')) throw Error('Enable automatic file sync in Activity manager before starting Photos backup.');
		return armNativePhotoRun({ reviewed, scope: binding, generation, adapter, automatic: !!automaticPhoto || !!resume,
			discoverySignal: automaticPhoto?.signal, isPaused: nativeSyncTasks.isPaused, resumeScope: nativeSyncTasks.resumeScope });
	}

	const progressKey = 'tt:sync-progress:' + syncScopeKey(binding);
	const persistProgress = (value: ForegroundSyncProgress) => writeStampedCache(progressKey, value);
	const stopCleanup = createSyncStopCleanup(async () => { if (resume) throw Error('Transfer stopped, but saved native cleanup could not be opened. Reopen this connection before resuming.'); });
	let stopRequested = false, saveStop: (() => Promise<void>) | undefined, cancelCapture: ((streamingOnly?: boolean) => Promise<void>) | undefined;
	await nativeSyncTasks.start(binding, async (signal, update) => {
		const disposeActivity = activityManager.register({id:'sync.execution',title:'File transfer and filesystem indexing',kind:'watcher',background:true,detail:'Owns the current index, upload/download runner, index change reads and their native tasks. Disable to cancel this runner; saved transfer work is retained.'}, activitySignal => {
			const disabled=()=>{if(activitySignal.reason==='disabled') void cancelSyncForActivity(nativeSyncTasks).catch(() => {});};
			activitySignal.addEventListener('abort',disabled,{once:true});return()=>activitySignal.removeEventListener('abort',disabled);
		});
		const checkIdentity = () => {
			if (rootIdentity.read().pending || rootIdentity.read().generation !== generation || !isNativeSyncAdapterCurrent(adapter))
				throw Error('The active account changed. Reopen folder access.');
		};
		let deferredCount = 0, deferredScheduled: boolean | undefined, photoRunArmed = false;
		const visibility = adapter.platform === 'ios' ? watchNativeSyncVisibility(signal, message =>
			nativeSyncTasks.suspend(photoRunArmed ? 'Photos backup can continue in the background when iOS allows.' : deferredCount > 0 ?
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
		let activity: ReturnType<typeof createSyncActivityObservation> | undefined, waiting = false, recoveryCandidate = resume;
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
			cancelCapture = async (streamingOnly = false) => {
				if (!streamingOnly) await cancelStrictCapture();
				// Cleanup must outlive the aborted execution host, while retaining
				// the same account generation, adapter, origin, device and root.
				const cleanupSignal = AbortSignal.timeout(10_000);
				const cleanupCheck = () => { cleanupSignal.throwIfAborted(); checkIdentity(); };
				const streaming = await journal!.pagedRuns({ scope: binding, currentScope: () => { cleanupCheck(); return binding; } }).active();
				const captures = [
					...(streaming?.spec.streaming && streaming.spec.streaming.source !== 'remote' ? [{ id: streaming.spec.streaming.captureId, policy: 'one-way-supported' as const }] : []),
					...(!streamingOnly && (job ?? resume)?.nativeCaptureId ? [{ id: (job ?? resume)!.nativeCaptureId!, policy: 'backup-supported' as const }] : [])
				];
				const cancelDeferred = reviewed.configuration.sourceKind === 'photos' && adapter.platform === 'ios' && supportsNativeDeferredUploads(adapter.bridge);
				if (cancelDeferred && !streamingOnly) {
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
			const transport = { ...(resources ? { resources } : {}), currentScope, origin: host.origin, fetch: host.fetch, requireCapability: host.requireCapability };
			const runtime = { ...transport, automaticStoragePlacement: createAutomaticStoragePlacement(transport, binding, signal) };
			const readConfiguration = async () => { const value = await readNativeConfiguration(host, binding, signal); check(); return value; };
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
				if (resume?.pendingFolderValidation) {
					const current = readOwnedFileSyncConfiguration(await readConfiguration(), binding.ownerId);
					const { localRootId, remoteFolderId } = reviewed.configuration;
					if (current.id === reviewed.id && current.configuration.deviceId === binding.deviceId && current.configuration.paused)
						throw new SyncConditionsWait('paused');
					assertConfiguredSyncApproval(current, { ...reviewed, scope: binding }, binding, localRootId, remoteFolderId);
					const { json, negotiate } = cloudRequests(runtime, binding, signal);
					await negotiate(CLOUD_FOLDER_REQUIREMENTS);
					if (parseCloudFolder((await json('/api/v1/files?' + new URLSearchParams({ folderId: remoteFolderId }))).folder).id !== remoteFolderId)
						throw Error('The cloud folder changed.');
				}
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
					if (resumeJob) recoveryCandidate = resumeJob = prior;
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
				admissionPending = resumeJob ? jobs!.begin(resumeJob, Date.now(), crypto.randomUUID(), automaticPhoto, wakeConditions) :
					jobs!.admit(reviewed, crypto.randomUUID(), photoAutomation ? PHOTO_AUTOMATION_INTERVAL_MS : intervalMs, photoSettings, automaticPhoto ? { previous: prior } : undefined);
				job = await admissionPending;
				if (!job) return; // A stopped/completed/replaced discovery is never replayed.
				activity = createSyncActivityObservation(crypto.randomUUID());
				update({ activity: activity.snapshot() });
				if (photoSettings) {
					for (const prefix of ['tt:sync-progress:', 'tt:sync-inventory:', 'tt:sync-progress-tree:'])
						clearLocalCache(prefix + syncScopeKey(binding));
				}
				if (stopRequested) await jobs!.transition(job, 'paused');
				check();
				if (photoAutomation && supportsNativePhotoRuns(capabilities)) {
					try {
						await host.requireCapability('api.file-sync-transfer-admissions', '1.2.0'); check();
						await request(binding.ownerId, { action: 'arm-photo-run', rootId: reviewed.configuration.localRootId,
							authorization: { ...reviewed, scope: binding } }, signal);
						photoRunArmed = true;
					} catch { check(); } // An older/unavailable endpoint keeps foreground backup available.
				}

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
						deferredUploads = { ...(photoRunArmed ? { skipLookahead: true as const } : {}), queued: (count, scheduled) => { deferredCount = count; if (scheduled !== undefined) deferredScheduled = scheduled; } };
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
						transfer: value => { check(); history?.transfer(value); activity?.transfer(value); update({ transfer: value, activity: activity?.snapshot() }); },
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
						...(supportsNativePathStamp(capabilities) && reviewed.configuration.sourceKind !== 'photos' ? { inspectLocalStamp: async (path: string) => (await request(binding.ownerId,
							{ action: 'inspect-stamp', rootId: reviewed.configuration.localRootId, path }, signal)).inspectedStamp! } : {}),
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
			// Releasing this JS lane must also release the native scanner so another
			// config can run. Its positive observations and receipts stay durable;
			// a stopped native generation reconciles through a fresh sealed scan.
			if (!signal.aborted) {
				if (reviewed.configuration.mode === 'two-way') await cancelCapture?.().catch(() => {});
				else if (reviewed.configuration.sourceKind === 'folder') await cancelCapture?.(true).catch(() => {});
			}
			const failed = job ?? recoveryCandidate;
   if (failed && jobs && !signal.aborted && !photoAutomation && error instanceof NativeStrictInventoryInterrupted &&
    await jobs.retryStrictCapture(failed, Date.now())) {
    waiting = true;
    throw new SyncConnectionWait('Indexing was interrupted. Thingtime will check the folder again once; confirmed files are preserved.');
   }
			if (failed && jobs && !signal.aborted && error instanceof SyncConditionsWait) {
				waiting = error.reason !== 'paused';
				if (error.reason === 'paused') await jobs.pause(failed);
				else await jobs.defer(failed, Date.now(), undefined, error, photoAutomation);
			}
			if (failed && jobs && !signal.aborted && (isSyncConnectionFailure(error) || error instanceof NativeInventoryRetryWait)) {
				waiting = true;
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
   const activityFinish = activity && cleanup.then(status => journal!.syncActivity({
    scope: binding, currentScope: () => { checkIdentity(); return binding; }
   }).append(activity!.finish(waiting && status === 'paused' ? 'waiting' : status)));
   await cleanup;
			// A slow optional sample write must not hold the run or host open.
			// Only the journal handle outlives the runner, until its write settles.
			if (historyFinish || activityFinish) void Promise.allSettled([historyFinish, activityFinish]).then(() => journal?.close());
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
export async function pauseNativeSyncJob(scope: SyncScope, generation: number, reviewed?: SavedFileSyncConfiguration | (() => Promise<SavedFileSyncConfiguration>)) {
	const check = () => {
		if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) throw Error('The active account changed.');
		return scope;
	};
	// Fence discovery before the first asynchronous journal open.
	check();
	const key = syncScopeKey(scope);
	const pause = new DOMException('Automatic sync setup was paused.', 'AbortError');
	if (folderEnrollment?.key === key) folderEnrollment.controller.abort(pause);
	queuedFolderEnrollments.get(key)?.abort(pause);
	cancelPendingNativePhotoArm(scope);
	const liveStop = nativeSyncTasks.cancel(scope);
	void liveStop.catch(() => {}); // observed below; journal open can fail independently
	let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
	try {
		journal = await openSyncJournal();
		const jobs = journal.jobs({ scope, currentScope: check });
		const currentAdapter = getNativeSyncAdapter();
		let saved = typeof reviewed === 'function' ? undefined : reviewed;
		const photo = saved?.configuration.sourceKind === 'photos' && currentAdapter?.platform === 'ios' &&
			supportsNativePhotoAutomation(currentAdapter.bridge) && window.location.origin === scope.origin ? saved : undefined;
		if (photo) await jobs.pausePhoto(photo, crypto.randomUUID());
		await liveStop;
		for (let attempt = 0; attempt < 3; attempt++) {
			await nativeSyncTasks.cancel(scope); check();
			const job = await jobs.read();
			if (!saved && typeof reviewed === 'function' && (!job || job.state === 'complete')) {
				saved = await reviewed();
				check();
			}
			const beforeAdmission = saved && saved.configuration.sourceKind !== 'photos' && (!job || job.state === 'complete');
			const paused = beforeAdmission ? await jobs.pauseFolderSetup(saved, crypto.randomUUID()) :
				job && (['paused', 'complete'].includes(job.state) ? job : await jobs.pause(job));
			if ((job || beforeAdmission) && !paused) continue;
			await nativeSyncTasks.cancel(scope);
			const adapter = getNativeSyncAdapter();
			if (paused?.reviewed.configuration.sourceKind === 'photos' && adapter?.platform === 'ios' && supportsNativeDeferredUploads(adapter.bridge)) {
				const signal = AbortSignal.timeout(10_000);
				check();
				if (window.location.origin !== scope.origin || !isNativeSyncAdapterCurrent(adapter)) throw Error('The selected sync server changed.');
				await requestMobileFolders(scope.ownerId, { action: 'cancel-deferred-upload', rootId: paused.reviewed.configuration.localRootId,
					configurationId: paused.reviewed.id, deviceId: scope.deviceId, ...(photo ? { explicitPause: true as const } : {}) }, signal);
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
