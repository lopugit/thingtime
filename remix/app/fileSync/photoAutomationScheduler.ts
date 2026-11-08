import { requestMobileDevice } from '../components/Devices/mobileDeviceBridge';
import { readStampedCache } from '../hooks/localCache';
import { FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS } from './configuration';
import { readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from './configuredPlan';
import { LEGACY_NATIVE_INACTIVE_MESSAGE } from './foregroundSyncContext';
import { createNativeSyncHost, type NativeSyncAdapter } from './nativeSyncHost.client';
import { photoSettingsChanged, samePhotoBackupSource } from './photoSettingsPolicy';
import { syncScopeKey, type SyncScope } from './reconcile';
import { syncJobDue, type SyncJob } from './syncJobJournal';

export function shouldRunAutomaticPhoto(saved: SavedFileSyncConfiguration, job: SyncJob | undefined, now: number, wakeConditions: boolean, legacyInactive = false) {
	if (!samePhotoBackupSource(saved.configuration, saved.configuration)) return false;
	if (!job) return true;
	if (job.state === 'paused' || !samePhotoBackupSource(job.reviewed.configuration, saved.configuration) ||
		job.automaticPhotoRevision === saved.updatedAt) return false;
	const changed = photoSettingsChanged(job.reviewed, saved);
	if (changed && job.waitReason === 'data-budget') return true;
	if (job.retryAt !== undefined && now < job.retryAt &&
		!(wakeConditions && job.waitReason && !['paused', 'data-budget'].includes(job.waitReason))) return false;
	return changed || job.state === 'complete' ||
		(job.state === 'attention' && (job.failureReason === undefined || job.failureReason === 'unknown') && legacyInactive) || syncJobDue(job, now, wakeConditions);
}

export async function discoverAutomaticPhotos(input: {
	ownerId: string; adapter: NativeSyncAdapter; signal: AbortSignal; assertCurrent(): void;
	jobs: SyncJob[]; wakeConditions: boolean;
	run(saved: SavedFileSyncConfiguration, scope: SyncScope, prior: SyncJob | undefined): Promise<void>;
	paused(scope: SyncScope): boolean;
}) {
	const { ownerId, signal, assertCurrent } = input;
	const status = await requestMobileDevice(ownerId, 'status', signal); assertCurrent();
	if (status.state !== 'paired' || !status.deviceId) return;
	const deviceId = status.deviceId;
	const host = await createNativeSyncHost({ ownerId, deviceId, adapter: input.adapter, signal, assertCurrent });
	const origin = host.origin();
	for (const [feature, minimum] of Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS)) await host.requireCapability(feature, minimum);
	const { roots } = await host.request(ownerId, { action: 'list' }, signal); assertCurrent();
	const grants = new Set(roots.filter(root => root.sourceKind === 'photos' && (root.photoAccess === 'full' || root.photoAccess === 'limited')).map(root => root.id));
	if (!grants.size) return;
	const byScope = new Map(input.jobs.map(job => [job.key, job]));
	let cursor: string | undefined;
	const seenCursors = new Set<string>();
	do {
		const url = new URL('/api/v1/things', origin);
		url.search = new URLSearchParams({ thingtime: 'file-sync', limit: '50', ...(cursor ? { cursor } : {}) }).toString();
		const response = await host.fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal,
			headers: { 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
		assertCurrent();
		if (!response.ok) throw Error('Automatic Photos backup could not verify saved connections.');
		const value = await response.json(); assertCurrent();
		if (!Array.isArray(value.things)) throw Error('Invalid saved sync connections.');
		for (const row of value.things) {
			let saved: SavedFileSyncConfiguration;
			try { saved = readOwnedFileSyncConfiguration(row, ownerId); } catch { continue; }
			const c = saved.configuration;
			if (c.deviceId !== deviceId || !grants.has(c.localRootId)) continue;
			const scope: SyncScope = { origin, ownerId, dataPlane: 'home', rootId: saved.id, deviceId };
			const key = syncScopeKey(scope), prior = byScope.get(key);
			const legacyInactive = prior?.state === 'attention' &&
				readStampedCache<{ message?: string }>('tt:sync-progress:' + key)?.message === LEGACY_NATIVE_INACTIVE_MESSAGE;
			if (input.paused(scope) || !shouldRunAutomaticPhoto(saved, prior, Date.now(), input.wakeConditions, legacyInactive)) continue;
			await input.run(saved, scope, prior); assertCurrent();
		}
		const next = value.nextCursor;
		if (next != null && (typeof next !== 'string' || !next || seenCursors.has(next))) throw Error('Invalid saved sync connection cursor.');
		cursor = next ?? undefined;
		if (cursor) seenCursors.add(cursor);
	} while (cursor);
}
