import { useEffect, useState } from 'react';
import { coalescedSyncRefresh } from '~/fileSync/coalescedSyncRefresh';
import type { ConfigurationEditorScope } from '~/fileSync/configurationEditor';
import type { SavedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { syncConnectionGlance } from '~/fileSync/connectionGlance';
import { formatSyncBytes } from '~/fileSync/directionalProgress';
import { readNativePhotoRunProgress } from '~/fileSync/mobileFolders.client';
import type { NativePhotoActivityPhase, NativePhotoRunActivity } from '~/fileSync/nativePhotoRunProgress';
import { SYNC_JOBS_CHANGED_EVENT } from '~/fileSync/syncJobJournal';
import { nativeBridgeMessageEvent } from '~/utils/nativeBridge';
import { rootIdentity } from '~/utils/rootIdentity';
import { photoSyncWaitingMessage } from './photoSyncPresentation';

type NativeStatus = Awaited<ReturnType<typeof readNativePhotoRunProgress>>;
type NativeProgress = NonNullable<NativeStatus['photoRunProgress']>;
export type NativePhotoRunView = { revision: string; progress: NativeProgress | null; stale: boolean; previousRevision?: boolean };

export function useNativePhotoRunProgress(
	scope: ConfigurationEditorScope, generation: number, enabled: boolean, connections: SavedFileSyncConfiguration[],
) {
	const [observed, setObserved] = useState(() => new Map<string, NativePhotoRunView>());
	const { ownerId, origin, deviceId, dataPlane } = scope;
	useEffect(() => {
		if (!enabled || dataPlane !== 'home') return;
		const photos = connections.filter(row => row.configuration.sourceKind === 'photos');
		if (!photos.length) return;
		const lifetime = new AbortController();
		let pending: AbortController | undefined;
		let hintTimer: ReturnType<typeof setTimeout> | undefined;
		const current = () => {
			const identity = rootIdentity.read();
			return !lifetime.signal.aborted && !identity.pending && identity.generation === generation && window.location.origin === origin;
		};
		const refresh = coalescedSyncRefresh(async () => {
			if (!current() || document.visibilityState !== 'visible') return;
			const attempt = new AbortController();
			pending = attempt;
			const matches = () => current() && !attempt.signal.aborted && document.visibilityState === 'visible';
			try {
				for (const saved of photos) {
					if (!matches()) return;
					try {
						const result = await readNativePhotoRunProgress(ownerId, {
							rootId: saved.configuration.localRootId, configurationId: saved.id, deviceId
						}, attempt.signal);
						if (!matches()) return;
						const previousRevision = result.configurationRevision !== null && result.configurationRevision !== saved.updatedAt;
						const progress = previousRevision ? null : result.photoRunProgress;
						setObserved(previous => new Map(previous).set(saved.id, { revision: saved.updatedAt, progress, previousRevision, stale: false }));
					} catch {
						if (!matches()) return;
						setObserved(previous => {
							const last = previous.get(saved.id);
							return new Map(previous).set(saved.id, { revision: saved.updatedAt,
								progress: last?.revision === saved.updatedAt ? last.progress : null, stale: true });
						});
					}
				}
			} finally { if (pending === attempt) pending = undefined; }
		});
		const visible = () => {
			if (document.visibilityState === 'visible') refresh.request();
			else { clearTimeout(hintTimer); hintTimer = undefined; pending?.abort(); }
		};
		const nativeUpdate = (event: Event) => {
			const message = (event as CustomEvent).detail;
			if (message?.type !== 'mobile-files-photo-progress' || document.visibilityState !== 'visible') return;
			if (message.payload?.immediate === true) {
				clearTimeout(hintTimer);
				hintTimer = undefined;
				refresh.request();
			} else if (hintTimer === undefined) {
				hintTimer = setTimeout(() => { hintTimer = undefined; refresh.request(); }, 200);
			}
		};
		refresh.request();
		document.addEventListener('visibilitychange', visible);
		window.addEventListener('pageshow', visible);
		window.addEventListener(SYNC_JOBS_CHANGED_EVENT, refresh.request);
		window.addEventListener(nativeBridgeMessageEvent, nativeUpdate);
		return () => {
			lifetime.abort();
			clearTimeout(hintTimer);
			pending?.abort();
			refresh.dispose();
			document.removeEventListener('visibilitychange', visible);
			window.removeEventListener('pageshow', visible);
			window.removeEventListener(SYNC_JOBS_CHANGED_EVENT, refresh.request);
			window.removeEventListener(nativeBridgeMessageEvent, nativeUpdate);
		};
	}, [origin, ownerId, deviceId, dataPlane, generation, enabled, connections]);
	return observed;
}

export function nativePhotoRunActive(view?: NativePhotoRunView) {
	const stage = view?.progress?.stage;
	return view?.progress?.continuation !== 'held' && (stage === 'preparing' || stage === 'uploading');
}

export function nativePhotoRunLabel(view?: NativePhotoRunView): string {
	if (!view) return 'Checking native backup status…';
	if (view.stale) return view.progress ? 'Native backup status is unavailable. Showing last reported progress.' : 'Native backup status is unavailable.';
	if (view.previousRevision) return 'Waiting for the native queue to pick up these saved settings.';
	const progress = view.progress;
	if (progress?.continuation === 'held') return 'Background processing stopped. Resume when you’re ready.';
	if (progress?.stage === 'uploading' && progress.activity && progress.activity.phase !== 'uploading')
		return phaseLabels[progress.activity.phase];
	switch (progress?.stage) {
		case 'ready': return 'Backup queued';
		case 'preparing': return 'Preparing Photos backup…';
		case 'uploading': return 'Uploading originals';
		case 'waiting': return photoSyncWaitingMessage(progress.syncWait, progress.minimumPartBytes) ||
			(progress.activity?.reason === 'interrupted' ? 'Backup interrupted. Automatic retry pending.' : 'Waiting to continue backup.');
		case 'complete': return 'Last transfer finished.';
		case 'paused': return 'Paused';
		case 'needs-review': return 'Photos backup needs attention.';
		default: return 'No active transfer';
	}
}

export function nativePhotoRunSchedule(view?: NativePhotoRunView) {
	const progress = view?.progress;
	if (view?.stale || progress?.stage !== 'waiting' || !progress.retryAt || progress.minimumPartBytes !== undefined) return '';
	const date = new Date(progress.retryAt);
	if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return '';
	const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
	return progress.syncWait === 'data-budget' ? `Uploads can resume after ${time}.` : `Next automatic check at ${time}.`;
}

export function nativePhotoCanContinue(view?: NativePhotoRunView) {
	const progress = view?.progress;
	if (view?.stale || view?.previousRevision || !progress || progress.continuation === 'active') return false;
	const preparing = progress.continuation !== 'held' && (progress.stage === 'preparing' ||
		(progress.stage === 'ready' && !!progress.activity && preparationPhases.has(progress.activity.phase)));
	return preparing || (
		(progress.continuation === 'held' || ['ready', 'preparing', 'uploading'].includes(progress.stage)) &&
		((progress.pendingOriginals ?? 0) > 0 || (progress.currentFile?.totalBytes ?? 0) > 0));
}

const preparationPhases = new Set<NativePhotoActivityPhase>(['verifying', 'indexing', 'checking-originals', 'downloading', 'checking-cloud']);
const phaseLabels: Record<NativePhotoActivityPhase, string> = {
	verifying: 'Verifying backup settings',
	indexing: 'Indexing the Photos library',
	'checking-originals': 'Checking originals on this iPhone',
	downloading: 'Downloading an original from iCloud',
	'checking-cloud': 'Checking the cloud destination',
	uploading: 'Uploading originals',
	publishing: 'Publishing originals to the cloud folder',
	waiting: 'Waiting to continue',
	complete: 'Backup check finished'
};
const reasonLabels: Record<NonNullable<NativePhotoRunActivity['reason']>, string> = {
	interrupted: 'The backup will retry automatically when iOS and your saved settings allow it.',
	'library-changed': 'The Photos library changed. Its index needs another check.',
	'photo-access': 'Review Thingtime’s access to the Photos library on this iPhone.',
	'device-storage': 'This iPhone needs more free space to prepare an original.',
	'photo-read': 'An original could not be read from the Photos library.',
	'cloud-request': 'The cloud request could not finish.',
	'saved-settings': 'Waiting for the current saved backup settings.',
	'transfer-permission': 'The paired device could not authorize the cloud transfer. The current connection will be checked again.',
	'transfer-expired': 'Cloud transfer authorization expired or was revoked. The current connection will be checked again.',
	'transfer-missing': 'The exact cloud transfer authorization is no longer available. The current connection will be checked again.',
	'transfer-state': 'The cloud transfer state changed. Its saved checkpoint was kept and the current connection will be checked again.',
	'grant-changed': 'The selected Photos permission changed. Review access to this library.',
	'queue-changed': 'The prepared Photos queue changed. Its saved checkpoint was kept for review.',
	'destination-review': 'Review the backup’s cloud destination.',
	retry: 'Waiting to retry the backup.'
};

export function nativePhotoBackgroundLabel(status?: NativePhotoRunActivity['backgroundRequest'], reason?: NativePhotoRunActivity['reason']) {
	switch (status) {
		case 'active': return 'Background processing requested for this backup.';
		case 'declined': return 'iOS didn’t start continued processing. Automatic backup will retry when iOS allows.';
		case 'waiting': return reason === 'interrupted' ? 'iOS ended this background session. Automatic backup will retry.' :
			'This backup is waiting for its saved transfer conditions.';
		case 'complete': return 'This backup check has finished.';
		default: return '';
	}
}

const failureOperationLabels: Record<NonNullable<NativePhotoRunActivity['failureOperation']>, string> = {
    manifest: 'Checking server support', 'check-photo-run': 'Checking backup permission',
    'reserve-photo-original': 'Reserving an original', parts: 'Preparing an upload part',
    complete: 'Verifying uploaded bytes', publish: 'Saving the cloud file', revoke: 'Stopping an upload',
    'revoke-photo-run': 'Stopping backup authorization', 'local-grant': 'Checking Photos access', queue: 'Checking the prepared queue'
};

const count = (value: number, singular: string, plural = singular + 's') =>
	`${value.toLocaleString()} ${value === 1 ? singular : plural}`;
const eventTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const captureTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
const discoveryLabel = (item: NonNullable<NativePhotoRunActivity['latestFound']>, index?: number) =>
	`Found ${index === undefined ? 'a ' + item.kind : index === 1 ? '1 ' + item.kind : item.kind + ' ' + index.toLocaleString()}${item.capturedAt ? ` taken at ${captureTime.format(new Date(item.capturedAt))}` : ''}`;

export function nativePhotoActivityDisplay(view?: NativePhotoRunView, paused = false, reserve = false) {
	const activity = view?.progress?.activity;
	if (!view?.progress || !activity || view.previousRevision) return reserve ? {
		phase: paused ? 'Paused' : nativePhotoRunLabel(view), reason: 'No additional details reported.', indexed: 'Not reported yet', indexing: 'Index progress not reported yet',
		latestFound: 'Latest discovery not reported yet', prepared: 'Not reported yet', backlog: 'Not reported yet',
		downloadLabel: 'iCloud download progress not reported', downloadPercent: undefined, events: []
	} : undefined;
	const { continuation } = view.progress;
	const phase = paused ? 'Paused' : continuation === 'held' ? 'Background processing stopped' : phaseLabels[activity.phase];
	const { indexed, indexing, latestFound, prepared, backlogOriginals: backlog } = activity;
	const fraction = !paused && !view.stale && continuation !== 'held' ? activity.downloadFraction ?? activity.cloudPreparationFraction : undefined;
	return {
		phase: view.stale ? `Last reported · ${phase}` : phase,
		reason: (activity.reason ? reasonLabels[activity.reason] : 'No additional details reported.') +
			(activity.failureOperation ? ` ${failureOperationLabels[activity.failureOperation]}.` : ''),
		indexed: indexed ? `${count(indexed.photos, 'photo')} · ${count(indexed.videos, 'video')} · ${count(indexed.files, 'file')}` : 'Not reported yet',
		indexing: !paused && !view.stale && activity.phase === 'indexing' && indexing ?
			`${indexing.completed.toLocaleString()} of ${indexing.total.toLocaleString()} ${indexing.unit === 'assets' ? 'assets found' : 'original records indexed'}` : 'Index progress not reported for this phase',
		latestFound: !paused && !view.stale && activity.phase === 'indexing' && latestFound ?
			discoveryLabel(latestFound, indexed?.[latestFound.kind === 'photo' ? 'photos' : 'videos']) : 'Latest discovery not reported for this phase',
		prepared: prepared ? `${prepared.completed.toLocaleString()} of ${prepared.total.toLocaleString()}` : 'Not reported yet',
		backlog: backlog === undefined ? 'Not reported yet' : count(backlog, 'original'),
		downloadPercent: fraction === undefined ? undefined : Math.floor(fraction * 100),
		downloadLabel: fraction === undefined ? 'iCloud download progress not reported' : `Current iCloud download · ${Math.floor(fraction * 100)}%`,
		events: activity.events?.map(({ phase, at, item, discovered }, index) => ({
			id: `${at}:${phase}:${index}`, label: item && discovered ? `${discoveryLabel(item)} · item ${discovered.toLocaleString()}` : phaseLabels[phase],
			at, time: eventTime.format(new Date(at))
		})) ?? []
	};
}

const bytes = (count: number) => formatSyncBytes(String(count)).replace(/ ([A-Za-z]+)$/, '\u00a0$1');
export function nativePhotoRunGlance(view?: NativePhotoRunView) {
	const base = syncConnectionGlance({ deviceLabel: 'iPhone', mode: 'backup', online: true, active: false, paused: false });
	const progress = view?.progress;
	const confirmed = progress?.confirmed;
	const uploading = progress?.stage === 'uploading' && (!progress.activity || progress.activity.phase === 'uploading');
	const rate = view?.stale || progress?.uploadBytesPerSecond === undefined || !uploading || progress.continuation === 'held' ? 'Upload speed unavailable' :
		`${(progress.uploadBytesPerSecond / 125_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} Mbps live`;
	if (!confirmed) return { ...base, upload: { ...base.upload, rate, progress: 'Progress unavailable',
		bytes: 'Transfer traffic not reported', remaining: 'Network totals not reported', operations: 'Confirmed counts not reported' } };
	const { photos, videos, other, wifiBytes, mobileBytes, unknownBytes } = confirmed;
	const totalBytes = BigInt(wifiBytes) + BigInt(mobileBytes) + BigInt(unknownBytes);
	const file = !progress.activity || uploading ? progress.currentFile : undefined;
	return { ...base, upload: {
		...base.upload,
		rate,
		progress: file ? `Current original: ${bytes(file.sentBytes)} of ${bytes(file.totalBytes)} sent` : 'Current original not reported',
		bytes: `${formatSyncBytes(String(totalBytes))} transfer traffic`,
		remaining: `Wi-Fi ${bytes(wifiBytes)} · Mobile data ${bytes(mobileBytes)}${unknownBytes ? ` · Network unknown ${bytes(unknownBytes)}` : ''}`,
		operations: `${photos.toLocaleString()} ${photos === 1 ? 'photo' : 'photos'} · ${videos.toLocaleString()} ${videos === 1 ? 'video' : 'videos'}${other ? ` · ${other.toLocaleString()} other` : ''} confirmed`
	} };
}
