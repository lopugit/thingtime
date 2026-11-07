import { iosManagedSyncResources, IOS_SYNC_RESOURCE_STATUS } from './deviceSyncResourceDisplay';
import { prepareExplicitSyncStart } from '~/fileSync/configurationStart';
import { SyncDestinationControl } from './SyncDestinationControl';
import { syncConnectionGlance } from '~/fileSync/connectionGlance';
import { SyncConditionsWait } from '~/fileSync/foregroundSyncContext';
import { photoDownloadPreparation, photoQueueDisplay, syncFolderActivityLabel, type PhotoQueueProgress } from './syncFolderCardBlocks';
import type { TransferSpeedDraftState } from './TransferSpeedTrackers';
import { SyncEditorPlacement } from './SyncEditorPlacement';
import type { UploadPriorityDraftState } from './SyncUploadPriorities';
import { supportsNativeSourcePaths, validNativeSourcePath } from '~/fileSync/mobileFolders.client';
import { cloudFolderPaths, type CloudFolderPath } from '~/fileSync/folderPaths';
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
	persistConfigurationDrafts,
	readConfigurationDrafts,
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
type ConnectionProgress = ForegroundSyncProgress & { photoQueue?: PhotoQueueProgress };

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
			return { raw, drafts: readConfigurationDrafts(raw, scope.deviceId), error: '' };
		} catch (cause) {
			return { raw: null, drafts: [] as ConfigurationDraft[], error: cause instanceof Error ? cause.message : 'Device draft storage is unavailable.' };
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
	const [draft, setDraft] = useState<ConfigurationDraft | null>(null);
	const draftJournalCurrent = useRef(true);
	const retainedDrafts = useRef(new Map<string, ConfigurationDraft>(initial.drafts.map(draft => [draft.id, draft])));
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
	const [transfers, setTransfers] = useState<Record<string, ConnectionProgress>>({});
	const [progressDescriptors, setProgressDescriptors] = useState<Record<string, SyncProgressDescriptor | undefined>>({});
	const [inventoryDescriptors, setInventoryDescriptors] = useState<Record<string, SyncInventoryDescriptor | undefined>>({});
	const [activeTransfer, setActiveTransfer] = useState<string | null>(null);
	const [transferErrors, setTransferErrors] = useState<Record<string, string>>({});
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
	const [folders, setFolders] = useState<CloudFolderPath[]>([]);
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
		assertCurrent();
		const retained = new Map(retainedDrafts.current);
		if (next) retained.set(next.id, next);
		else if (draft) retained.delete(draft.id);
		raw.current = persistConfigurationDrafts(window.localStorage, key, raw.current, [...retained.values()]);
		retainedDrafts.current = retained;
		setDraft(next);
		if (!next) setSelectedId(null);
		setStorageError('');
	};
	const cache = (next: SavedFileSyncConfiguration[]) => {
		setConnections(next);
		writeStampedCache(cacheKey, next);
		pruneCacheNamespace('tt:sync-connections:', cacheKey, 32);
	};
	const run = async (work: (assertActive: () => void) => Promise<void>, connectionId?: string) => {
		if (controller.current) return;
		const active = new AbortController();
		controller.current = active;
		setBusy(true);
		setError('');
		setNotice('');
		if (connectionId) setTransferErrors(previous => ({ ...previous, [connectionId]: '' }));
		try {
			assertCurrent();
			await work(() => {
				active.signal.throwIfAborted();
				assertCurrent();
			});
		} catch (cause) {
			if (mounted.current && !active.signal.aborted) {
				const message = cause instanceof Error ? cause.message : 'Connection unavailable. Try again.';
				if (connectionId) setTransferErrors(previous => ({ ...previous, [connectionId]: message }));
				else setError(message);
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
						const paths = await cloudFolderPaths(result.things, scope.ownerId, async id => (await apiRef.current.v1.things.get({ id }, options())).thing, assertCurrent);
			assertCurrent();
			setFolders((previous) => [...new Map([...(cursor ? previous : []), ...paths].map(row => [row.id, row])).values()]);
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
				draftJournalCurrent.current = false;
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
		setResourceDraftValid(resourceValidity.current.get(next.id) ?? true);
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
	const transfer = (requested: SavedFileSyncConfiguration) => {
		void run(async (assertActive) => {
            const saved = await prepareExplicitSyncStart(requested, scope, {
                assertCurrent: assertActive,
                hasDraft: id => !draftJournalCurrent.current || retainedDrafts.current.has(id),
                get: async id => (await apiRef.current.v1.things.get({ id }, options())).thing,
                update: async (id, configuration, expectedUpdatedAt) => (await apiRef.current.v1.things.update({ id, crystal: { paused: configuration.paused }, expectedUpdatedAt }, options())).thing
            });
            assertActive();
            cache(connections.map(row => row.id === saved.id ? saved : row));
            if (appOwned) {
                void startNativeSyncTask(saved, { ...scope, rootId: saved.id }, generation).catch(cause => {
                    if (mounted.current && !rootIdentity.read().pending && rootIdentity.read().generation === generation && runtimeOrigin() === scope.origin) {
                        const message = cause instanceof Error ? cause.message : 'Transfer could not start.';
                        setTransferErrors(previous => ({ ...previous, [saved.id]: message }));
                    }
                });
                return;
            }
			const active = controller.current!,
				syncScope = { ...scope, rootId: saved.id };
			transferSession.current?.session.stop();
			const speeds = createTransferActivitySession(); transferSession.current = { id: saved.id, session: speeds };
			setProgressDescriptors(previous => ({ ...previous, [saved.id]: undefined }));
			writeStampedCache('tt:sync-progress-tree:' + syncScopeKey(syncScope), null);
			setInventoryDescriptors(previous => ({ ...previous, [saved.id]: undefined }));
			writeStampedCache('tt:sync-inventory:' + syncScopeKey(syncScope), null);
			let latestProgress: ForegroundSyncProgress = { stage: 'checking', confirmed: 0, total: 0 };
			const publish = (value: ConnectionProgress) => {
				assertActive();
				latestProgress = value;
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
								inventorySession: (descriptor: SyncInventoryDescriptor) => {
                                    assertActive(); setInventoryDescriptors(previous => ({ ...previous, [saved.id]: descriptor }));
                                    const cacheKey = 'tt:sync-inventory:' + syncScopeKey(syncScope);
                                    writeStampedCache(cacheKey, descriptor); pruneCacheNamespace('tt:sync-inventory:', cacheKey, 32);
                                },
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
						waiting: cause instanceof SyncConditionsWait,
						message: cause instanceof Error ? cause.message : 'Transfer interrupted. Retry to recover saved work.'
					});
			} finally {
				speeds.stop();
				journal?.close();
				if (mounted.current) setActiveTransfer(null);
			}
		}, requested.id);
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
                if (!draft.configuration.localRootId) throw Error('Choose a device folder first.');
                const result = await apiRef.current.v1.deviceFolders.resolve({ deviceId: scope.deviceId, connectionId: draft.id, name: roots.find(root => root.id === draft.configuration.localRootId)?.name || (draft.configuration.sourceKind === 'photos' ? 'Photo Library' : draft.configuration.name) }, options());
                const destination = result.folder as CloudFolderPath;
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
					<Button size="sm" minHeight="40px" variant="outline" isDisabled={!ready || busy || !!storageError || !roots.length} onClick={start}>
						Add connection
					</Button>
				</Flex>
			</Flex>
			<Text fontSize="12px" color="var(--tt-muted, #71717a)">
				{appOwned && !host ? 'You can leave this screen while Thingtime stays open. iOS may let the current upload finish in the background. Open Thingtime to continue saved work with the same account and folder access. Pause sync keeps a job paused until you resume it.' : appOwned ? 'Started transfers continue when you leave this screen or close the Mac window. Reopen this connection to review conflicts or stop a transfer. Quitting interrupts transfers; unfinished jobs resume when you reopen Thingtime with the same account and access. Stop transfer keeps a job paused until you retry.' :
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
				const progress: ConnectionProgress | null = task?.progress ?? transfers[saved.id] ?? readStampedCache<ConnectionProgress>(progressKey(saved.id));
				const running = !!task?.active || (viewBusy && activeTransfer === saved.id);
				const waiting = task?.waiting ?? progress?.waiting ?? false;
				const taskPaused = task?.status === 'paused' && !waiting;
				const runError = !running && !waiting && (transferErrors[saved.id] ||
					(task?.status === 'error' || (!task && progress?.message && !['complete', 'retained'].includes(progress.stage))
						? progress?.message || 'Sync needs attention. Retry this connection.' : ''));
				const nativeRoot = roots.find((root) => root.id === saved.configuration.localRootId);
				const photos = saved.configuration.sourceKind === 'photos' || nativeRoot?.sourceKind === 'photos';
				const preparation = photos && running && !waiting && !task?.stopping ? photoDownloadPreparation(progress?.photoDownload) : undefined;
				const photoQueue = photos && rootsReady && nativeRoot ? photoQueueDisplay(progress?.photoQueue) : undefined;
				const downloading = saved.configuration.mode === 'download';
				const twoWay = saved.configuration.mode === 'two-way';
				const wifiWait = waiting && saved.configuration.network === 'wifi' &&
					(progress?.message === 'Waiting for the selected network.' || progress?.message?.startsWith('Waiting for Wi-Fi.'));
				const statusProgress = wifiWait && progress
					? { ...progress, message: 'Waiting for Wi-Fi. Connect to Wi-Fi to continue. To allow mobile data, open Edit → Transfer options → Network.' } : progress;
				const actionLabel = running ? task?.stopping ? 'Pausing…' : 'Pause sync' :
					saved.configuration.paused ? saved.configuration.mode === 'backup' ? 'Start backup' : 'Resume sync' :
					waiting ? 'Check again' : taskPaused ? 'Resume sync' :
					runError || (progress && !['complete', 'retained'].includes(progress.stage)) ? 'Retry transfer' :
					twoWay ? 'Sync now' : downloading ? 'Download now' : saved.configuration.mode === 'backup' ? 'Start backup' : 'Upload now';
				const progressScope = { ...scope, rootId: saved.id };
				const progressDescriptor = task ? task.progressDescriptor : progressDescriptors[saved.id] ?? (!running
					? readStampedCache<SyncProgressDescriptor>('tt:sync-progress-tree:' + syncScopeKey(progressScope)) ?? undefined : undefined);
				const inventoryDescriptor = task ? task.inventoryDescriptor : inventoryDescriptors[saved.id] ?? (!running
                    ? readStampedCache<SyncInventoryDescriptor>('tt:sync-inventory:' + syncScopeKey(progressScope)) ?? undefined : undefined);
				if (!speedDrafts.current.has(saved.id)) speedDrafts.current.set(saved.id, {});
				if (!priorityDrafts.current.has(saved.id)) priorityDrafts.current.set(saved.id, {});
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
					roots.some((root) => root.id === saved.configuration.localRootId);
				return (
					<SyncFolderCard key={saved.id} title={saved.configuration.name} editorSlotId={`${editorPrefix}-${saved.id}`} scopeKey={`${key}:${generation}:${saved.id}`} accountTransport={reviewTransport}
						path={(nativeRoot?.sourceKind === 'photos' || saved.configuration.sourceKind === 'photos' ? nativeRoot?.name || 'Photo Library' : undefined) || (supportsNativeSourcePaths(capabilities) && validNativeSourcePath(nativeRoot?.sourcePath) && nativeRoot?.sourceKind !== 'photos' ? nativeRoot.sourcePath : undefined) || (nativeRoot ? 'Folder path unavailable' : 'Folder access missing')}
                        destination={folders.find(folder => folder.id === saved.configuration.remoteFolderId)?.path || 'Cloud destination unavailable · refresh folders'}
                        error={runError || ''}
                        preparation={preparation}
                        photoQueue={photoQueue}
                        quickAction={{ label: actionLabel,
                            disabled: running ? !!task?.stopping : !allowed || busy || retainedDrafts.current.has(saved.id) || !ready,
                            run: () => { if (running) { if (task?.active) return pauseNativeSyncJob(task.scope, generation).catch(cause => setError(cause instanceof Error ? cause.message : 'Pause could not be saved.')); controller.current?.abort(); } else transfer(saved); }
                        }}
						description={saved.configuration.mode === 'backup' ? 'Backup to cloud · keep deleted files' : twoWay ? 'Two-way sync' : downloading ? 'Cloud to device' : 'Device to cloud'}
						glance={syncConnectionGlance({ deviceLabel: capabilities?.platform === 'ios' ? 'iPhone' : capabilities?.platform === 'android' ? 'Device' : 'Mac', progress, online: rootsReady, active: running, paused: saved.configuration.paused || taskPaused, waiting, preparing: !!preparation, mode: saved.configuration.mode, ...(task?.transferSeries ? { rates: { upload: task.transferSeries.read({ direction: 'upload', unit: 'Mbps', windowMs: 5000 }), download: task.transferSeries.read({ direction: 'download', unit: 'Mbps', windowMs: 5000 }) } } : {}) })}
                        stats={preparation ? '' : syncFolderActivityLabel({ paused: saved.configuration.paused, rootsReady, hasRoot: !!nativeRoot,
                            taskPaused, running, waiting, failed: !!runError, stopping: task?.stopping, progress: statusProgress, photos })}
						expanded={selectedId === saved.id} onToggle={expanded => { if (expanded) { if (!viewBusy && ready && !storageError) { setSelectedId(saved.id); if (retainedDrafts.current.has(saved.id)) open(saved.id); } } else if (selectedId === saved.id) setSelectedId(null); }}>
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
								{rootsReady && !sourceAllowed
									? 'Source access or backup policy needs review'
									: !supported
									? downloading || twoWay
										? 'Downloads and two-way sync need folder approval and an updated app for recoverable deletions'
										: 'This direction is not available yet'
									: !supportsMobileSyncConditions(capabilities)
									? 'Update this app to transfer files'
									: !rootsReady || running || saved.configuration.paused || taskPaused || waiting || runError ? null : twoWay
									? 'Ready for two-way sync with folder approval'
									: downloading
									? 'Ready to download with folder approval'
										: appOwned ? 'Ready to upload' : 'Ready for a foreground upload'}
								{rootsReady && !nativeRoot ? ' · Folder access missing' : ''}
							</Text>
							{running && progress?.path && progress.stage === 'transferring' && (
								<Text fontSize="12px" marginTop={1} overflowWrap="anywhere">
									{progress.path}: {Math.round(((progress.bytes ?? 0) / Math.max(1, progress.size ?? 1)) * 100)}%
								</Text>
							)}
							{progress?.stage === 'retained' && (
								<Button as="a" href="/history?storage=home&kind=file" size="xs" variant="link" mt={2}>
									View saved versions
								</Button>
							)}
						</Box>
						<Button size="sm" minHeight="40px" variant="outline" isDisabled={viewBusy || !!storageError || !ready} onClick={() => open(saved.id)}>
							Edit
						</Button>

						{active && selectedId === saved.id && appOwned && !!host && <Box width="100%" minW={0}>
							<SyncDetailsSection title="Automatic sync"><DesktopSyncAutomation saved={saved} scope={{ ...scope, rootId: saved.id }} generation={generation}
								disabled={!allowed || saved.configuration.paused || retainedDrafts.current.has(saved.id) || !ready} accountTransport={reviewTransport} intervalDraft={intervalDrafts[saved.id]} onIntervalDraftChange={value => setIntervalDrafts(previous => ({ ...previous, [saved.id]: value }))} /></SyncDetailsSection>
						</Box>}
						{active && selectedId === saved.id && (host || capabilities?.platform === 'ios') && (progress || progressDescriptor) && <Box width="100%" minW={0}>
							<SyncDetailsSection title="Progress, speed and priorities"><SyncProgressViewer speedDraftState={speedDrafts.current.get(saved.id)} scopeKey={`${key}:${generation}:${saved.id}`} descriptor={progressDescriptor}
								uploadPriorities={!downloading ? { draftState: priorityDrafts.current.get(saved.id), scope: progressScope, excludedPaths: saved.configuration.excludedPaths, ignoreRules: saved.configuration.ignoreRules } : undefined}
								series={task?.transferSeries ?? (transferSession.current?.id === saved.id ? transferSession.current.session.series : undefined)}
								progress={progress ?? undefined} status={task?.status ?? (running ? 'running' : progress?.stage === 'complete' ? 'complete' : progress?.message && progress.stage !== 'retained' ? 'error' : 'paused')}
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
                    summary="Draft · no transfer started" open={selectedId === row.id} onToggle={expanded => { if (expanded) { if (!viewBusy && ready && !storageError) open(row.id); } else if (selectedId === row.id) setSelectedId(null); }}><Text fontSize="13px">Continue editing this draft below.</Text></SettingsSection>
            ))}
			{[...retainedDrafts.current.values()].map(draft => (
				<SyncEditorPlacement key={draft.id} targetId={connections.some(saved => saved.id === draft.id) ? `${editorPrefix}-${draft.id}` : undefined}><Box hidden={selectedId !== draft.id} marginTop={4} border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={3}>
					<SyncConfigurationForm iosManagedResources={iosManagedSyncResources(capabilities)} sourcePathsAvailable={supportsNativeSourcePaths(capabilities)} draft={draft} roots={roots} folders={folders} disabled={viewBusy || draft.pending || !ready} scopeKey={`${key}:${generation}:${draft.id}`} accountTransport={reviewTransport} onChange={edit} onResourceDraftChange={resourceDraft => { const latest = retainedDrafts.current.get(draft.id); if (latest) edit({ ...latest, resourceDraft }); }} onResourceValidityChange={valid => { resourceValidity.current.set(draft.id, valid); if (selectedId === draft.id) setResourceDraftValid(valid); }} />
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
							<SyncConfigurationForm iosManagedResources={iosManagedSyncResources(capabilities)}
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
	onResourceDraftChange,
	iosManagedResources = false
}: {
	iosManagedResources?: boolean;
	sourcePathsAvailable?: boolean;
	draft: ConfigurationDraft;
	roots: MobileFolder[];
	folders: CloudFolderPath[];
	disabled: boolean;
	scopeKey?: string;
	accountTransport?: Parameters<typeof SyncIgnoreRulesEditor>[0]['accountTransport'];
	onChange(draft: ConfigurationDraft): void;
	onResourceValidityChange?(valid: boolean): void;
	onResourceDraftChange?(draft: NonNullable<ConfigurationDraft['resourceDraft']>): void;
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
					{photoAccessDescription(selectedRoot)}.
				</Text>
			)}
            <SyncDestinationControl sourceName={selectedRoot?.name || (photos ? 'Photo Library' : c.name)} draft={draft} folders={folders} disabled={disabled} scopeKey={scopeKey} accountTransport={accountTransport} onChange={remoteFolderId => change({ remoteFolderId })} />
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
			<SyncResourceControls key={draft.baseUpdatedAt ?? 'new'} initialDraft={draft.resourceDraft} onDraftChange={onResourceDraftChange} onValidityChange={onResourceValidityChange} resourceLimits={c.resourceLimits} availabilityStatus={iosManagedResources ? IOS_SYNC_RESOURCE_STATUS : photos ? 'Native resource controls are unavailable for this photo source.' : ''} disabled={disabled || photos || iosManagedResources} scopeKey={scopeKey ?? `${draft.id}:${c.deviceId}`} accountTransport={accountTransport}
				onChange={resourceLimits => change({ resourceLimits, configurationVersion: resourceLimits ? 3 : c.ignoreRules ? 2 : 1 })} />
			</Box>
		</Stack>
	);
}
