import { useEffect, useState } from 'react';
import { coalescedSyncRefresh } from '~/fileSync/coalescedSyncRefresh';
import type { ConfigurationEditorScope } from '~/fileSync/configurationEditor';
import type { SavedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { syncConnectionGlance } from '~/fileSync/connectionGlance';
import { formatSyncBytes } from '~/fileSync/directionalProgress';
import { readNativePhotoRunProgress } from '~/fileSync/mobileFolders.client';
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
			if ((event as CustomEvent).detail?.type === 'mobile-files-photo-progress' && document.visibilityState === 'visible' && hintTimer === undefined) {
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
	switch (progress?.stage) {
		case 'ready': return 'Backup queued';
		case 'preparing': return 'Preparing Photos backup…';
		case 'uploading': return 'Uploading originals';
		case 'waiting': return photoSyncWaitingMessage(progress.syncWait, progress.minimumPartBytes) || 'Waiting to continue backup.';
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
	return !view?.stale && !!progress && progress.continuation !== 'active' &&
		(progress.continuation === 'held' || ['ready', 'preparing', 'uploading'].includes(progress.stage)) &&
		((progress.pendingOriginals ?? 0) > 0 || (progress.currentFile?.totalBytes ?? 0) > 0);
}

const bytes = (count: number) => formatSyncBytes(String(count)).replace(/ ([A-Za-z]+)$/, '\u00a0$1');
export function nativePhotoRunGlance(view?: NativePhotoRunView) {
	const base = syncConnectionGlance({ deviceLabel: 'iPhone', mode: 'backup', online: true, active: false, paused: false });
	const progress = view?.progress;
	const confirmed = progress?.confirmed;
	const rate = view?.stale || progress?.uploadBytesPerSecond === undefined || progress.stage !== 'uploading' || progress.continuation === 'held' ? 'Upload speed unavailable' :
		`${(progress.uploadBytesPerSecond / 125_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} Mbps live`;
	if (!confirmed) return { ...base, upload: { ...base.upload, rate, progress: 'Progress unavailable' } };
	const { photos, videos, other, wifiBytes, mobileBytes, unknownBytes } = confirmed;
	const totalBytes = BigInt(wifiBytes) + BigInt(mobileBytes) + BigInt(unknownBytes);
	const file = progress.currentFile;
	return { ...base, upload: {
		...base.upload,
		rate,
		progress: file ? `Current original: ${bytes(file.sentBytes)} of ${bytes(file.totalBytes)} sent` : '',
		bytes: `${formatSyncBytes(String(totalBytes))} confirmed`,
		remaining: `Wi-Fi ${bytes(wifiBytes)} · Mobile data ${bytes(mobileBytes)}${unknownBytes ? ` · Network unknown ${bytes(unknownBytes)}` : ''}`,
		operations: `${photos.toLocaleString()} ${photos === 1 ? 'photo' : 'photos'} · ${videos.toLocaleString()} ${videos === 1 ? 'video' : 'videos'}${other ? ` · ${other.toLocaleString()} other` : ''} confirmed`
	} };
}
