import React from 'react';
import { openSyncJournal } from '~/fileSync/journal.client';
import { nativeSyncTasks, pauseNativeSyncJob, startNativeSyncTask } from '~/fileSync/nativeSyncTasks.client';
import { SYNC_INTERVALS, SYNC_JOBS_CHANGED_EVENT, syncJobCanPause, syncJobEnabled, type SyncJob } from '~/fileSync/syncJobJournal';
import { syncScopeKey, type SyncScope } from '~/fileSync/reconcile';
import type { SavedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { rootIdentity } from '~/utils/rootIdentity';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { coalescedSyncRefresh } from '~/fileSync/coalescedSyncRefresh';
import { syncAutomationBlocks } from './syncAutomationBlocks';

export function DesktopSyncAutomation({ saved, scope, generation, disabled, accountTransport }: {
	saved: SavedFileSyncConfiguration; scope: SyncScope; generation: number; disabled: boolean;
	accountTransport?: SettingsDocumentHostProps['accountTransport'];
}) {
	const key = syncScopeKey(scope), [job, setJob] = React.useState<SyncJob | null>(null);
	const [pausing, setPausing] = React.useState(false);
	const [ready, setReady] = React.useState(false), [error, setError] = React.useState('');
	const [interval, setInterval] = React.useState(300_000);
	const intervalEdited = React.useRef(false);
	const activity = React.useSyncExternalStore(nativeSyncTasks.subscribe, () => {
		const value = nativeSyncTasks.read();
		return value && syncScopeKey(value.scope) === key ? value.stopping ? 'stopping' : value.active ? 'active' : value.status === 'paused' ? 'paused' : 'idle' : value?.active ? 'other-active' : 'idle';
	}, () => 'idle');
	const active = activity === 'active' || activity === 'stopping';
	const stopping = pausing || activity === 'stopping';
	const check = () => {
		if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) throw Error('The active account changed.');
		return scope;
	};
	React.useEffect(() => {
		const controller = new AbortController();
		setReady(false); setJob(null); setPausing(false); intervalEdited.current = false;
		const load = async () => {
			let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
			try {
				check(); journal = await openSyncJournal();
				const value = await journal.jobs({ scope, currentScope: check, signal: controller.signal }).read();
				if (!controller.signal.aborted) {
					setJob(value); setReady(true); if (!intervalEdited.current) setInterval(value?.intervalMs ?? 300_000);
				}
			} catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Could not read saved sync work.'); } }
			finally { journal?.close(); }
		};
		const refresh = coalescedSyncRefresh(load);
		refresh.request(); window.addEventListener(SYNC_JOBS_CHANGED_EVENT, refresh.request);
		return () => { controller.abort(); refresh.dispose(); window.removeEventListener(SYNC_JOBS_CHANGED_EVENT, refresh.request); };
		// key includes the entire scope; generation fences account transitions.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, generation]);
	const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'Automatic sync could not be updated.');
	const startDisabled = disabled || !ready || stopping || !!nativeSyncTasks.read()?.active;
	const stopDisabled = stopping || (!active && (!ready || !syncJobCanPause(job)));
	const stopLabel = stopping ? 'Pausing…' : 'Pause sync';
	const startLabel = activity === 'paused' || job?.state === 'paused' ? 'Resume automatic sync' : 'Start automatic sync';
	const status = stopping ? 'Pausing sync. No new work will start.' : activity === 'paused' || job?.state === 'paused' ? 'Sync is paused. Resume when you are ready.' : active ? 'Sync is running. You can pause it at any time.' : !ready ? 'Reading this device’s saved sync state…' : job && syncJobEnabled(job)
		? job.state === 'scheduled' ? `Automatic sync is on. Next check: ${new Date(job.nextRunAt!).toLocaleTimeString()}.` : 'Automatic sync is waiting for this device’s conditions.'
		: job?.state === 'attention' ? job.intervalMs
			? 'Automatic sync needs attention. Pause its saved job before starting with changed settings.'
			: 'An earlier transfer needs attention. Pause its saved job before starting with changed settings.'
		: 'Automatic sync is off.';
	return <SettingsDocumentHost documentKey="file-sync-automation" defaultDocument={syncAutomationBlocks} scopeKey={`${key}:${generation}`}
		title="Automatic file sync" accountTransport={accountTransport}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${key}:${generation}`} enabled={!editing}
			scope={{ automatic: { status, error, interval, startDisabled, stopDisabled, stopLabel, startLabel } }} actions={{
				interval: ({ value }) => { if (startDisabled) return; const n = Number(value); if (SYNC_INTERVALS.some(ms => ms === n)) { intervalEdited.current = true; setInterval(n); } },
				start: ({ readField }) => {
					check(); if (startDisabled) return; const n = Number(readField('interval'));
					if (!SYNC_INTERVALS.some(ms => ms === n)) throw Error('Choose a supported sync interval.');
					setError(''); void startNativeSyncTask(saved, scope, generation, undefined, n).catch(report);
				},
				stop: async () => { check(); if (stopDisabled) return; setPausing(true); setError('');
					try { await pauseNativeSyncJob(scope, generation); setJob(value => value ? { ...value, state: 'paused' } : value); }
					catch (cause) { report(cause); } finally { setPausing(false); } }
			}} onError={() => report(Error('Automatic sync action was not accepted.'))}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
