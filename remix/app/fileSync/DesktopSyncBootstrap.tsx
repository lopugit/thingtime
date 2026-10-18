import { useEffect } from 'react';
import { rootIdentity } from '../utils/rootIdentity';
import { getElectronBridge } from '../utils/electronBridge';
import { desktopSyncTasks, startDesktopSyncTask, supportsDesktopSyncTasks } from './desktopSyncTasks.client';
import { openSyncJournal } from './journal.client';
import { MAX_SYNC_JOBS_PER_ACCOUNT, SYNC_JOB_PAGE_SIZE } from './syncJobJournal';
import type { SyncScope } from './reconcile';

let discovering = false;
/** The root shell, not a Files view, discovers explicit unfinished admissions.
 * A saved Thing alone never starts work. The runner negotiates the native
 * selected origin and verifies the account/device/grant again for each job. */
export async function resumeDesktopSyncJobs(ownerId: string, generation: number, signal: AbortSignal) {
	if (discovering || !supportsDesktopSyncTasks() || desktopSyncTasks.read()?.active) return;
	discovering = true;
	let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
	const bridge = getElectronBridge();
	const scope: SyncScope = { origin: window.location.origin, ownerId, dataPlane: 'home', rootId: 'sync-job-discovery', deviceId: 'sync-job-discovery' };
	const currentScope = () => {
		signal.throwIfAborted();
		if (rootIdentity.read().pending || rootIdentity.read().generation !== generation || getElectronBridge() !== bridge)
			throw Error('Sync discovery account changed.');
		return scope;
	};
	try {
		currentScope(); journal = await openSyncJournal(); currentScope();
		const jobs = journal.jobs({ scope, currentScope, signal });
		let after: string | undefined;
		for (let page = 0; page <= MAX_SYNC_JOBS_PER_ACCOUNT / SYNC_JOB_PAGE_SIZE; page++) {
			const result = await jobs.list(after); currentScope();
			for (const job of result.jobs) {
				currentScope();
				if (desktopSyncTasks.read()?.active) return;
				if (job.state === 'runnable') await startDesktopSyncTask(job.reviewed, job.scope, generation, job);
			}
			if (!result.next) return;
			after = result.next;
		}
		throw Error('Saved sync job discovery exceeded its bound.');
	} finally { journal?.close(); discovering = false; }
}

export function DesktopSyncBootstrap({ ownerId, generation }: { ownerId: string; generation: number }) {
	useEffect(() => {
		const controller = new AbortController();
		let lastAttempt = 0;
		const resume = () => {
			if (Date.now() - lastAttempt < 10_000) return;
			lastAttempt = Date.now();
			void resumeDesktopSyncJobs(ownerId, generation, controller.signal).catch(() => {
				// A failed discovery never falls back to scanning editable Things.
				// Existing jobs stay durable for the next bounded attempt.
			});
		};
		// Defer one task so StrictMode's discarded mount cannot own discovery.
		const initial = setTimeout(resume, 0), timer = setInterval(resume, 60_000);
		window.addEventListener('online', resume);
		return () => { controller.abort(); clearTimeout(initial); clearInterval(timer); window.removeEventListener('online', resume); };
	}, [ownerId, generation]);
	return null;
}
