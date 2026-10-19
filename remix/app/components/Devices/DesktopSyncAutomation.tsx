import React from 'react';
import { openSyncJournal } from '~/fileSync/journal.client';
import { nativeSyncTasks, pauseNativeSyncJob, startNativeSyncTask } from '~/fileSync/nativeSyncTasks.client';
import { SYNC_INTERVALS, SYNC_JOBS_CHANGED_EVENT, syncJobEnabled, type SyncJob } from '~/fileSync/syncJobJournal';
import { syncScopeKey, type SyncScope } from '~/fileSync/reconcile';
import type { SavedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { rootIdentity } from '~/utils/rootIdentity';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { syncAutomationBlocks } from './syncAutomationBlocks';

export function DesktopSyncAutomation({ saved, scope, generation, disabled, accountTransport }: {
	saved: SavedFileSyncConfiguration; scope: SyncScope; generation: number; disabled: boolean;
	accountTransport?: SettingsDocumentHostProps['accountTransport'];
}) {
	const key = syncScopeKey(scope), [job, setJob] = React.useState<SyncJob | null>(null);
	const [ready, setReady] = React.useState(false), [error, setError] = React.useState('');
	const [interval, setInterval] = React.useState(300_000);
	const intervalEdited = React.useRef(false);
	const task = React.useSyncExternalStore(nativeSyncTasks.subscribe, nativeSyncTasks.read, nativeSyncTasks.read);
	const active = !!task?.active && syncScopeKey(task.scope) === key;
	const check = () => {
		if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) throw Error('The active account changed.');
		return scope;
	};
	React.useEffect(() => {
		const controller = new AbortController(); let revision = 0;
		const load = async () => {
			const request = ++revision; let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
			try {
				check(); journal = await openSyncJournal();
				const value = await journal.jobs({ scope, currentScope: check, signal: controller.signal }).read();
				if (!controller.signal.aborted && request === revision) {
					setJob(value); setReady(true); if (!intervalEdited.current) setInterval(value?.intervalMs ?? 300_000);
				}
			} catch (cause) { if (!controller.signal.aborted && request === revision) { setReady(false); setError(cause instanceof Error ? cause.message : 'Could not read saved sync work.'); } }
			finally { journal?.close(); }
		};
		void load(); window.addEventListener(SYNC_JOBS_CHANGED_EVENT, load);
		return () => { controller.abort(); window.removeEventListener(SYNC_JOBS_CHANGED_EVENT, load); };
		// key includes the entire scope; generation fences account transitions.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, generation]);
	const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Automatic sync could not be updated.');
	const startDisabled = disabled || !ready || !!task?.active;
	const stopDisabled = !ready || (!active && (!job?.intervalMs || !['runnable', 'scheduled', 'attention'].includes(job.state)));
	const status = !ready ? 'Reading this device’s saved sync state…' : active ? 'Checking this connection.' : job && syncJobEnabled(job)
		? job.state === 'scheduled' ? `Automatic sync is on. Next check: ${new Date(job.nextRunAt!).toLocaleTimeString()}.` : 'Automatic sync is waiting for this device’s conditions.'
		: job?.intervalMs && job.state === 'attention' ? 'Automatic sync needs attention. Review the connection and start it again.' : 'Automatic sync is off.';
	return <SettingsDocumentHost documentKey="file-sync-automation" defaultDocument={syncAutomationBlocks} scopeKey={`${key}:${generation}`}
		title="Automatic file sync" accountTransport={accountTransport}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${key}:${generation}`} enabled={!editing}
			scope={{ automatic: { status, error, interval, startDisabled, stopDisabled } }} actions={{
				interval: ({ value }) => { if (startDisabled) return; const n = Number(value); if (SYNC_INTERVALS.some(ms => ms === n)) { intervalEdited.current = true; setInterval(n); } },
				start: ({ readField }) => {
					check(); if (startDisabled) return; const n = Number(readField('interval'));
					if (!SYNC_INTERVALS.some(ms => ms === n)) throw Error('Choose a supported sync interval.');
					setError(''); void startNativeSyncTask(saved, scope, generation, undefined, n).catch(report);
				},
				stop: () => { check(); if (stopDisabled) return; setError(''); return pauseNativeSyncJob(scope, generation).catch(report); }
			}} onError={() => report(Error('Automatic sync action was not accepted.'))}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
