import { activityManager } from '~/activity/activityManager';
import { useEffect } from 'react';
import { nativeBridgeMessageEvent, nativeBridgeReadyEvent } from '../utils/nativeBridge';
import { PHOTO_AUTOMATION_INTERVAL_MS } from './configuration';
import { supportsNativePhotoAutomation } from './mobileFolders.client';
import { discoverAutomaticPhotos } from './photoAutomationScheduler';
import { rootIdentity } from '../utils/rootIdentity';
import { createNativeSyncHost, getNativeSyncAdapter, isNativeSyncAdapterCurrent } from './nativeSyncHost.client';
import { nativeSyncTasks, startNativeSyncTask } from './nativeSyncTasks.client';
import { cancelSyncForActivity } from './syncTaskRuntime';
import { openSyncJournal } from './journal.client';
import { MAX_SYNC_JOBS_PER_ACCOUNT, SYNC_JOB_PAGE_SIZE, SYNC_JOBS_CHANGED_EVENT, syncJobDue, syncJobEnabled, type SyncJob } from './syncJobJournal';
import { setDesktopSyncScheduled } from './desktopSyncWindow.client';
import type { SyncScope } from './reconcile';

let discoveryInFlight: Promise<void> | undefined;
/** The root shell owns discovery outside the Files view. Enabled Photos need
 * a current grant on this device. Other sources resume existing admissions. */
export async function resumeNativeSyncJobs(ownerId: string, generation: number, signal: AbortSignal, wakeConditions = false) {
	if (discoveryInFlight) {
		await discoveryInFlight.catch(() => {});
		signal.throwIfAborted();
		if (discoveryInFlight) return;
	}
	const run = discoverNativeSyncJobs(ownerId, generation, signal, wakeConditions);
	discoveryInFlight = run;
	try { await run; } finally { if (discoveryInFlight === run) discoveryInFlight = undefined; }
}

async function discoverNativeSyncJobs(ownerId: string, generation: number, signal: AbortSignal, wakeConditions: boolean) {
	const adapter = getNativeSyncAdapter();
	if (!activityManager.enabled('sync.automation') || !activityManager.enabled('sync.execution') || nativeSyncTasks.read()?.active || !adapter || (adapter.platform === 'ios' && document.visibilityState === 'hidden')) return;
	let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
	const bridge = adapter.platform === 'macos' ? adapter.bridge : undefined;
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
			for (let page = 0; page <= MAX_SYNC_JOBS_PER_ACCOUNT / SYNC_JOB_PAGE_SIZE; page++) {
				const result = await jobs.list(after); currentScope(); all.push(...result.jobs);
				if (!result.next) return all;
				after = result.next;
			}
			throw Error('Saved sync job discovery exceeded its bound.');
		};
		const discovered = await readJobs();
		const automaticPhotos = adapter.platform === 'ios' && supportsNativePhotoAutomation(adapter.bridge);
		if (automaticPhotos) await discoverAutomaticPhotos({
			ownerId, adapter, signal, assertCurrent: currentScope, jobs: discovered, wakeConditions,
			paused: nativeSyncTasks.isPaused,
			run: (saved, scope, prior) => nativeSyncTasks.read()?.active ? Promise.resolve() :
				startNativeSyncTask(saved, scope, generation, prior, PHOTO_AUTOMATION_INTERVAL_MS, { wakeConditions })
		});
		const explicitJobs = automaticPhotos ? discovered.filter(job => job.reviewed.configuration.sourceKind !== 'photos') : discovered;
		// Old admissions from another selected server/device must neither run
		// nor keep this window alive. Temporary context failure waits for retry.
		const origins = new Map<string, string | null>();
		for (const job of explicitJobs.filter(job => syncJobEnabled(job) || syncJobDue(job, Date.now()))) {
			if (origins.has(job.scope.deviceId)) continue;
			try {
				const host = await createNativeSyncHost({ ownerId, deviceId: job.scope.deviceId, adapter, signal, assertCurrent: () => { currentScope(); } });
				origins.set(job.scope.deviceId, host.origin());
			} catch { currentScope(); origins.set(job.scope.deviceId, null); }
		}
		const selected = (job: SyncJob) => origins.get(job.scope.deviceId) === job.scope.origin;
		const retained = (job: SyncJob) => !nativeSyncTasks.isPaused(job.scope) && syncJobEnabled(job) && selected(job);
		if (bridge) await setDesktopSyncScheduled(discovered.some(retained), bridge); currentScope();
		for (const job of explicitJobs) {
			currentScope();
			if (nativeSyncTasks.read()?.active) break;
			if (!nativeSyncTasks.isPaused(job.scope) && selected(job) && syncJobDue(job, Date.now())) await startNativeSyncTask(job.reviewed, job.scope, generation, job);
		}
		if (bridge) await setDesktopSyncScheduled((await readJobs()).some(retained), bridge); currentScope();
	} finally { journal?.close(); }
}

export function NativeSyncBootstrap({ ownerId, generation }: { ownerId: string; generation: number }) {
	useEffect(() => { activityManager.define({id:'sync.execution',title:'File transfer and filesystem indexing',kind:'watcher',background:true,detail:'Disable to cancel the current indexing/transfer runner and prevent manual or automatic admission. Saved data and jobs are retained.'}); }, []);
	useEffect(() => activityManager.register({id:'sync.automation',title:'Automatic file sync discovery',kind:'schedule',background:true,detail:'Owns saved-job discovery, reconnect events and the periodic retry. Disable to release all of them and stop active sync.'}, activitySignal => {
		const controller = new AbortController();
		const disabled = () => { if(activitySignal.reason === 'disabled') void cancelSyncForActivity(nativeSyncTasks).catch(() => {}); };
		activitySignal.addEventListener('abort',disabled,{once:true});
		let queued: ReturnType<typeof setTimeout> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
		let running = false, pendingConditionWake = false;
		const bridge = getNativeSyncAdapter();
		const desktop = bridge?.platform === 'macos' ? bridge.bridge : undefined;
		const kick = () => {
			if (!controller.signal.aborted && !running && queued === undefined) queued = setTimeout(resume, 0);
		};
		const resume = () => {
			queued = undefined;
			running = true;
			const wakeConditions = pendingConditionWake; pendingConditionWake = false;
			clearTimeout(timer);
			void resumeNativeSyncJobs(ownerId, generation, controller.signal, wakeConditions).catch(() => {
				if (desktop) void setDesktopSyncScheduled(false, desktop).catch(() => {});
			}).finally(() => {
				running = false;
				if (controller.signal.aborted) return;
				const adapter = getNativeSyncAdapter();
				timer = setTimeout(kick, adapter?.platform === 'ios' && supportsNativePhotoAutomation(adapter.bridge) ? PHOTO_AUTOMATION_INTERVAL_MS : 30_000);
				if (pendingConditionWake) kick();
			});
		};
		const wake = () => {
			if (document.visibilityState === 'hidden') return;
			pendingConditionWake = true;
			kick();
		};
		const nativeWake = (event: Event) => {
			if ((event as CustomEvent).detail?.type === 'mobile-files-conditions-changed') wake();
		};
		// Defer one task so StrictMode's discarded mount cannot own discovery.
		kick();
		document.addEventListener('visibilitychange', wake); window.addEventListener('pageshow', wake);
		window.addEventListener('online', wake); window.addEventListener(SYNC_JOBS_CHANGED_EVENT, kick);
		window.addEventListener(nativeBridgeReadyEvent, kick); window.addEventListener(nativeBridgeMessageEvent, nativeWake);
		return () => {
			controller.abort(); clearTimeout(queued); clearTimeout(timer);
			activitySignal.removeEventListener('abort',disabled);
			document.removeEventListener('visibilitychange', wake); window.removeEventListener('pageshow', wake);
			window.removeEventListener('online', wake); window.removeEventListener(SYNC_JOBS_CHANGED_EVENT, kick);
			window.removeEventListener(nativeBridgeReadyEvent, kick); window.removeEventListener(nativeBridgeMessageEvent, nativeWake);
			if (desktop) void setDesktopSyncScheduled(false, desktop).catch(() => {});
		};
	}), [ownerId, generation]);
	return null;
}
