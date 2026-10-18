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

/** Explicit user-started runs outlive the connection view. This does not infer
 * execution consent from saved Things, nor schedule new runs after quitting. */
export async function startDesktopSyncTask(saved: SavedFileSyncConfiguration, scope: SyncScope, generation: number) {
	if (!supportsDesktopSyncTasks()) throw Error('Update Thingtime Desktop to continue sync outside this screen.');
	const bridge = getElectronBridge()!, reviewed = structuredClone(saved), binding = structuredClone(scope);
	if (binding.dataPlane !== 'home' || binding.rootId !== reviewed.id || binding.deviceId !== reviewed.configuration.deviceId)
		throw Error('The file sync connection changed.');
	await desktopSyncTasks.start(binding, async (signal, update) => {
		const check = () => {
			signal.throwIfAborted();
			if (rootIdentity.read().pending || rootIdentity.read().generation !== generation || getElectronBridge() !== bridge)
				throw Error('The active account changed. Reopen folder access.');
		};
		const changed = () => { if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) desktopSyncTasks.invalidate(); };
		const unsubscribe = rootIdentity.subscribe(changed);
		const leave = () => desktopSyncTasks.invalidate();
		window.addEventListener('pagehide', leave);
		let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
		let held = false;
		try {
			check();
			await bridge.setFolderSyncActive!({ active: true }); held = true; check();
			const host = await createDesktopFolderHost({ ownerId: binding.ownerId, deviceId: binding.deviceId, bridge, signal,
				rendererOrigin: () => window.location.origin, assertCurrent: check });
			if (host.origin() !== binding.origin) throw Error('The selected sync server changed.');
			await host.requireCapability('api.things', '1.36.0');
			// Views may render once with their prior props during cancellation.
			// The origin is display/binding metadata; every IO method and the
			// explicit assertCurrent still use the live, abortable host checks.
			update({ host: { ...host, origin: () => binding.origin } });
			const request = host.request, capabilities = host.capabilities;
			journal = await openSyncJournal(); check();
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
					? await approveMobileSyncTarget(reviewed, binding, signal, request, capabilities) : undefined;
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
			}, undefined, signal);
		} finally {
			journal?.close(); unsubscribe(); window.removeEventListener('pagehide', leave);
			if (held) await bridge.setFolderSyncActive!({ active: false });
		}
	});
}
