import { useEffect, useState } from 'react';
import { coalescedSyncRefresh } from '~/fileSync/coalescedSyncRefresh';
import type { ConfigurationEditorScope } from '~/fileSync/configurationEditor';
import { openSyncJournal } from '~/fileSync/journal.client';
import { MAX_SYNC_JOBS_PER_ACCOUNT, SYNC_JOB_PAGE_SIZE, SYNC_JOBS_CHANGED_EVENT, type SyncJob } from '~/fileSync/syncJobJournal';
import { rootIdentity } from '~/utils/rootIdentity';

export function usePhotoSyncJobs(scope: ConfigurationEditorScope, generation: number, enabled: boolean) {
	const [jobs, setJobs] = useState<Record<string, SyncJob>>(() => Object.create(null));
	const { origin, ownerId, deviceId, dataPlane } = scope;
	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		const bound = { origin, ownerId, deviceId, dataPlane, rootId: 'photo-sync-status' };
		const check = () => {
			controller.signal.throwIfAborted();
			const identity = rootIdentity.read();
			if (identity.pending || identity.generation !== generation || window.location.origin !== origin)
				throw Error('The active Photos connection changed.');
			return bound;
		};
		const refresh = coalescedSyncRefresh(async () => {
			let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
			try {
				check();
				journal = await openSyncJournal();
				const reader = journal.jobs({ scope: bound, currentScope: check, signal: controller.signal });
				const result: Record<string, SyncJob> = Object.create(null);
				let cursor: string | undefined;
				for (let page = 0; page <= MAX_SYNC_JOBS_PER_ACCOUNT / SYNC_JOB_PAGE_SIZE; page++) {
					const current = await reader.list(cursor);
					check();
					for (const job of current.jobs) if (job.scope.origin === origin && job.scope.deviceId === deviceId &&
						job.scope.dataPlane === dataPlane && job.reviewed.configuration.sourceKind === 'photos') result[job.scope.rootId] = job;
					if (!current.next) { setJobs(result); return; }
					cursor = current.next;
				}
			} catch { /* Keep same-scope status during a journal refresh failure. */ }
			finally { journal?.close(); }
		});
		refresh.request();
		window.addEventListener(SYNC_JOBS_CHANGED_EVENT, refresh.request);
		return () => {
			controller.abort();
			refresh.dispose();
			window.removeEventListener(SYNC_JOBS_CHANGED_EVENT, refresh.request);
		};
	}, [origin, ownerId, deviceId, dataPlane, generation, enabled]);
	return jobs;
}

export function photoSyncWaitingMessage(reason: SyncJob['waitReason'], minimumPartBytes?: number) {
	switch (reason) {
		case 'inactive': return 'Waiting for Thingtime to become active. Backup resumes automatically.';
		case 'data-budget': return minimumPartBytes === undefined ? 'Hourly upload budget reached.' :
			`One upload part needs at least ${minimumPartBytes.toLocaleString()} bytes. Raise the hourly budget in Edit → Resource limits.`;
		case 'wifi': return 'Waiting for Wi-Fi. Connect to Wi-Fi to continue. To allow mobile data, open Edit → Transfer options → Network.';
		case 'network': return 'Waiting for the selected network.';
		case 'offline': return 'Waiting for this device to reconnect.';
		case 'charging': return 'Waiting for this device to charge.';
		default: return '';
	}
}

export function photoSyncScheduleLabel(job: SyncJob | undefined, paused: boolean, running: boolean, failed: boolean) {
	if (paused || running) return '';
	if (failed) return 'Automatic backup needs attention.';
	if (job?.minimumPartBytes !== undefined) return '';
	const eligible = job?.retryAt ?? job?.nextRunAt;
	const date = eligible === undefined ? undefined : new Date(eligible);
	if (date && Number.isFinite(date.getTime()) && date.getTime() > Date.now()) {
		const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
		return job?.waitReason === 'data-budget' ? `Uploads can resume after ${time}.` : `Next automatic check at ${time}.`;
	}
	return 'Automatic backup is on.';
}
