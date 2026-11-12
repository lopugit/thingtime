import { sameFolderUploadPolicySource } from './photoSettingsPolicy';
import { supportsNativeUploadPolicy } from './photoTransferPolicy';
import { readOwnedFileSyncConfiguration } from './configuredPlan';
import { activityManager } from '~/activity/activityManager';
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { SYNC_STARTUP_STARTED_EVENT, syncStartup } from './syncStartup';
import { approveMobileSyncTarget } from './mobileSyncTarget.client';
import { nativeBridgeMessageEvent, nativeBridgeReadyEvent } from '../utils/nativeBridge';
import { PHOTO_AUTOMATION_INTERVAL_MS } from './configuration';
import { cancelAllPendingNativePhotoArms } from './nativePhotoRun.client';
import { requestMobileFolders, supportsNativePhotoAutomation, supportsSoleNativePhotoRun } from './mobileFolders.client';
import { discoverAutomaticPhotos } from './photoAutomationScheduler';
import { rootIdentity } from '../utils/rootIdentity';
import { createNativeSyncHost, getNativeSyncAdapter, isNativeSyncAdapterCurrent } from './nativeSyncHost.client';
import { nativeSyncTasks, readNativeConfiguration, startNativeSyncTask } from './nativeSyncTasks.client';
import { isSyncConnectionFailure } from './syncConnectionWait';
import { cancelSyncForActivity } from './syncTaskRuntime';
import { recoverSavedSyncEnrollments } from './syncEnrollmentRecovery.client';
import { SYNC_ENROLLMENT_WAKE_EVENT } from './configurationEditor';
import { openSyncJournal } from './journal.client';
import { SYNC_JOBS_CHANGED_EVENT, SYNC_UPLOAD_POLICY_CHANGED_EVENT, syncJobDue, syncJobEnabled, type SyncJob } from './syncJobJournal';
import { setDesktopSyncScheduled } from './desktopSyncWindow.client';
import { syncScopeKey, type SyncScope } from './reconcile';

const SYNC_FOREGROUND_START_EVENT = 'tt:sync-foreground-start';

let discoveryInFlight: Promise<void> | undefined;
const discoveredExecutions = new Map<string, Promise<unknown>>();
const verifiedDesktopOrigins = new WeakMap<object, { ownerId: string; generation: number; rendererOrigin: string; devices: Map<string, string> }>();
/** The root shell owns discovery outside the Files view. Enabled Photos need
 * a current grant on this device. Other sources resume existing admissions. */
export async function resumeNativeSyncJobs(ownerId: string, generation: number, signal: AbortSignal, wakeConditions = false, foregroundStart = false, started?: () => void, foregroundJobs = new Set<string>(), recovered?: () => void, foregroundStarted = new Set<string>()) {
	if (discoveryInFlight) {
		await discoveryInFlight.catch(() => {});
		signal.throwIfAborted();
		if (discoveryInFlight) return;
	}
	const run = discoverNativeSyncJobs(ownerId, generation, signal, wakeConditions, foregroundStart, started, foregroundJobs, recovered, foregroundStarted);
	discoveryInFlight = run;
	try { await run; } finally { if (discoveryInFlight === run) discoveryInFlight = undefined; }
}

async function discoverNativeSyncJobs(ownerId: string, generation: number, signal: AbortSignal, wakeConditions: boolean, foregroundStart: boolean, started: (() => void) | undefined, foregroundJobs: Set<string>, recovered: (() => void) | undefined, foregroundStarted: Set<string>) {
	const adapter = getNativeSyncAdapter();
	const bridge = adapter?.platform === 'macos' ? adapter.bridge : undefined;
	if (!activityManager.enabled('sync.automation') || !activityManager.enabled('sync.execution')) {
		if (bridge) await setDesktopSyncScheduled(false, bridge);
		return;
	}
	const startup = adapter && (foregroundStart || foregroundJobs.size) ? syncStartup.begin({ ownerId, generation, origin: window.location.origin }) : undefined;
	const recovery = await recoverSavedSyncEnrollments(ownerId, generation, signal, adapter);
	startup?.pendingIntents(recovery.pendingLocalIntents);
	if (recovery.durableProgress && (recovery.pendingLocalIntents === null || recovery.pendingLocalIntents > 0)) recovered?.();
	if (!adapter || (adapter.platform === 'ios' && document.visibilityState === 'hidden')) return;
	let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
	const scope: SyncScope = { origin: window.location.origin, ownerId, dataPlane: 'home', rootId: 'sync-job-discovery', deviceId: 'sync-job-discovery' };
	const currentScope = () => {
		signal.throwIfAborted();
		if (rootIdentity.read().pending || rootIdentity.read().generation !== generation || !isNativeSyncAdapterCurrent(adapter) || (adapter.platform === 'ios' && document.visibilityState === 'hidden'))
			throw Error('Sync discovery account changed.');
		return scope;
	};
	try {
		currentScope(); journal = await openSyncJournal(); currentScope();
		const jobs = journal.jobs({ scope, currentScope, signal });
		const readJobs = async () => {
			const all: SyncJob[] = []; let after: string | undefined;
			for (;;) {
				const result = await jobs.list(after); currentScope(); all.push(...result.jobs);
				if (!result.next) return all;
				if (result.jobs.length === 0 || (after !== undefined && result.next <= after)) throw Error('Saved sync job discovery cursor did not advance.');
				after = result.next;
			}
		};
		const discovered = await readJobs();
		const automaticPhotos = adapter.platform === 'ios' && supportsNativePhotoAutomation(adapter.bridge);
		if (automaticPhotos) await discoverAutomaticPhotos({
			ownerId, adapter, signal, assertCurrent: currentScope, jobs: discovered, wakeConditions, nativeOnly: supportsSoleNativePhotoRun(adapter.bridge),
			paused: nativeSyncTasks.isPaused,
			observe: startup?.observe,
			checking: startup?.checking,
			foregroundStart,
			run: (saved, scope, prior) => nativeSyncTasks.read()?.active && !supportsSoleNativePhotoRun(adapter.bridge) ? Promise.resolve() :
				startNativeSyncTask(saved, scope, generation, prior, PHOTO_AUTOMATION_INTERVAL_MS, { wakeConditions, signal, foregroundStart })
		});
		const explicitJobs = automaticPhotos ? discovered.filter(job => job.reviewed.configuration.sourceKind !== 'photos') : discovered;
		// Old admissions from another selected server/device must neither run
		// nor keep this window alive. Temporary context failure waits for retry.
		const hosts = new Map<string, Awaited<ReturnType<typeof createNativeSyncHost>>>();
		const origins = new Map<string, string | null>(), waitingOrigins = new Map<string, string>();
		let prior = bridge ? verifiedDesktopOrigins.get(bridge) : undefined;
		if (bridge && (!prior || prior.ownerId !== ownerId || prior.generation !== generation || prior.rendererOrigin !== scope.origin)) {
			prior = { ownerId, generation, rendererOrigin: scope.origin, devices: new Map() };
			verifiedDesktopOrigins.set(bridge, prior);
		}
		for (const job of explicitJobs.filter(job => !nativeSyncTasks.isPaused(job.scope) && (job.state === 'runnable' || syncJobEnabled(job)))) {
			if (origins.has(job.scope.deviceId)) continue;
			try {
				const host = await createNativeSyncHost({ ownerId, deviceId: job.scope.deviceId, adapter, signal, assertCurrent: () => { currentScope(); } });
				const origin = host.origin();
				startup?.checking({ origin, ownerId, deviceId: job.scope.deviceId, dataPlane: 'home' });
				origins.set(job.scope.deviceId, origin);
                hosts.set(job.scope.deviceId, host);
				prior?.devices.set(job.scope.deviceId, origin);
			} catch (cause) {
				currentScope(); origins.set(job.scope.deviceId, null);
				startup?.observe(job.scope, 'error');
				// Only retain a previously verified window on a typed transient
				// failure. It grants no authority and cannot select an origin to run.
				const previousOrigin = prior?.devices.get(job.scope.deviceId);
				if (previousOrigin && isSyncConnectionFailure(cause)) waitingOrigins.set(job.scope.deviceId, previousOrigin);
				else prior?.devices.delete(job.scope.deviceId);
			}
		}
		const selected = (job: SyncJob) => origins.get(job.scope.deviceId) === job.scope.origin;
		const retained = (job: SyncJob) => !nativeSyncTasks.isPaused(job.scope) && (job.state === 'runnable' || syncJobEnabled(job)) &&
			(selected(job) || waitingOrigins.get(job.scope.deviceId) === job.scope.origin);
		if (bridge) await setDesktopSyncScheduled(discovered.some(retained), bridge); currentScope();
		for (const job of explicitJobs) if (!nativeSyncTasks.isPaused(job.scope) && selected(job) && ['runnable', 'scheduled'].includes(job.state)) startup?.observe(job.scope, 'checking');
		startup?.finishDiscovery();
		for (const job of explicitJobs) {
			currentScope();
            if (nativeSyncTasks.isPaused(job.scope) || !selected(job) || !['runnable', 'scheduled'].includes(job.state)) continue;
            try {
            let reviewed = job.reviewed, policyChanged = false;
            if (foregroundStart || foregroundJobs.has(job.key) || (supportsNativeUploadPolicy(adapter.bridge) && reviewed.configuration.sourceKind !== 'photos' && reviewed.configuration.mode === 'backup')) {
                const host = hosts.get(job.scope.deviceId)!;
                const current = readOwnedFileSyncConfiguration(await readNativeConfiguration(host, job.scope, signal), ownerId); currentScope();
                if (current.id === reviewed.id && current.configuration.paused) { foregroundJobs.delete(job.key); startup?.ignore(job.scope); continue; }
                policyChanged = current.id === reviewed.id && sameFolderUploadPolicySource(reviewed.configuration, current.configuration) && JSON.stringify(current) !== JSON.stringify(reviewed);
                if (policyChanged) reviewed = current;
                else if ((foregroundStart || foregroundJobs.has(job.key)) && JSON.stringify(current) !== JSON.stringify(reviewed)) {
                    foregroundJobs.delete(job.key); startup?.observe(job.scope, 'error'); continue;
                }
                if (foregroundStart || foregroundJobs.has(job.key)) {
                    const roots = (await host.request(ownerId, { action: 'list' }, signal)).roots; currentScope();
                    if (!roots.some(root => root.id === reviewed.configuration.localRootId)) throw Error('The saved folder grant is unavailable.');
                    if (['download', 'two-way'].includes(reviewed.configuration.mode)) {
                        await approveMobileSyncTarget(reviewed, job.scope, signal, host.request, host.capabilities, 'existing'); currentScope();
                    }
                }
            }
            startup?.observe(job.scope, 'checking');
            const immediate = (foregroundStart && !foregroundStarted.has(job.key)) || foregroundJobs.has(job.key);
            const due = syncJobDue(job, Date.now(), wakeConditions, immediate) || (policyChanged && job.retryAt === undefined);
            const activeTask = nativeSyncTasks.read();
            if (activeTask?.active) {
                const same = syncScopeKey(activeTask.scope) === job.key;
                if (same) { foregroundJobs.delete(job.key); foregroundStarted.add(job.key); }
                else if (immediate && due) foregroundJobs.add(job.key);
                startup?.observe(job.scope, same ? 'running' : 'waiting'); continue;
            }
            if (due) {
                foregroundJobs.delete(job.key);
                let admitted!: () => void;
                const admission = new Promise<void>(resolve => { admitted = resolve; });
                const observe = (outcome: 'running' | 'waiting' | 'complete' | 'error') => {
                    try { currentScope(); } catch { return; }
                    startup?.observe(job.scope, outcome);
                    if (startup?.announce()) started?.();
                };
                const execution = startNativeSyncTask(reviewed, job.scope, generation, job, undefined, undefined, wakeConditions,
                    { foregroundStart: immediate, admitted: () => { foregroundStarted.add(job.key); observe('running'); admitted(); } });
                discoveredExecutions.set(job.key, execution);
                // Discovery waits for admission, not the upload. The canonical
                // task owns execution and survives route/focus discovery passes.
                void execution.then(() => {
                    const task = nativeSyncTasks.read();
                    observe(!task || syncScopeKey(task.scope) !== job.key || task.status === 'error' ? 'error' : task.waiting ? 'waiting' : task.status === 'complete' ? 'complete' : 'error');
                }, () => observe('error')).finally(() => {
                    if (discoveredExecutions.get(job.key) === execution) discoveredExecutions.delete(job.key);
                    admitted();
                });
                await admission; currentScope();
            } else startup?.observe(job.scope, 'waiting');
            } catch {
                currentScope(); foregroundJobs.delete(job.key); startup?.observe(job.scope, 'error');
            }
		}
		if (bridge) await setDesktopSyncScheduled((await readJobs()).some(retained), bridge); currentScope();
		if (startup?.announce()) started?.();
	} catch (cause) { currentScope(); startup?.failDiscovery(); throw cause; }
	finally { journal?.close(); }
}

export function NativeSyncBootstrap({ ownerId, generation }: { ownerId: string; generation: number }) {
	const location = useLocation();
	useEffect(() => { window.dispatchEvent(new Event(SYNC_FOREGROUND_START_EVENT)); }, [ownerId, generation, location.key]);
	useEffect(() => () => syncStartup.clear({ ownerId, generation, origin: window.location.origin }), [ownerId, generation]);
	useEffect(() => { activityManager.define({id:'sync.execution',title:'File transfer and filesystem indexing',kind:'watcher',background:true,detail:'Disable to cancel the current indexing/transfer runner and prevent manual or automatic admission. Saved data and jobs are retained.'}); }, []);
	useEffect(() => {
		let disabled = false;
		const reconcile = () => {
			const adapter = getNativeSyncAdapter(), identity = rootIdentity.read();
			if (adapter?.platform !== 'ios' || !supportsSoleNativePhotoRun(adapter.bridge) || identity.pending || identity.generation !== generation) return;
			const next = !activityManager.enabled('sync.execution') || !activityManager.enabled('sync.automation');
			if (next === disabled) return;
			disabled = next;
			if (disabled) {
				cancelAllPendingNativePhotoArms();
				void requestMobileFolders(ownerId, { action: 'pause-photo-runs' }, AbortSignal.timeout(10_000)).catch(() => {});
			} else window.dispatchEvent(new Event(SYNC_JOBS_CHANGED_EVENT));
		};
		reconcile();
		const unsubscribe = activityManager.subscribe(reconcile);
		window.addEventListener(nativeBridgeReadyEvent, reconcile);
		return () => { unsubscribe(); window.removeEventListener(nativeBridgeReadyEvent, reconcile); };
	}, [ownerId, generation]);
	useEffect(() => activityManager.register({id:'sync.automation',title:'Automatic file sync discovery',kind:'schedule',background:true,detail:'Owns saved-job discovery, reconnect events and the periodic retry. Disable to release all of them and stop active sync.'}, activitySignal => {
		const controller = new AbortController();
		const disabled = () => { if(activitySignal.reason === 'disabled') void cancelSyncForActivity(nativeSyncTasks).catch(() => {}); };
		activitySignal.addEventListener('abort',disabled,{once:true});
		let queued: ReturnType<typeof setTimeout> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
		const foregroundJobs = new Set<string>();
		const foregroundStarted = new Set<string>();
		const bridge = getNativeSyncAdapter();
		let running = false, pendingConditionWake = true, pendingForegroundStart = true;
		const desktop = bridge?.platform === 'macos' ? bridge.bridge : undefined;
		const kick = () => {
			if (!controller.signal.aborted && !running && queued === undefined) queued = setTimeout(resume, 0);
		};
		const resume = () => {
			queued = undefined;
			running = true;
			const wakeConditions = pendingConditionWake; pendingConditionWake = false;
			const foregroundStart = pendingForegroundStart; pendingForegroundStart = false;
			clearTimeout(timer);
			void resumeNativeSyncJobs(ownerId, generation, controller.signal, wakeConditions, foregroundStart,
				() => window.dispatchEvent(new CustomEvent(SYNC_STARTUP_STARTED_EVENT, { detail: { ownerId, generation, origin: window.location.origin } })), foregroundJobs,
				() => { pendingForegroundStart = true; pendingConditionWake = true; }, foregroundStarted).catch(() => {
				// A failed read does not revoke an already verified background lease.
				// Scope changes and disabling automation still release it below.
			}).finally(() => {
				running = false;
				if (controller.signal.aborted) return;
				const adapter = getNativeSyncAdapter();
				timer = setTimeout(kick, adapter?.platform === 'ios' && supportsNativePhotoAutomation(adapter.bridge) ? PHOTO_AUTOMATION_INTERVAL_MS : 30_000);
				if (pendingConditionWake) kick();
			});
		};
		const wake = () => {
			if (getNativeSyncAdapter()?.platform !== 'macos' && document.visibilityState === 'hidden') return;
			pendingConditionWake = true;
			kick();
		};
		const foregroundWake = () => {
			if (document.visibilityState === 'hidden') return;
			pendingForegroundStart = true; wake();
		};
		const nativeWake = (event: Event) => {
			if ((event as CustomEvent).detail?.type === 'mobile-files-conditions-changed') wake();
		};
		// Defer one task so StrictMode's discarded mount cannot own discovery.
		kick();
		let wasHidden = document.visibilityState === 'hidden';
		const visible = () => {
			if (document.visibilityState === 'visible') {
				if (wasHidden) { foregroundStarted.clear(); syncStartup.activate({ ownerId, generation, origin: window.location.origin }); }
				wasHidden = false; foregroundWake();
			} else wasHidden = true;
		};
		let taskActive = !!nativeSyncTasks.read()?.active;
		const unsubscribeTasks = nativeSyncTasks.subscribe(() => {
			const active = !!nativeSyncTasks.read()?.active;
			if (taskActive && !active && foregroundJobs.size) { pendingConditionWake = true; kick(); }
			taskActive = active;
		});
		document.addEventListener('visibilitychange', visible); window.addEventListener('pageshow', foregroundWake); window.addEventListener('focus', foregroundWake);
		window.addEventListener(SYNC_FOREGROUND_START_EVENT, foregroundWake);
		window.addEventListener('online', wake); window.addEventListener(SYNC_JOBS_CHANGED_EVENT, kick); window.addEventListener(SYNC_ENROLLMENT_WAKE_EVENT, wake); window.addEventListener(SYNC_UPLOAD_POLICY_CHANGED_EVENT, wake);
		window.addEventListener(nativeBridgeReadyEvent, foregroundWake); window.addEventListener(nativeBridgeMessageEvent, nativeWake);
		return () => {
			controller.abort(); clearTimeout(queued); clearTimeout(timer);
			unsubscribeTasks(); window.removeEventListener(SYNC_FOREGROUND_START_EVENT, foregroundWake);
			activitySignal.removeEventListener('abort',disabled);
			document.removeEventListener('visibilitychange', visible); window.removeEventListener('pageshow', foregroundWake); window.removeEventListener('focus', foregroundWake);
			window.removeEventListener('online', wake); window.removeEventListener(SYNC_JOBS_CHANGED_EVENT, kick); window.removeEventListener(SYNC_ENROLLMENT_WAKE_EVENT, wake); window.removeEventListener(SYNC_UPLOAD_POLICY_CHANGED_EVENT, wake);
			window.removeEventListener(nativeBridgeReadyEvent, foregroundWake); window.removeEventListener(nativeBridgeMessageEvent, nativeWake);
			if (desktop) void setDesktopSyncScheduled(false, desktop).catch(() => {});
		};
	}), [ownerId, generation]);
	return null;
}
