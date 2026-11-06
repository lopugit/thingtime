import { activityManager } from '~/activity/activityManager';
import { useEffect } from 'react';
import { rootIdentity } from '../utils/rootIdentity';
import { createNativeSyncHost, getNativeSyncAdapter, isNativeSyncAdapterCurrent } from './nativeSyncHost.client';
import { nativeSyncTasks, startNativeSyncTask } from './nativeSyncTasks.client';
import { cancelSyncForActivity } from './syncTaskRuntime';
import { openSyncJournal } from './journal.client';
import { MAX_SYNC_JOBS_PER_ACCOUNT, SYNC_JOB_PAGE_SIZE, SYNC_JOBS_CHANGED_EVENT, syncJobDue, syncJobEnabled, type SyncJob } from './syncJobJournal';
import { setDesktopSyncScheduled } from './desktopSyncWindow.client';
import type { SyncScope } from './reconcile';

let discovering = false;
/** The root shell, not a Files view, discovers explicit unfinished admissions.
 * A saved Thing alone never starts work. The runner negotiates the native
 * selected origin and verifies the account/device/grant again for each job. */
export async function resumeNativeSyncJobs(ownerId: string, generation: number, signal: AbortSignal) {
	const adapter = getNativeSyncAdapter();
	if (!activityManager.enabled('sync.automation') || !activityManager.enabled('sync.execution') || discovering || nativeSyncTasks.read()?.active || !adapter || (adapter.platform === 'ios' && document.visibilityState === 'hidden')) return;
	discovering = true;
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
		// Old admissions from another selected server/device must neither run
		// nor keep this window alive. Temporary context failure waits for retry.
		const origins = new Map<string, string | null>();
		for (const job of discovered.filter(job => syncJobEnabled(job) || syncJobDue(job, Date.now()))) {
			if (origins.has(job.scope.deviceId)) continue;
			try {
				const host = await createNativeSyncHost({ ownerId, deviceId: job.scope.deviceId, adapter, signal, assertCurrent: () => { currentScope(); } });
				origins.set(job.scope.deviceId, host.origin());
			} catch { currentScope(); origins.set(job.scope.deviceId, null); }
		}
		const selected = (job: SyncJob) => origins.get(job.scope.deviceId) === job.scope.origin;
		const retained = (job: SyncJob) => !nativeSyncTasks.isPaused(job.scope) && syncJobEnabled(job) && selected(job);
		if (bridge) await setDesktopSyncScheduled(discovered.some(retained), bridge); currentScope();
		for (const job of discovered) {
			currentScope();
			if (nativeSyncTasks.read()?.active) break;
			if (!nativeSyncTasks.isPaused(job.scope) && selected(job) && syncJobDue(job, Date.now())) await startNativeSyncTask(job.reviewed, job.scope, generation, job);
		}
		if (bridge) await setDesktopSyncScheduled((await readJobs()).some(retained), bridge); currentScope();
	} finally { journal?.close(); discovering = false; }
}

export function NativeSyncBootstrap({ ownerId, generation }: { ownerId: string; generation: number }) {
	useEffect(() => { activityManager.define({id:'sync.execution',title:'File transfer and filesystem indexing',kind:'watcher',background:true,detail:'Disable to cancel the current indexing/transfer runner and prevent manual or automatic admission. Saved data and jobs are retained.'}); }, []);
	useEffect(() => activityManager.register({id:'sync.automation',title:'Automatic file sync discovery',kind:'schedule',background:true,detail:'Owns saved-job discovery, reconnect/online events and the 30-second fallback. Disable to release all of them and stop active sync.'}, activitySignal => {
		const controller = new AbortController();
		const disabled = () => { if(activitySignal.reason === 'disabled') void cancelSyncForActivity(nativeSyncTasks).catch(() => {}); };
		activitySignal.addEventListener('abort',disabled,{once:true});
		let queued: ReturnType<typeof setTimeout> | undefined;
		const adapter = getNativeSyncAdapter();
		const bridge = adapter?.platform === 'macos' ? adapter.bridge : undefined;
		const resume = () => {
			queued = undefined;
			void resumeNativeSyncJobs(ownerId, generation, controller.signal).catch(() => {
				// A failed discovery never falls back to scanning editable Things.
				// Existing jobs stay durable for the next bounded attempt.
				if (bridge) void setDesktopSyncScheduled(false, bridge).catch(() => {});
			});
		};
		const kick = () => { if (!controller.signal.aborted && queued === undefined) queued = setTimeout(resume, 0); };
		// Defer one task so StrictMode's discarded mount cannot own discovery.
		kick(); const timer = setInterval(kick, 30_000);
		document.addEventListener('visibilitychange', kick); window.addEventListener('pageshow', kick);
		window.addEventListener('online', kick); window.addEventListener(SYNC_JOBS_CHANGED_EVENT, kick);
		return () => {
			controller.abort(); clearTimeout(queued); clearInterval(timer);
			activitySignal.removeEventListener('abort',disabled);
			document.removeEventListener('visibilitychange', kick); window.removeEventListener('pageshow', kick);
			window.removeEventListener('online', kick); window.removeEventListener(SYNC_JOBS_CHANGED_EVENT, kick);
			if (bridge) void setDesktopSyncScheduled(false, bridge).catch(() => {});
		};
	}), [ownerId, generation]);
	return null;
}
