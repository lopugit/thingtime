import { syncFolderActivityLabel } from './syncFolderCardBlocks';
import type { TransferSpeedDraftState } from './TransferSpeedTrackers';
import { SyncEditorPlacement } from './SyncEditorPlacement';
import type { UploadPriorityDraftState } from './SyncUploadPriorities';
import { supportsNativeSourcePaths, validNativeSourcePath } from '~/fileSync/mobileFolders.client';
import { prepareSyncCloudDestination } from '~/fileSync/cloudDestination';
import { fileSyncDownloadRequirements } from '~/fileSync/signedDownloadTarget';
import { SyncResourceControls } from './SyncResourceControls';
import { SyncIgnoreRulesEditor } from './SyncIgnoreRulesEditor';
import { readNativeInventory } from '~/fileSync/nativeInventory';
import { nativeSyncTasks, pauseNativeSyncJob, startNativeSyncTask, supportsNativeSyncTasks } from '~/fileSync/nativeSyncTasks.client';
import { nativeUploadMayContinue } from '~/fileSync/nativeUploadBackground';
import { assertPhotoSourcePolicy, photoAccessDescription } from '~/fileSync/photoSourcePolicy';
import { NativeFileRecovery } from './NativeFileRecovery';
import { TIMELINE_CHANGED_EVENT } from '~/timeline/clientEvents';
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { SyncConflictReview } from './SyncConflictReview';
import { SyncDetailsSection } from './SyncDetailsSection';
import { SettingsSection } from '../Settings/SettingsSection';
import { SyncFolderCard } from './SyncFolderCard';
import { PagedSyncConflictReview } from './PagedSyncConflictReview';
import { DesktopSyncAutomation } from './DesktopSyncAutomation';
import { SyncProgressViewer } from './SyncProgressViewer';
import { BackupCoverageViewer } from './BackupCoverageViewer';
import type { SyncInventoryDescriptor } from '~/fileSync/foregroundSync';
import type { SyncProgressDescriptor } from '~/fileSync/progressProjection';
import { createTransferActivitySession } from '~/fileSync/transferActivity';
import { createConflictReviewController } from '~/fileSync/conflictReviewController';
import type { PagedConflictReviewResult, PagedConflictReviewSession } from '~/fileSync/pagedForegroundReview';
import type { SyncConflict, SyncConflictChoice, SyncConflictReviewResult } from '~/fileSync/conflictResolution';
import { Box, Button, Checkbox, Flex, FormControl, FormLabel, Input, Select, Stack, Text, Textarea } from '@chakra-ui/react';
import type { FolderHost } from '~/fileSync/desktopFolders.client';
import { getNativeBridge } from '~/utils/nativeBridge';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useMountedRef } from '~/hooks/useMountedRef';
import { readStampedCache, writeStampedCache, pruneCacheNamespace } from '~/hooks/localCache';
import { rootIdentity } from '~/utils/rootIdentity';
import {
	type MobileFolder,
	requestMobileFolders,
	mobileFolderSource,
	supportsMobileSyncConditions,
	supportsMobileFolderPublication,
	supportsMobileTrashRecovery,
	supportsNativeFileVersions,
	supportsNativePathInspection,
	supportsNativeInventoryPages,
	supportsNativeBackupCapture,
	supportsNativeIgnoreRules,
	supportsNativeBackgroundUploads
} from '~/fileSync/mobileFolders.client';
import { openSyncJournal, withSyncRootLock, syncScopeKey } from '~/fileSync/journal.client';
import { readCloudFolderInventoryPages } from '~/fileSync/cloudInventoryPages.client';
import { readCloudFolderInventory } from '~/fileSync/cloudInventory.client';
import { approveMobileSyncTarget } from '~/fileSync/mobileSyncTarget.client';
import { runForegroundCloudSync, type ForegroundSyncProgress } from '~/fileSync/foregroundSync';
import { runPagedForegroundCloudSync } from '~/fileSync/pagedForegroundSync';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { requestMobileDevice } from './mobileDeviceBridge';
import { newFileSyncConfiguration, FILE_SYNC_RESOURCE_REQUIREMENTS, type FileSyncConfiguration } from '~/fileSync/configuration';
import { readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import {
	canonicalDraftConfiguration,
	configurationDraftKey,
	ConfigurationConflict,
	persistConfigurationDraft,
	readConfigurationDraft,
	readOwnedSyncFolder,
	saveConfigurationDraft,
	type ConfigurationDraft,
	type ConfigurationEditorScope
} from '~/fileSync/configurationEditor';

type ConnectionsProps = { ownerId: string; deviceId: string; roots: MobileFolder[]; rootsReady?: boolean; host?: FolderHost; active?: boolean };
export function MobileSyncConnections({ ownerId, deviceId, roots, rootsReady = true, host, active = true }: ConnectionsProps) {
	const owner = useCurrentUser(),
		dataPlane = useDataPlane();
	const identity = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	if (!dataPlane || owner?.id !== ownerId || identity.pending) return null;
	const scope = { origin: host?.origin() ?? window.location.origin, ownerId, dataPlane, deviceId };
	return (
		<Connections
			key={`${configurationDraftKey(scope)}:${identity.generation}`}
			scope={scope}
			generation={identity.generation}
			active={active}
			roots={roots}
			rootsReady={rootsReady}
			host={host}
		/>
	);
}
function Connections({
	scope,
	generation,
	roots,
	rootsReady,
	active,
	host
}: {
	scope: ConfigurationEditorScope;
	generation: number;
	roots: MobileFolder[];
	rootsReady: boolean;
	active: boolean;
	host?: FolderHost;
}) {
	const requestFolders = host?.request ?? requestMobileFolders;
	const capabilities = host ? host.capabilities : getNativeBridge();
	const runtimeOrigin = host?.origin ?? (() => window.location.origin);
	// WebKit requires Window.fetch's receiver even when transports call it as a method.
	const runtimeFetch: typeof fetch = host?.fetch ?? ((input, init) => window.fetch(input, init));
	const requireCapability = host?.requireCapability ?? requireThingtimeCapability;
	const authorizeDevice = async (deviceId: string, signal: AbortSignal) => {
		if (host) return host.authorizeDevice(scope.ownerId, deviceId, signal);
		const status = await requestMobileDevice(scope.ownerId, 'status', signal);
		if (status.state !== 'paired' || status.deviceId !== deviceId) throw Error('Reconnect this device before transferring files.');
	};
	const api = useApi(),
		apiRef = useRef(api);
	apiRef.current = api;
	const key = configurationDraftKey(scope),
		cacheKey = `tt:sync-connections:${key}`;
	const [initial] = useState(() => {
		try {
			const raw = window.localStorage.getItem(key);
			return { raw, draft: readConfigurationDraft(raw, scope.deviceId), error: '' };
		} catch (cause) {
			return { raw: null, draft: null, error: cause instanceof Error ? cause.message : 'Device draft storage is unavailable.' };
		}
	});
	const raw = useRef<string | null>(initial.raw);
	const [storageError, setStorageError] = useState(initial.error);
	const [error, setError] = useState(''),
		[viewBusy, setBusy] = useState(false),
		[notice, setNotice] = useState('');
	const nativeTask = useSyncExternalStore(nativeSyncTasks.subscribe, nativeSyncTasks.read, nativeSyncTasks.read);
	const transferSession = useRef<{ id: string; session: ReturnType<typeof createTransferActivitySession> } | null>(null);
	const ownNativeTask = nativeTask && nativeTask.scope.ownerId === scope.ownerId &&
		nativeTask.scope.origin === scope.origin && nativeTask.scope.deviceId === scope.deviceId && nativeTask.scope.dataPlane === scope.dataPlane
		? nativeTask : null;
	const appOwned = supportsNativeSyncTasks();
	const busy = viewBusy || (appOwned && !!nativeTask?.active);
	const [draft, setDraft] = useState<ConfigurationDraft | null>(initial.draft);
	const retainedDrafts = useRef(new Map<string, ConfigurationDraft>(initial.draft ? [[initial.draft.id, initial.draft]] : []));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const editorPrefix = useId();
	const resourceValidity = useRef(new Map<string, boolean>());
	const [intervalDrafts, setIntervalDrafts] = useState<Record<string, number>>({});
	const speedDrafts = useRef(new Map<string, TransferSpeedDraftState>());
	const priorityDrafts = useRef(new Map<string, UploadPriorityDraftState>());
	const [resourceDraftValid, setResourceDraftValid] = useState(true);
	const [ready, setReady] = useState(!initial.error),
		[conflict, setConflict] = useState<ConfigurationConflict | null>(null);
	const [connections, setConnections] = useState<SavedFileSyncConfiguration[]>(() => {
		const cached = readStampedCache<unknown>(cacheKey);
		if (!Array.isArray(cached)) return [];
		return cached.flatMap((row) => {
			try {
				const saved = readOwnedFileSyncConfiguration(
					{
						id: row.id,
						updatedAt: row.updatedAt,
						crystal: row.configuration,
						author: { id: scope.ownerId },
						acl: ['tt:user'],
						thingtime: ['file-sync']
					},
					scope.ownerId
				);
				return saved.configuration.deviceId === scope.deviceId ? [saved] : [];
			} catch {
				return [];
			}
		});
	});
	const [transfers, setTransfers] = useState<Record<string, ForegroundSyncProgress & { message?: string }>>({});
	const [progressDescriptors, setProgressDescriptors] = useState<Record<string, SyncProgressDescriptor | undefined>>({});
	const [inventoryDescriptors, setInventoryDescriptors] = useState<Record<string, SyncInventoryDescriptor | undefined>>({});
	const [activeTransfer, setActiveTransfer] = useState<string | null>(null);
	const [foregroundFileReview, setFileReview] = useState<{
		id: string;
		conflicts: SyncConflict[];
		apply(choices: SyncConflictChoice[]): void;
		retain(): void;
		cancel(): void;
	} | null>(null);
	const [foregroundPagedReview, setPagedReview] = useState<{ id: string; controller: ReturnType<typeof createConflictReviewController> } | null>(null);
	const pagedReview = ownNativeTask?.pagedReview ? { id: ownNativeTask.scope.rootId, controller: ownNativeTask.pagedReview } : foregroundPagedReview;
	const fileReview = ownNativeTask?.legacyReview ? { id: ownNativeTask.scope.rootId, ...ownNativeTask.legacyReview } : foregroundFileReview;
	const reviewTransport = React.useMemo(() => host ? { origin: scope.origin, fetch: host.fetch, currentOrigin: host.origin } : undefined, [host, scope.origin]);
	const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
	const [connectionCursor, setConnectionCursor] = useState<string | null>(null),
		[folderCursor, setFolderCursor] = useState<string | null>(null);
	const preparingUpload = useRef(false);
	const controller = useRef<AbortController | null>(null),
		mounted = useMountedRef();
	const assertCurrent = () => {
		if (!mounted.current || rootIdentity.read().pending || rootIdentity.read().generation !== generation || runtimeOrigin() !== scope.origin)
			throw Error('The account or storage destination changed.');
		controller.current?.signal.throwIfAborted();
	};
	const options = () => ({
		...(host ? { expectedApiOrigin: scope.origin } : {}),
		expectedActor: scope.ownerId,
		expectedDataPlane: scope.dataPlane,
		signal: controller.current?.signal
	});
	const persist = (next: ConfigurationDraft | null) => {
		if (next) retainedDrafts.current.set(next.id, next);
		else if (draft) retainedDrafts.current.delete(draft.id);
		assertCurrent();
		raw.current = persistConfigurationDraft(window.localStorage, key, raw.current, next);
		setDraft(next);
		setStorageError('');
	};
	const cache = (next: SavedFileSyncConfiguration[]) => {
		setConnections(next);
		writeStampedCache(cacheKey, next);
		pruneCacheNamespace('tt:sync-connections:', cacheKey, 32);
	};
	const run = async (work: (assertActive: () => void) => Promise<void>) => {
		if (controller.current) return;
		const active = new AbortController();
		controller.current = active;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			assertCurrent();
			await work(() => {
				active.signal.throwIfAborted();
				assertCurrent();
			});
		} catch (cause) {
			if (mounted.current && !active.signal.aborted) {
				setError(cause instanceof Error ? cause.message : 'Connection unavailable. Try again.');
				if (cause instanceof ConfigurationConflict) setConflict(cause);
			}
		} finally {
			if (controller.current === active) {
				controller.current = null;
				if (mounted.current) setBusy(false);
			}
		}
	};
	const load = async (kind: 'connections' | 'folders', cursor?: string | null) => {
		const active = controller.current!;
		const result = await apiRef.current.v1.things.list({ thingtime: kind === 'connections' ? 'file-sync' : 'folder', limit: 50, cursor }, options());
		active.signal.throwIfAborted();
		assertCurrent();
		if (!Array.isArray(result.things)) throw Error('The folder list is unavailable. Try again.');
		if (kind === 'connections') {
			const accepted: SavedFileSyncConfiguration[] = [];
			let skipped = 0;
			for (const row of result.things)
				try {
					const saved = readOwnedFileSyncConfiguration(row, scope.ownerId);
					if (saved.configuration.deviceId === scope.deviceId) accepted.push(saved);
				} catch {
					skipped++;
				}
			cache([...new Map([...(cursor ? connections : []), ...accepted].map((row) => [row.id, row])).values()]);
			setConnectionCursor(result.nextCursor ?? null);
			if (skipped) setNotice('Some shared or invalid connections are excluded. You can review them in Things.');
		} else {
			const accepted: { id: string; name: string }[] = [];
			for (const row of result.things)
				try {
					accepted.push(readOwnedSyncFolder(row, scope.ownerId));
				} catch {
					/* Only private, owned destinations are offered. */
				}
			setFolders((previous) => [...new Map([...(cursor ? previous : []), ...accepted].map((row) => [row.id, row])).values()]);
			setFolderCursor(result.nextCursor ?? null);
		}
	};
	useEffect(() => {
		void run(async () => {
			await load('connections');
			await load('folders');
		});
		const changed = (event: StorageEvent) => {
			if (event.key === key || event.key === null) {
				setReady(false);
				setStorageError('This draft changed in another tab. Reload to recover it before continuing.');
			}
		};
		const hidden = () => {
			const active = controller.current;
			if (document.visibilityState !== 'visible' && active && !preparingUpload.current && !nativeUploadMayContinue(active.signal)) active.abort();
		};
		const leave = () => controller.current?.abort();
		window.addEventListener('pagehide', leave);
		document.addEventListener('visibilitychange', hidden);
		window.addEventListener('storage', changed);
		return () => {
			controller.current?.abort();
			controller.current = null;
			window.removeEventListener('storage', changed);
			window.removeEventListener('pagehide', leave);
			document.removeEventListener('visibilitychange', hidden);
		};
		// This component is keyed by the full account/storage/device identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const edit = (next: ConfigurationDraft) => {
		retainedDrafts.current.set(next.id, next); setSelectedId(next.id);
		setDraft(next);
		setError('');
		setConflict(null);
		try {
			persist(next);
		} catch (cause) {
			setStorageError(cause instanceof Error ? cause.message : 'Draft could not be saved on this device.');
		}
	};
	const progressKey = (id: string) => 'tt:sync-progress:' + syncScopeKey({ ...scope, rootId: id });
	const transfer = (saved: SavedFileSyncConfiguration) => {
		if (appOwned) {
			void startNativeSyncTask(saved, { ...scope, rootId: saved.id }, generation).catch(cause => {
				if (mounted.current) setError(cause instanceof Error ? cause.message : 'Transfer could not start.');
			});
			return;
		}
		void run(async (assertActive) => {
			const active = controller.current!,
				syncScope = { ...scope, rootId: saved.id };
			transferSession.current?.session.stop();
			const speeds = createTransferActivitySession(); transferSession.current = { id: saved.id, session: speeds };
			setProgressDescriptors(previous => ({ ...previous, [saved.id]: undefined }));
			writeStampedCache('tt:sync-progress-tree:' + syncScopeKey(syncScope), null);
			setInventoryDescriptors(previous => ({ ...previous, [saved.id]: undefined }));
			writeStampedCache('tt:sync-inventory:' + syncScopeKey(syncScope), null);
			let latestProgress: ForegroundSyncProgress = { stage: 'checking', confirmed: 0, total: 0 };
			const publish = (value: ForegroundSyncProgress & { message?: string }) => {
				assertActive();
				speeds.stage(value.stage);
				setTransfers((previous) => ({ ...previous, [saved.id]: value }));
				writeStampedCache(progressKey(saved.id), value);
				if (value.stage === 'retained') window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
				pruneCacheNamespace('tt:sync-progress:', progressKey(saved.id), 32);
			};
			if (capabilities?.platform === 'android' && supportsNativeBackgroundUploads(capabilities) && saved.configuration.mode !== 'download') {
				// The OS permission dialog may pause the activity. No transfer is active
				// until the native preparation returns after foreground reauthentication.
				preparingUpload.current = true;
				try {
					await requestFolders(scope.ownerId, { action: 'prepare-upload' }, active.signal);
				} finally {
					preparingUpload.current = false;
				}
				assertActive();
				if (document.visibilityState !== 'visible') throw Error('Return to the app to start your upload.');
			}
			setActiveTransfer(saved.id);
			const currentScope = () => {
				assertActive();
				return syncScope;
			};
			let journal: Awaited<ReturnType<typeof openSyncJournal>> | undefined;
			try {
				journal = await openSyncJournal();
				assertActive();
				await withSyncRootLock(
					syncScope,
					async () => {
						assertActive();
						const nativeRoots = (await requestFolders(scope.ownerId, { action: 'list' }, active.signal)).roots;
						assertPhotoSourcePolicy(saved.configuration, nativeRoots);
						const inspectPaths = supportsNativePathInspection(capabilities) && nativeRoots.some(root => root.id === saved.configuration.localRootId && root.sourceKind !== 'photos');
						assertActive();
						const localTarget = ['download', 'two-way'].includes(saved.configuration.mode)
							? await approveMobileSyncTarget(saved, syncScope, active.signal, requestFolders, capabilities)
							: undefined;
						assertActive();
						if (saved.configuration.ignoreRules && !supportsNativeIgnoreRules(capabilities)) throw Error('Update Thingtime Mac before using this connection’s Gitignore rules.');
						if (saved.configuration.ignoreRules) await requireCapability('api.things', '1.38.0');
						const runSync = host || getNativeBridge()?.platform === 'ios' ? runPagedForegroundCloudSync : runForegroundCloudSync;
						await runSync(
							saved,
							syncScope,
							{
								currentScope,
								localTarget,
								readConfiguration: async () => {
									const value = await apiRef.current.v1.things.get({ id: saved.id }, options());
									assertActive();
									return value.thing;
								},
								authorizeDevice: async () => {
									await authorizeDevice(scope.deviceId, active.signal);
									assertPhotoSourcePolicy(saved.configuration, (await requestFolders(scope.ownerId, { action: 'list' }, active.signal)).roots);
									assertActive();
								},
								conditions: async () => (await requestFolders(scope.ownerId, { action: 'conditions' }, active.signal)).conditions!,
								scanLocal: async () =>
									(
										await requestFolders(scope.ownerId, { action: 'scan', rootId: saved.configuration.localRootId,
											...((host || capabilities?.platform === 'ios') && saved.configuration.excludedPaths.length ? { excludedPaths: saved.configuration.excludedPaths } : {}), ...(saved.configuration.ignoreRules ? { ignoreRules: saved.configuration.ignoreRules } : {}) }, active.signal)
									).entries!,
								...(inspectPaths && supportsNativeInventoryPages(capabilities) ? {
									scanLocalPages: () => readNativeInventory({ ownerId: scope.ownerId, deviceId: scope.deviceId,
										rootId: saved.configuration.localRootId, signal: active.signal, request: requestFolders,
										excludedPaths: saved.configuration.excludedPaths, ...(saved.configuration.ignoreRules ? { ignoreRules: saved.configuration.ignoreRules } : {}),
                                        ...(supportsNativeBackupCapture(capabilities) && saved.configuration.mode === 'backup' && !saved.configuration.propagateDeletes ? {
                                            backupPolicy: { mode: 'backup' as const, propagateDeletes: false },
                                            onProgress: value => publish({ stage: 'scanning', confirmed: 0, total: 0, indexed: value.totalEntries,
                                                skipped: value.totalSkipped, coverage: value.coverage, consistency: value.consistency })
                                        } : {}) })
								} : {}),
								...(inspectPaths ? { inspectLocal: async (path: string) => (await requestFolders(scope.ownerId,
									{ action: 'inspect', rootId: saved.configuration.localRootId, path }, active.signal)).inspectedEntry! } : {}),
								...(host || getNativeBridge()?.platform === 'ios' ? {
									inventoryPages: () => readCloudFolderInventoryPages(syncScope, saved.configuration.remoteFolderId, {
										currentScope, signal: active.signal, origin: runtimeOrigin, fetch: runtimeFetch, requireCapability
									})
								} : {}),
								inventory: () =>
									readCloudFolderInventory(syncScope, saved.configuration.remoteFolderId, {
										currentScope,
										signal: active.signal,
										origin: runtimeOrigin,
										fetch: runtimeFetch,
										requireCapability
									}),
								source: async (entry) =>
									mobileFolderSource(scope.ownerId, saved.configuration.localRootId, entry, active.signal, requestFolders, capabilities),
								journal: journal!,
								runtime: {
									currentScope,
									origin: runtimeOrigin,
									fetch: runtimeFetch,
									requireCapability
								},
								progress: publish,
								transfer: value => { assertActive(); speeds.add(value); },
								progressSession: (descriptor: SyncProgressDescriptor) => {
									assertActive(); setProgressDescriptors(previous => ({ ...previous, [saved.id]: descriptor }));
									const cacheKey = 'tt:sync-progress-tree:' + syncScopeKey(syncScope);
									writeStampedCache(cacheKey, descriptor); pruneCacheNamespace('tt:sync-progress-tree:', cacheKey, 32);
								},
								reviewPagedConflicts: (session: PagedConflictReviewSession) =>
									new Promise<PagedConflictReviewResult>((resolve, reject) => {
										let settled = false;
										const finish = (result?: PagedConflictReviewResult) => {
											if (settled) return;
											settled = true;
											active.signal.removeEventListener('abort', abort);
											if (mounted.current) setPagedReview(null);
											if (active.signal.aborted) reject(active.signal.reason);
											else if (result) resolve(result);
											else reject(Error('Conflict review interrupted. Saved choices can be resumed.'));
										};
										const review = createConflictReviewController(session, finish);
										const abort = () => { review.dispose(); finish(); };
										active.signal.addEventListener('abort', abort, { once: true });
										if (active.signal.aborted) { abort(); return; }
										setPagedReview({ id: saved.id, controller: review });
										void review.reload().catch(() => { /* controller exposes a retryable error */ });
									}),
								reviewConflicts: (conflicts) =>
									new Promise<SyncConflictReviewResult>((resolve, reject) => {
										const finish = (choices?: SyncConflictReviewResult) => {
											active.signal.removeEventListener('abort', abort);
											if (mounted.current) setFileReview(null);
											if (active.signal.aborted) reject(active.signal.reason);
											else if (choices) resolve(choices);
											else reject(Error('Conflict review cancelled. Both folders were preserved.'));
										};
										const abort = () => finish();
										active.signal.addEventListener('abort', abort, { once: true });
										if (active.signal.aborted) {
											abort();
											return;
										}
										setFileReview({
											id: saved.id,
											conflicts,
											apply: (choices) => finish(choices),
											retain: () => finish({ action: 'retain' }),
											cancel: () => finish()
										});
									})
							},
							active.signal
						);
					},
					undefined,
					active.signal
				);
			} catch (cause) {
				if (!active.signal.aborted)
					publish({
						...latestProgress,
						message: cause instanceof Error ? cause.message : 'Transfer interrupted. Retry to recover saved work.'
					});
				throw cause;
			} finally {
				speeds.stop();
				journal?.close();
				if (mounted.current) setActiveTransfer(null);
			}
		});
	};
	const start = () =>
		edit({
			version: 1,
			id: crypto.randomUUID(),
			baseUpdatedAt: null,
			pending: false,
			exclusions: '',
			configuration: {
				...newFileSyncConfiguration({
					name: roots[0]?.name || 'Folder connection',
					deviceId: scope.deviceId,
					localRootId: roots[0]?.id || 'unselected',
					remoteFolderId: 'unselected',
					sourceKind: roots[0]?.sourceKind
				}),
				localRootId: roots[0]?.id ?? '',
				remoteFolderId: ''
			}
		});
	const open = (id: string, replace = false) =>
		void run(async (assertCurrent) => {
			setSelectedId(id);
			setResourceDraftValid(resourceValidity.current.get(id) ?? true);
			const retained = !replace && retainedDrafts.current.get(id);
			if (retained) { persist(retained); setConflict(null); return; }
			const result = await apiRef.current.v1.things.get({ id }, options());
			assertCurrent();
			const saved = readOwnedFileSyncConfiguration(result.thing, scope.ownerId);
			if (saved.configuration.deviceId !== scope.deviceId || saved.id !== id) throw Error('This connection belongs to another device.');
			persist({
				version: 1,
				id,
				baseUpdatedAt: saved.updatedAt,
				pending: false,
				exclusions: saved.configuration.excludedPaths.join('\n'),
				configuration: saved.configuration
			});
			setConflict(null);
		});
	const save = () =>
		void run(async (assertCurrent) => {
			if (!draft || !ready) return;
			if (!resourceDraftValid) throw Error('Correct the resource limit fields before saving.');
			let prepared = draft;
            if (draft.baseUpdatedAt === null && !draft.configuration.remoteFolderId) {
                const source = roots.find(root => root.id === draft.configuration.localRootId);
                if (!source || !supportsNativeSourcePaths(capabilities) || !validNativeSourcePath(source?.sourcePath) || source?.sourceKind === 'photos') throw Error('Choose a private cloud folder. This device has not provided the selected folder’s absolute path.');
                const destination = await prepareSyncCloudDestination({ baseUpdatedAt: null, remoteFolderId: '', source }, scope, {
                    assertCurrent: assertCurrent,
                    negotiate: async requirements => { for (const [feature, minimum] of Object.entries(requirements)) await requireCapability(feature, minimum); },
                    get: async id => (await apiRef.current.v1.things.get({ id }, options())).thing,
                    create: input => apiRef.current.v1.things.create(input, options())
                });
                assertCurrent();
                prepared = { ...draft, configuration: { ...draft.configuration, remoteFolderId: destination.id } };
                persist(prepared); setFolders(previous => [...previous.filter(folder => folder.id !== destination.id), destination]);
            }
            const pending = { ...prepared, configuration: canonicalDraftConfiguration(prepared), pending: true };
			if (pending.configuration.resourceLimits) {
				for (const [feature, minimum] of Object.entries({ ...FILE_SYNC_RESOURCE_REQUIREMENTS, ...fileSyncDownloadRequirements(pending.configuration) })) await requireCapability(feature, minimum);
			} else if (pending.configuration.ignoreRules) await requireCapability('api.things', '1.38.0');
			persist(pending); // Must succeed before even starting the first write attempt.
			let dispatched = false;
			let saved: SavedFileSyncConfiguration;
			try {
				saved = await saveConfigurationDraft(pending, scope, {
					assertCurrent,
					get: async (id) => (await apiRef.current.v1.things.get({ id }, options())).thing,
					create: (id, configuration) => {
						dispatched = true;
						return apiRef.current.v1.things.create({ shareId: id, thingtime: ['file-sync'], crystal: configuration, acl: ['tt:user'] }, options());
					},
					update: (id, configuration, expectedUpdatedAt) => {
						dispatched = true;
						return apiRef.current.v1.things.update({ id, crystal: configuration, expectedUpdatedAt, replaceCrystal: true }, options());
					},
					verifyDeviceRoot: async (deviceId, rootId) => {
						await authorizeDevice(deviceId, controller.current!.signal);
						assertCurrent();
						const access = await requestFolders(scope.ownerId, { action: 'list' }, controller.current!.signal);
						assertCurrent();
						if (!access.roots.some((root) => root.id === rootId))
							throw Error('Folder access was removed. Restore access to this folder before retrying.');
					}
				});
			} catch (cause) {
				// A first attempt that never reached a mutation can remain editable.
				// A restored pending save may still have an older request in flight.
				assertCurrent();
				if (!draft.pending && !dispatched && !(cause instanceof ConfigurationConflict)) persist(prepared);
				throw cause;
			}
			assertCurrent();
			persist(null);
			setConflict(null);
			cache([saved, ...connections.filter((row) => row.id !== saved.id)]);
			setNotice('Connection saved. Supported transfers can run while this app stays open.');
		});
	return (
		<Box borderTop="1px solid var(--tt-border, #ececef)" marginTop={4} paddingTop={3} minWidth={0}>
			<Flex justify="space-between" align="center" gap={2} wrap="wrap">
				<Text fontSize="13px" fontWeight={700}>
					Sync connections
				</Text>
				<Flex gap={2} wrap="wrap">
					<Button
						size="sm"
						minHeight="40px"
						variant="ghost"
						isDisabled={busy}
						onClick={() =>
							void run(async () => {
								await load('connections');
								await load('folders');
							})
						}
					>
						Refresh
					</Button>
					<Button size="sm" minHeight="40px" variant="outline" isDisabled={!ready || busy || !!draft || !roots.length} onClick={start}>
						Add connection
					</Button>
				</Flex>
			</Flex>
			<Text fontSize="12px" color="var(--tt-muted, #71717a)">
				{appOwned && !host ? 'Started transfers continue when you leave this screen. Returning to Thingtime resumes saved work with the same account and folder access. iOS may finish an accepted file in the background; remaining work waits for the app to return. Stop transfer keeps a job paused until you retry.' : appOwned ? 'Started transfers continue when you leave this screen or close the Mac window. Reopen this connection to review conflicts or stop a transfer. Quitting interrupts transfers; unfinished jobs resume when you reopen Thingtime with the same account and access. Stop transfer keeps a job paused until you retry.' :
					'Transfer selected folders in either direction while this app stays open. Background transfers are still being added.'}
				{' '}Downloads and two-way sync require native folder approval and recoverable device Trash for deletion propagation. Conflicting changes preserve both copies for review.
			</Text>
			{scope.dataPlane === 'home' && supportsMobileTrashRecovery(capabilities) && (
				<SyncDetailsSection title="Recover device files" retainChildren><NativeFileRecovery
					roots={roots.filter((root) => supportsMobileFolderPublication(root, capabilities))}
					busy={busy}
					versionsScopeKey={supportsNativeFileVersions(capabilities) ? key : undefined}
					perform={(work) =>
						run(async (assertActive) => {
							await work(async (request) => {
								assertActive();
								await authorizeDevice(scope.deviceId, controller.current!.signal);
								assertActive();
								const result = await requestFolders(scope.ownerId, request, controller.current!.signal);
								assertActive();
								return result;
							});
						})
					}
				/></SyncDetailsSection>
			)}
			{connections.map((saved) => {
				const task = ownNativeTask?.scope.rootId === saved.id ? ownNativeTask : null;
				const progress = task?.progress ?? transfers[saved.id] ?? readStampedCache<ForegroundSyncProgress & { message?: string }>(progressKey(saved.id));
				const running = !!task?.active || (viewBusy && activeTransfer === saved.id);
				const progressScope = { ...scope, rootId: saved.id };
				const progressDescriptor = task ? task.progressDescriptor : progressDescriptors[saved.id] ?? (!running
					? readStampedCache<SyncProgressDescriptor>('tt:sync-progress-tree:' + syncScopeKey(progressScope)) ?? undefined : undefined);
				const inventoryDescriptor = task ? task.inventoryDescriptor : inventoryDescriptors[saved.id] ?? (!running
                    ? readStampedCache<SyncInventoryDescriptor>('tt:sync-inventory:' + syncScopeKey(progressScope)) ?? undefined : undefined);
				const downloading = saved.configuration.mode === 'download';
				const twoWay = saved.configuration.mode === 'two-way';
				if (!speedDrafts.current.has(saved.id)) speedDrafts.current.set(saved.id, {});
				if (!priorityDrafts.current.has(saved.id)) priorityDrafts.current.set(saved.id, {});
				const nativeRoot = roots.find((root) => root.id === saved.configuration.localRootId);
				let sourceAllowed = true;
				try {
					assertPhotoSourcePolicy(saved.configuration, roots);
				} catch {
					sourceAllowed = false;
				}
				const supported =
					['upload', 'backup'].includes(saved.configuration.mode) ||
					((downloading || twoWay) &&
						supportsMobileFolderPublication(
							roots.find((root) => root.id === saved.configuration.localRootId),
							capabilities
						) &&
						(!saved.configuration.propagateDeletes || supportsMobileTrashRecovery(capabilities)));
				const allowed =
					sourceAllowed &&
					supportsMobileSyncConditions(capabilities) &&
					scope.dataPlane === 'home' &&
					supported &&
					!saved.configuration.paused &&
					roots.some((root) => root.id === saved.configuration.localRootId);
				return (
					<SyncFolderCard key={saved.id} title={saved.configuration.name} editorSlotId={`${editorPrefix}-${saved.id}`} scopeKey={`${key}:${generation}:${saved.id}`} accountTransport={reviewTransport}
						path={(supportsNativeSourcePaths(capabilities) && validNativeSourcePath(nativeRoot?.sourcePath) && nativeRoot?.sourceKind !== 'photos' ? nativeRoot.sourcePath : undefined) || (nativeRoot ? 'Folder path unavailable' : 'Folder access missing')}
						description={saved.configuration.mode === 'backup' ? 'Backup to cloud · keep deleted files' : twoWay ? 'Two-way sync' : downloading ? 'Cloud to device' : 'Device to cloud'}
						stats={`${syncFolderActivityLabel({ paused: saved.configuration.paused, rootsReady, hasRoot: !!nativeRoot, taskPaused: task?.status === 'paused' && !task.waiting, running })}${progress ? ` · ${progress.confirmed} of ${progress.total} operations confirmed` : ' · No transfer statistics yet'}`}
						expanded={selectedId === saved.id} onToggle={expanded => { if (expanded) { if (!draft?.pending) { setSelectedId(saved.id); if (retainedDrafts.current.has(saved.id)) open(saved.id); } } else if (selectedId === saved.id) setSelectedId(null); }}>
					<Flex align="center" gap={2} wrap="wrap">
						<Box flex={{ base: '1 1 100%', sm: 1 }} minWidth={0} overflowWrap="anywhere">
							<Text fontSize="13px" fontWeight={600}>
								{saved.configuration.name}
							</Text>
							{nativeRoot?.sourceKind === 'photos' && (
								<Text fontSize="12px" color="var(--tt-muted, #71717a)">
									{photoAccessDescription(nativeRoot)}
								</Text>
							)}
							<Text fontSize="12px">
								{task?.stopping ? 'Pausing…' : task?.status === 'paused' && !task.waiting ? 'Paused' : !rootsReady
									? running ? 'Transfer in progress · Folder list pending' : 'Checking folder access…'
									: !sourceAllowed
									? 'Source access or backup policy needs review'
									: saved.configuration.paused
									? 'Paused'
									: !supported
									? downloading || twoWay
										? 'Downloads and two-way sync need folder approval and an updated app for recoverable deletions'
										: 'This direction is not available yet'
									: !supportsMobileSyncConditions(capabilities)
									? 'Update this app to transfer files'
									: task?.waiting
									? 'Waiting to continue automatically'
									: task?.status === 'error' || (!running && progress?.message && !['complete', 'retained'].includes(progress.stage))
									? 'Needs attention'
									: running
									? 'Transfer in progress'
									: twoWay
									? 'Ready for two-way sync with folder approval'
									: downloading
									? 'Ready to download with folder approval'
										: appOwned ? 'Ready to upload' : 'Ready for a foreground upload'}
								{rootsReady && !nativeRoot ? ' · Folder access missing' : ''}
							</Text>
							{progress && (
								<Text
									role="status"
									fontSize="12px"
									color={progress.stage === 'retained' ? 'var(--tt-muted, #71717a)' : undefined}
									marginTop={1}
									overflowWrap="anywhere"
								>
									{running
										? progress.stage === 'reviewing'
											? 'Waiting for your conflict choices.'
											: progress.stage === 'scanning'
											? 'Checking both folders…'
											: progress.stage === 'verifying'
											? 'Verifying completed work…'
											: progress.path
											? `${progress.path}: ${Math.round(((progress.bytes ?? 0) / Math.max(1, progress.size ?? 1)) * 100)}%`
											: `${progress.confirmed} of ${progress.total} operations confirmed`
										: progress.message ||
										  (progress.stage === 'retained'
												? 'Both versions are saved in Timeline with IDs built from their contents. You can download or restore them later. This conflict remains unresolved.'
												: progress.stage === 'complete'
												? 'Last transfer finished.'
												: 'Transfer stopped or interrupted. Retry to recover saved work.')}
								</Text>
							)}
							{progress?.stage === 'retained' && (
								<Button as="a" href="/history?storage=home&kind=file" size="xs" variant="link" mt={2}>
									View saved versions
								</Button>
							)}
						</Box>
						<Button size="sm" minHeight="40px" variant="outline" isDisabled={busy || !!draft?.pending || !ready} onClick={() => open(saved.id)}>
							Edit
						</Button>
						{running ? (
							<Button size="sm" minHeight="40px" isDisabled={task?.stopping} onClick={() => task?.active ? void pauseNativeSyncJob(task.scope, generation).catch(cause => setError(cause instanceof Error ? cause.message : 'Transfer stopped, but its pause could not be saved.')) : controller.current?.abort()}>
								{task?.stopping ? 'Pausing…' : 'Pause sync'}
							</Button>
						) : (
							<Button size="sm" minHeight="40px" isDisabled={!allowed || busy || retainedDrafts.current.has(saved.id) || !ready} onClick={() => transfer(saved)}>
								{task?.status === 'paused' && !task.waiting ? 'Resume sync' : progress && !['complete', 'retained'].includes(progress.stage)
									? 'Retry transfer'
									: twoWay
									? 'Sync now'
									: downloading
									? 'Download now'
									: 'Upload now'}
							</Button>
						)}
						{active && selectedId === saved.id && appOwned && !!host && <Box width="100%" minW={0}>
							<SyncDetailsSection title="Automatic sync"><DesktopSyncAutomation saved={saved} scope={{ ...scope, rootId: saved.id }} generation={generation}
								disabled={!allowed || retainedDrafts.current.has(saved.id) || !ready} accountTransport={reviewTransport} intervalDraft={intervalDrafts[saved.id]} onIntervalDraftChange={value => setIntervalDrafts(previous => ({ ...previous, [saved.id]: value }))} /></SyncDetailsSection>
						</Box>}
						{active && selectedId === saved.id && (host || capabilities?.platform === 'ios') && (progress || progressDescriptor) && <Box width="100%" minW={0}>
							<SyncDetailsSection title="Progress, speed and priorities"><SyncProgressViewer speedDraftState={speedDrafts.current.get(saved.id)} scopeKey={`${key}:${generation}:${saved.id}`} descriptor={progressDescriptor}
								uploadPriorities={!downloading ? { draftState: priorityDrafts.current.get(saved.id), scope: progressScope, excludedPaths: saved.configuration.excludedPaths, ignoreRules: saved.configuration.ignoreRules } : undefined}
								series={task?.transferSeries ?? (transferSession.current?.id === saved.id ? transferSession.current.session.series : undefined)}
								progress={progress ?? undefined} status={task?.status ?? (running ? 'running' : progress?.stage === 'complete' ? 'complete' : 'paused')}
								message={progress?.message} accountTransport={reviewTransport} currentScope={() => {
									if (!mounted.current || rootIdentity.read().pending || rootIdentity.read().generation !== generation || runtimeOrigin() !== scope.origin)
										throw Error('The account or storage destination changed.');
									return progressScope;
								}} /></SyncDetailsSection>
						</Box>}
						{active && selectedId === saved.id && inventoryDescriptor && <Box width="100%" minW={0}>
                            <SyncDetailsSection title="Backup coverage"><BackupCoverageViewer scopeKey={`${key}:${generation}:${saved.id}`} descriptor={inventoryDescriptor} accountTransport={reviewTransport}
                                currentScope={() => {
                                    if (!mounted.current || rootIdentity.read().pending || rootIdentity.read().generation !== generation || runtimeOrigin() !== scope.origin)
                                        throw Error('The account or storage destination changed.');
                                    return progressScope;
                                }} /></SyncDetailsSection>
                        </Box>}
                        {pagedReview?.id === saved.id && <Box width="100%" minW={0}>
							<PagedSyncConflictReview controller={pagedReview.controller} mode={saved.configuration.mode}
								scopeKey={`${key}:${generation}:${saved.id}`} accountTransport={reviewTransport} />
						</Box>}
						{fileReview?.id === saved.id && (
							<SyncConflictReview
								conflicts={fileReview.conflicts}
								mode={saved.configuration.mode}
								onApply={fileReview.apply}
								onRetain={fileReview.retain}
								onCancel={fileReview.cancel}
							/>
						)}
					</Flex>
					</SyncFolderCard>
				);
			})}
			{connectionCursor && (
				<Button size="sm" minHeight="40px" isDisabled={busy} onClick={() => void run(() => load('connections', connectionCursor))}>
					More connections
				</Button>
			)}
			{[...retainedDrafts.current.values()].filter(row => !connections.some(saved => saved.id === row.id)).map(row => (
                <SettingsSection key={`draft-${row.id}`} eyebrow={row.configuration.name || 'New folder connection'} description="Unsaved connection settings"
                    summary="Draft · no transfer started" open={selectedId === row.id} onToggle={expanded => { if (expanded) { setSelectedId(row.id); setDraft(row); } else if (selectedId === row.id) setSelectedId(null); }}><Text fontSize="13px">Continue editing this draft below.</Text></SettingsSection>
            ))}
			{[...retainedDrafts.current.values()].map(draft => (
				<SyncEditorPlacement key={draft.id} targetId={connections.some(saved => saved.id === draft.id) ? `${editorPrefix}-${draft.id}` : undefined}><Box hidden={selectedId !== draft.id} marginTop={4} border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={3}>
					<SyncConfigurationForm sourcePathsAvailable={supportsNativeSourcePaths(capabilities)} draft={draft} roots={roots} folders={folders} disabled={busy || draft.pending || !ready} scopeKey={`${key}:${generation}:${draft.id}`} accountTransport={reviewTransport} onChange={edit} onResourceValidityChange={valid => { resourceValidity.current.set(draft.id, valid); if (selectedId === draft.id) setResourceDraftValid(valid); }} />
					{folderCursor && (
						<Button size="sm" minHeight="40px" marginTop={2} isDisabled={busy} onClick={() => void run(() => load('folders', folderCursor))}>
							More cloud folders
						</Button>
					)}
					<Text fontSize="12px" marginTop={3}>
						{draft.pending
							? 'This save is not confirmed. Retry checks the same connection; its settings stay fixed until resolved.'
							: storageError
							? 'Draft changes have not been saved on this device.'
							: 'Draft saved on this device. Saving settings does not grant permission to transfer files.'}
					</Text>
					{conflict?.latest && (
						<Box as="details" marginTop={3}>
							<Box as="summary" cursor="pointer" paddingY={2} fontSize="13px">
								Review saved settings
							</Box>
							<SyncConfigurationForm
								draft={{
									version: 1,
									id: conflict.latest.id,
									baseUpdatedAt: conflict.latest.updatedAt,
									configuration: conflict.latest.configuration,
									exclusions: conflict.latest.configuration.excludedPaths.join('\n'),
									pending: false
								}}
								roots={roots}
								folders={folders}
								disabled
								onChange={() => {}}
							/>
						</Box>
					)}
					<Flex gap={2} marginTop={3} wrap="wrap">
						<Button size="sm" minHeight="40px" isDisabled={busy || !ready || !!conflict || !resourceDraftValid} onClick={save}>
							{draft.pending ? 'Retry save' : 'Save connection'}
						</Button>
						{!draft.pending && (
							<Button size="sm" minHeight="40px" variant="ghost" isDisabled={busy || !ready} onClick={() => void run(async () => persist(null))}>
								Discard draft
							</Button>
						)}
						{conflict && (
							<Button
								size="sm"
								minHeight="40px"
								variant="outline"
								isDisabled={busy || !ready}
								onClick={() =>
									conflict.latest
										? open(draft.id, true)
										: void run(async () => {
												persist(null);
												setConflict(null);
										  })
								}
							>
								{conflict.latest ? 'Replace draft with saved version' : 'Discard draft for deleted connection'}
							</Button>
						)}
					</Flex>
				</Box></SyncEditorPlacement>
			))}
			{notice && (
				<Text role="status" fontSize="12px" marginTop={2}>
					{notice}
				</Text>
			)}
			{storageError && (
				<Text role="alert" color="orange.600" fontSize="12px" marginTop={2}>
					{storageError}
				</Text>
			)}
			{error && (
				<Text role="alert" color="orange.600" fontSize="12px" marginTop={2} overflowWrap="anywhere">
					{error}
				</Text>
			)}
		</Box>
	);
}

export function SyncConfigurationForm({
	draft,
	roots,
	folders,
	disabled,
	scopeKey,
	accountTransport,
	onChange,
	onResourceValidityChange,
	sourcePathsAvailable = false
}: {
	sourcePathsAvailable?: boolean;
	draft: ConfigurationDraft;
	roots: MobileFolder[];
	folders: { id: string; name: string }[];
	disabled: boolean;
	scopeKey?: string;
	accountTransport?: Parameters<typeof SyncIgnoreRulesEditor>[0]['accountTransport'];
	onChange(draft: ConfigurationDraft): void;
	onResourceValidityChange?(valid: boolean): void;
}) {
	const prefix = useId(),
		c = draft.configuration;
	const selectedRoot = roots.find((root) => root.id === c.localRootId);
	const photos = selectedRoot?.sourceKind === 'photos' || c.sourceKind === 'photos';
	const change = (patch: Partial<FileSyncConfiguration>) => onChange({ ...draft, configuration: { ...c, ...patch } });
	const field = (name: string, label: string, child: React.ReactNode) => (
		<FormControl isDisabled={disabled}>
			<FormLabel htmlFor={`${prefix}-${name}`} fontSize="12px" marginBottom={1}>
				{label}
			</FormLabel>
			{child}
		</FormControl>
	);
	return (
		<Stack spacing={3} fontSize="13px" minWidth={0}>
			{field(
				'name',
				'Connection name',
				<Input id={`${prefix}-name`} value={c.name} onChange={(e) => change({ name: e.target.value })} />
			)}
			{field(
				'local',
				'Device folder',
				<Select
					id={`${prefix}-local`}
					value={c.localRootId}
					onChange={(e) => {
						const root = roots.find((root) => root.id === e.target.value);
						change({
							localRootId: e.target.value,
							sourceKind: root?.sourceKind,
							...(root?.sourceKind === 'photos' ? { mode: 'backup', propagateDeletes: false } : {})
						});
					}}
				>
					<option value="">Choose a device folder</option>
					{c.localRootId && !roots.some((r) => r.id === c.localRootId) && <option value={c.localRootId}>Folder access missing</option>}
					{roots.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name}
						</option>
					))}
				</Select>
			)}
			{selectedRoot?.sourceKind === 'photos' && (
				<Text fontSize="12px" color="var(--tt-muted, #71717a)">
					{photoAccessDescription(selectedRoot)}. Backup runs while this app is open.
				</Text>
			)}
			{field(
				'remote',
				'Private cloud folder',
				<Select id={`${prefix}-remote`} value={c.remoteFolderId} onChange={(e) => change({ remoteFolderId: e.target.value })}>
					<option value="">{draft.baseUpdatedAt === null && sourcePathsAvailable && validNativeSourcePath(selectedRoot?.sourcePath) && selectedRoot?.sourceKind !== 'photos' ? 'Create matching folders on Save' : 'Choose a folder from Things'}</option>
					{c.remoteFolderId && !folders.some((r) => r.id === c.remoteFolderId) && (
						<option value={c.remoteFolderId}>Saved folder · {c.remoteFolderId.slice(0, 8)}</option>
					)}
					{folders.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name} · {r.id.slice(0, 8)}
						</option>
					))}
				</Select>
			)}
			{!folders.length && <Text fontSize="12px">Create a private folder in Things, then refresh this list.</Text>}
			{field(
				'mode',
				'Direction',
				<Select
					id={`${prefix}-mode`}
					isDisabled={disabled || photos}
					value={c.mode}
					onChange={(e) =>
						change({ mode: e.target.value as FileSyncConfiguration['mode'], ...(e.target.value === 'backup' ? { propagateDeletes: false } : {}) })
					}
				>
					<option value="two-way">Two-way</option>
					<option value="upload">Device to cloud</option>
					<option value="download">Cloud to device</option>
					<option value="backup">Backup to cloud · keep deleted files</option>
				</Select>
			)}
			<Box as="details"><Box as="summary" cursor="pointer" paddingY={2}>Transfer options</Box><Stack spacing={3}>
			{field(
				'network',
				'Network',
				<Select id={`${prefix}-network`} value={c.network} onChange={(e) => change({ network: e.target.value as FileSyncConfiguration['network'] })}>
					<option value="wifi">Wi-Fi only</option>
					<option value="any">Any network · mobile data may be used</option>
				</Select>
			)}
			<Checkbox minHeight="40px" isDisabled={disabled} isChecked={c.paused} onChange={(e) => change({ paused: e.target.checked })}>
				Paused
			</Checkbox>
			<Checkbox minHeight="40px" isDisabled={disabled} isChecked={c.chargingOnly} onChange={(e) => change({ chargingOnly: e.target.checked })}>
				Only while charging
			</Checkbox>
			<Checkbox
				minHeight="40px"
				isDisabled={disabled || c.mode === 'backup'}
				isChecked={c.propagateDeletes}
				onChange={(e) => change({ propagateDeletes: e.target.checked })}
			>
				Move deleted files to Trash on the other side
			</Checkbox>
			</Stack></Box>
			<Box as="details"><Box as="summary" cursor="pointer" paddingY={2}>Exclusions and ignore rules</Box><Stack spacing={3}>
			{field(
				'exclusions',
				'Excluded paths · one per line',
				<Textarea
					id={`${prefix}-exclusions`}
					value={draft.exclusions}
					placeholder={'Private\nDocuments/archive.zip'}
					onChange={(e) => onChange({ ...draft, exclusions: e.target.value })}
				/>
			)}
			<Text fontSize="12px" color="var(--tt-muted, #71717a)">
				Paths are relative to the selected folder. A folder exclusion includes its contents. Wildcards are not supported.
			</Text>
			<SyncIgnoreRulesEditor rules={c.ignoreRules ?? ''} excludedPaths={draft.exclusions.split(/\r?\n/).filter(Boolean)} disabled={disabled || photos}
				scopeKey={scopeKey ?? `${draft.id}:${c.deviceId}`} accountTransport={accountTransport}
				onChange={ignoreRules => change({ configurationVersion: c.resourceLimits ? 3 : ignoreRules ? 2 : 1, ignoreRules })} />
			</Stack></Box>
			<Box as="details"><Box as="summary" cursor="pointer" paddingY={2}>Resource limits</Box>
			<SyncResourceControls onValidityChange={onResourceValidityChange} resourceLimits={c.resourceLimits} disabled={disabled || photos} scopeKey={scopeKey ?? `${draft.id}:${c.deviceId}`} accountTransport={accountTransport}
				onChange={resourceLimits => change({ resourceLimits, configurationVersion: resourceLimits ? 3 : c.ignoreRules ? 2 : 1 })} />
			</Box>
		</Stack>
	);
}
