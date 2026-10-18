import { SyncConditionsWait } from './foregroundSyncContext';
import { pauseSyncJobAdmission, type SyncJob } from './syncJobJournal';
import { holdDesktopSyncWindow, setDesktopSyncScheduled } from './desktopSyncWindow.client';
import { createDesktopFolderHost } from './desktopFolders.client';
import { getElectronBridge } from '../utils/electronBridge';
import { rootIdentity } from '../utils/rootIdentity';
import { createSyncTaskRuntime } from './syncTaskRuntime';
import { openSyncJournal, withSyncRootLock, syncScopeKey } from './journal.client';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { readNativeInventory } from './nativeInventory';
import { readCloudFolderInventoryPages } from './cloudInventoryPages.client';
import { readCloudFolderInventory } from './cloudInventory.client';
import { mobileFolderSource, supportsNativeInventoryPages, supportsNativePathInspection } from './mobileFolders.client';
import { approveMobileSyncTarget } from './mobileSyncTarget.client';
import { assertPhotoSourcePolicy } from './photoSourcePolicy';
import { createConflictReviewController } from './conflictReviewController';
import type { PagedConflictReviewResult } from './pagedForegroundReview';
import type { SyncConflictReviewResult } from './conflictResolution';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import type { SyncScope } from './reconcile';
import { writeStampedCache, pruneCacheNamespace } from '../hooks/localCache';
import { TIMELINE_CHANGED_EVENT } from '../timeline/clientEvents';

export const desktopSyncTasks = createSyncTaskRuntime();
export function supportsDesktopSyncTasks() {
	const bridge = getElectronBridge();
	return bridge?.platform === 'darwin' && bridge.folderSyncTaskVersion === '1.0.0' && !!bridge.setFolderSyncActive && !!bridge.folderSyncRequest;
}

/** Explicit runs persist admission separately from editable connection Things.
 * Relaunch resumes only that admitted job, using existing native consent. */
export async function startDesktopSyncTask(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number, resume?: SyncJob, intervalMs?: number) {
	if (!supportsDesktopSyncTasks()) throw Error('Update Thingtime Desktop to continue sync outside this screen.');
	const bridge = getElectronBridge()!, reviewed = structuredClone(saved), binding = structuredClone(scope);
	if (binding.dataPlane !== 'home' || binding.rootId !== reviewed.id || binding.deviceId !== reviewed.configuration.deviceId)
		throw Error('The file sync connection changed.');
	let stopRequested = false, saveStop: (() => Promise<void>) | undefined;
	await desktopSyncTasks.start(binding, async (signal, update) => {
		const checkIdentity = () => {
			if (rootIdentity.read().pending || rootIdentity.read().generation !== generation || getElectronBridge() !== bridge)
				throw Error('The active account changed. Reopen folder access.');
		};
		const check = () => { signal.throwIfAborted(); checkIdentity(); };
		const changed = () => { if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) desktopSyncTasks.invalidate(); };
		const unsubscribe = rootIdentity.subscribe(changed);
		const leave = () => desktopSyncTasks.invalidate();
		window.addEventListener('pagehide', leave);
		let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
		let releaseWindow: (() => Promise<void>) | undefined, job: SyncJob | null = null;
		let jobs: ReturnType<Awaited<ReturnType<typeof openSyncJournal>>['jobs']> | undefined;
		try {
			check();
			journal = await openSyncJournal(); check();
			jobs = journal.jobs({ scope: binding, currentScope: () => { checkIdentity(); return binding; } });
			saveStop = async () => { const stopping = job ?? resume; if (stopping) await pauseSyncJobAdmission(jobs!, stopping.id); };
			releaseWindow = await holdDesktopSyncWindow(bridge); check();
			const host = await createDesktopFolderHost({ ownerId: binding.ownerId, deviceId: binding.deviceId, bridge, signal,
				rendererOrigin: () => window.location.origin, assertCurrent: check });
			if (host.origin() !== binding.origin) throw Error('The selected sync server changed.');
			await host.requireCapability('api.things', '1.36.0');
			// Views may render once with their prior props during cancellation.
			// The origin is display/binding metadata; every IO method and the
			// explicit assertCurrent still use the live, abortable host checks.
			update({ host: { ...host, origin: () => binding.origin } });
			const request = host.request, capabilities = host.capabilities;
			const currentScope = () => { check(); host.assertCurrent(); return binding; };
			const runtime = { currentScope, origin: host.origin, fetch: host.fetch, requireCapability: host.requireCapability };
			const publish = (progress: Parameters<typeof update>[0]['progress']) => {
				check(); if (!progress) return; update({ progress });
				const key = 'tt:sync-progress:' + syncScopeKey(binding);
				writeStampedCache(key, progress); pruneCacheNamespace('tt:sync-progress:', key, 32);
				if (progress.stage === 'retained') window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
			};
			await withSyncRootLock(binding, async () => {
				const roots = (await request(binding.ownerId, { action: 'list' }, signal)).roots;
				assertPhotoSourcePolicy(reviewed.configuration, roots); check();
				const inspect = supportsNativePathInspection(capabilities) && roots.some(root => root.id === reviewed.configuration.localRootId && root.sourceKind !== 'photos');
				const localTarget = ['download', 'two-way'].includes(reviewed.configuration.mode)
					? await approveMobileSyncTarget(reviewed, binding, signal, request, capabilities, resume ? 'existing' : 'request') : undefined;
				job = resume ? await jobs!.begin(resume, Date.now(), crypto.randomUUID()) : await jobs!.admit(reviewed, crypto.randomUUID(), intervalMs);
				if (!job) return; // A stopped/completed/replaced discovery is never replayed.
				if (stopRequested) await jobs!.transition(job, 'paused');
				check();
				await runPagedForegroundCloudSync(reviewed, binding, {
					currentScope, localTarget, journal: journal!, runtime, progress: publish,
					readConfiguration: async () => {
						const url = new URL('/api/v1/things', binding.origin); url.searchParams.set('id', reviewed.id);
						const response = await host.fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal,
							headers: { 'X-Thingtime-Expected-Actor': binding.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
						if (!response.ok) throw Error('The saved sync connection could not be verified.');
						const value = await response.json(); check(); return value.thing;
					},
					authorizeDevice: async () => {
						await host.authorizeDevice(binding.ownerId, binding.deviceId, signal);
						assertPhotoSourcePolicy(reviewed.configuration, (await request(binding.ownerId, { action: 'list' }, signal)).roots); check();
					},
					conditions: async () => (await request(binding.ownerId, { action: 'conditions' }, signal)).conditions!,
					scanLocal: async () => (await request(binding.ownerId, { action: 'scan', rootId: reviewed.configuration.localRootId }, signal)).entries!,
					...(inspect && supportsNativeInventoryPages(capabilities) ? {
						scanLocalPages: () => readNativeInventory({ ownerId: binding.ownerId, deviceId: binding.deviceId,
							rootId: reviewed.configuration.localRootId, signal, request })
					} : {}),
					...(inspect ? { inspectLocal: async (path: string) => (await request(binding.ownerId,
						{ action: 'inspect', rootId: reviewed.configuration.localRootId, path }, signal)).inspectedEntry! } : {}),
					inventory: () => readCloudFolderInventory(binding, reviewed.configuration.remoteFolderId, { ...runtime, signal }),
					inventoryPages: () => readCloudFolderInventoryPages(binding, reviewed.configuration.remoteFolderId, { ...runtime, signal }),
					source: async entry => mobileFolderSource(binding.ownerId, reviewed.configuration.localRootId, entry, signal, request, capabilities),
					reviewPagedConflicts: session => new Promise<PagedConflictReviewResult>((resolve, reject) => {
						let settled = false;
						const finish = (value?: PagedConflictReviewResult) => {
							if (settled) return; settled = true; signal.removeEventListener('abort', abort);
							if (!signal.aborted) update({ pagedReview: undefined });
							if (signal.aborted) reject(signal.reason);
							else if (value) resolve(value); else reject(Error('Conflict review interrupted. Saved choices can be resumed.'));
						};
						const controller = createConflictReviewController(session, finish);
						const abort = () => { controller.dispose(); finish(); };
						signal.addEventListener('abort', abort, { once: true });
						if (signal.aborted) { abort(); return; }
						update({ pagedReview: controller }); void controller.reload().catch(() => {});
					}),
					reviewConflicts: conflicts => new Promise<SyncConflictReviewResult>((resolve, reject) => {
						let settled = false;
						const finish = (value?: SyncConflictReviewResult) => {
							if (settled) return; settled = true; signal.removeEventListener('abort', abort);
							if (!signal.aborted) update({ legacyReview: undefined });
							if (signal.aborted) reject(signal.reason);
							else if (value) resolve(value); else reject(Error('Conflict review cancelled. Both folders were preserved.'));
						};
						const abort = () => finish(); signal.addEventListener('abort', abort, { once: true });
						if (signal.aborted) { abort(); return; }
						update({ legacyReview: { conflicts, apply: finish, retain: () => finish({ action: 'retain' }), cancel: () => finish() } });
					})
				}, signal);
				check(); const finished = await jobs!.finish(job, Date.now()); check();
				if (finished?.state === 'scheduled') await setDesktopSyncScheduled(true, bridge);
			}, undefined, signal);
		} catch (error) {
			const failed = job ?? (resume?.intervalMs !== undefined ? resume : null);
			if (failed && jobs && !signal.aborted && !(error instanceof SyncConditionsWait)) await jobs.attention(failed);
			throw error;
		} finally {
			journal?.close(); unsubscribe(); window.removeEventListener('pagehide', leave);
			await releaseWindow?.();
		}
	}, async () => {
		stopRequested = true;
		try { await saveStop?.(); } catch { throw Error('Transfer stopped, but its pause could not be saved. It may resume when Thingtime reopens.'); }
	});
}

/** Stop works while the scheduler is idle as well as during a transfer. CAS
 * fences a concurrent discovery, and cancellation only targets this root. */
export async function pauseDesktopSyncJob(scope: SyncScope, generation: number) {
	const check = () => {
		if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) throw Error('The active account changed.');
		return scope;
	};
	check(); const journal = await openSyncJournal();
	try {
		const jobs = journal.jobs({ scope, currentScope: check });
		for (let attempt = 0; attempt < 3; attempt++) {
			await desktopSyncTasks.cancel(scope); check();
			const job = await jobs.read();
			if (!job || ['paused', 'complete'].includes(job.state) || await jobs.pause(job)) {
				await desktopSyncTasks.cancel(scope); return;
			}
		}
		throw Error('The sync job changed while stopping. Please retry.');
	} finally { journal.close(); }
}
