import { iosManagedSyncResources, IOS_SYNC_RESOURCE_STATUS } from './deviceSyncResourceDisplay';
import { activityManager } from '~/activity/activityManager';
import { prepareExplicitSyncStart } from '~/fileSync/configurationStart';
import { SyncDestinationControl } from './SyncDestinationControl';
import { hasSavedSyncDraft, observeSavedSyncConnections, publishSavedSyncConnection, reconcileSavedSyncList } from './savedSyncConnectionUpdates';
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
import { PhotoAutomationControls } from './PhotoAutomationControls';
import { photoSyncScheduleLabel, photoSyncWaitingMessage, usePhotoSyncJobs } from './photoSyncPresentation';
import { nativePhotoCanContinue, nativePhotoRunActive, nativePhotoRunGlance, nativePhotoRunLabel, nativePhotoRunSchedule, useNativePhotoRunProgress } from './nativePhotoRunView';
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
	supportsNativePhotoAutomation,
	supportsSoleNativePhotoRun,
	supportsNativePhotoContinuation,
	requestNativePhotoBackground,
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
import { newFileSyncConfiguration, FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS, FILE_SYNC_RESOURCE_REQUIREMENTS, type FileSyncConfiguration } from '~/fileSync/configuration';
import { SYNC_JOBS_CHANGED_EVENT } from '~/fileSync/syncJobJournal';
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

type ConnectionsProps = { ownerId: string; deviceId: string; roots: MobileFolder[]; rootsReady?: boolean; host?: FolderHost; active?: boolean; onNativePhotoActivity?(active: boolean): void };
export function MobileSyncConnections({ ownerId, deviceId, roots, rootsReady = true, host, active = true, onNativePhotoActivity }: ConnectionsProps) {
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
			onNativePhotoActivity={onNativePhotoActivity}
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
	host,
	onNativePhotoActivity
}: {
	scope: ConfigurationEditorScope;
	generation: number;
	roots: MobileFolder[];
	rootsReady: boolean;
	active: boolean;
	host?: FolderHost;
	onNativePhotoActivity?(active: boolean): void;
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
	const photoAutomation = appOwned && supportsNativePhotoAutomation(capabilities);
	const soleNativePhotoRun = photoAutomation && !host && supportsSoleNativePhotoRun(capabilities);
	const photoContinuation = soleNativePhotoRun && supportsNativePhotoContinuation(capabilities);
	const automaticEnabled = useSyncExternalStore(activityManager.subscribe,
		() => activityManager.enabled('sync.automation') && activityManager.enabled('sync.execution'), () => true);
	const photoJobs = usePhotoSyncJobs(scope, generation, photoAutomation && !soleNativePhotoRun);
	const pauseRequests = useRef(new Map<string, AbortController>());
	const continuationRequests = useRef(new Map<string, AbortController>());
	const [pausingIds, setPausingIds] = useState<string[]>([]);
	const [continuations, setContinuations] = useState<Record<string, { revision: string; pending: boolean; status: string }>>({});
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
	const nativePhotoRuns = useNativePhotoRunProgress(scope, generation, active && soleNativePhotoRun, connections);
	const nativePhotoTransferActive = soleNativePhotoRun && connections.some(row => {
		const view = nativePhotoRuns.get(row.id);
		return view?.revision === row.updatedAt && nativePhotoRunActive(view);
	});
	useEffect(() => { onNativePhotoActivity?.(nativePhotoTransferActive); }, [onNativePhotoActivity, nativePhotoTransferActive]);
	useEffect(() => () => onNativePhotoActivity?.(false), [onNativePhotoActivity]);
	const busy = viewBusy || (appOwned && !!nativeTask?.active) || nativePhotoTransferActive;
	const connectionsRef = useRef(connections);
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
		connectionsRef.current = next;
		setConnections(next);
		writeStampedCache(cacheKey, next);
		pruneCacheNamespace('tt:sync-connections:', cacheKey, 32);
	};
	const remember = (saved: SavedFileSyncConfiguration) => {
		const rows = connectionsRef.current;
		const current = rows.find(row => row.id === saved.id);
		if (current && Date.parse(current.updatedAt) > Date.parse(saved.updatedAt)) return false;
		cache(current ? rows.map(row => row.id === saved.id ? saved : row) : [saved, ...rows]);
		return true;
	};
	const acceptSave = (saved: SavedFileSyncConfiguration) => {
		if (remember(saved)) publishSavedSyncConnection(scope, generation, saved);
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
		const before = connectionsRef.current;
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
			cache(reconcileSavedSyncList(before, connectionsRef.current, accepted, !!cursor));
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
		const unsubscribe = observeSavedSyncConnections(scope, generation, saved => {
			const identity = rootIdentity.read();
			if (mounted.current && !identity.pending && identity.generation === generation && runtimeOrigin() === scope.origin) remember(saved);
		});
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
			unsubscribe();
			for (const pause of pauseRequests.current.values()) pause.abort();
			pauseRequests.current.clear();
			for (const request of continuationRequests.current.values()) request.abort();
			continuationRequests.current.clear();
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
	const continuePhotoInBackground = async (saved: SavedFileSyncConfiguration) => {
		const id = saved.id;
		const view = nativePhotoRuns.get(id);
		if (!photoContinuation || view?.revision !== saved.updatedAt || !nativePhotoCanContinue(view) ||
			saved.configuration.paused || pauseRequests.current.has(id) || continuationRequests.current.has(id)) return;
		const request = new AbortController();
		const current = () => {
			const identity = rootIdentity.read();
			return !request.signal.aborted && mounted.current && !identity.pending && identity.generation === generation &&
				window.location.origin === scope.origin && document.visibilityState === 'visible' &&
				connectionsRef.current.some(row => row.id === id && row.updatedAt === saved.updatedAt);
		};
		if (!current()) return;
		continuationRequests.current.set(id, request);
		const publish = (status: string, pending = false) => {
			if (current()) setContinuations(previous => ({ ...previous, [id]: { revision: saved.updatedAt, status, pending } }));
		};
		publish('', true);
		try {
			const result = await requestNativePhotoBackground(scope.ownerId, {
				rootId: saved.configuration.localRootId, configurationId: id, configurationRevision: saved.updatedAt, deviceId: scope.deviceId
			}, request.signal);
			publish(result.status === 'active' && result.requested ? 'Background processing requested for this backup.' :
				result.status === 'complete' ? 'This backup is up to date.' :
				result.status === 'waiting' ? 'This backup is waiting for its saved transfer conditions.' :
				'iOS didn’t start background processing. You can keep Thingtime open or try again.');
		} catch (cause) {
			publish(cause instanceof Error ? cause.message : 'Background processing could not be confirmed.');
		} finally {
			if (continuationRequests.current.get(id) === request) continuationRequests.current.delete(id);
			// The native status request refreshes after visibility or a native hint.
			if (!request.signal.aborted && mounted.current && rootIdentity.read().generation === generation) {
				setContinuations(previous => previous[id]?.revision === saved.updatedAt && previous[id].pending ?
					{ ...previous, [id]: { ...previous[id], pending: false } } : previous);
			}
		}
	};
	const pausePhotoAutomation = async (id: string) => {
		const reviewed = connectionsRef.current.find(row => row.id === id);
		if (!reviewed || pauseRequests.current.has(id)) return;
		const request = new AbortController();
		pauseRequests.current.set(id, request);
		setPausingIds(ids => [...ids, id]);
		setTransferErrors(previous => ({ ...previous, [id]: '' }));
		const current = () => {
			const identity = rootIdentity.read();
			return !request.signal.aborted && mounted.current && !identity.pending &&
				identity.generation === generation && runtimeOrigin() === scope.origin;
		};
		const check = () => { if (!current()) throw Error('The account or device changed.'); };
		const transport = { expectedApiOrigin: scope.origin, expectedActor: scope.ownerId, expectedDataPlane: scope.dataPlane, signal: request.signal };
		let localPaused = false, accountPaused = false;
		try {
			check();
			// Stop current device work first, independently of view refresh or a draft.
			const cleanupError = await pauseNativeSyncJob({ ...scope, rootId: id }, generation, reviewed).then(() => {
				localPaused = true;
				return null;
			}, cause => cause);
			check();
			const read = async () => {
				const response = await apiRef.current.v1.things.get({ id }, transport);
				check();
				const saved = readOwnedFileSyncConfiguration(response.thing, scope.ownerId);
				if (saved.id !== id || saved.configuration.deviceId !== scope.deviceId || saved.configuration.sourceKind !== 'photos')
					throw Error('This Photos connection changed. Refresh saved settings before pausing it.');
				return saved;
			};
			const saved = await read();
			if (saved.configuration.photoAutomation) {
				for (const [feature, minimum] of Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS)) await requireCapability(feature, minimum);
			}
			check();
			if (!saved.configuration.paused) {
				await apiRef.current.v1.things.update({ id, crystal: { paused: true }, expectedUpdatedAt: saved.updatedAt }, transport);
				check();
				const confirmed = await read();
				if (!confirmed.configuration.paused) throw Error('The account could not confirm the pause. Check the saved connection before continuing.');
				acceptSave(confirmed);
			} else acceptSave(saved);
			accountPaused = true;
			if (cleanupError) throw cleanupError;
		} catch (cause) {
			const message = localPaused && !accountPaused ? 'Backup is paused on this iPhone. The account could not confirm the pause.' :
				cause instanceof Error ? cause.message : 'Could not confirm the pause.';
			if (current()) setTransferErrors(previous => ({ ...previous, [id]: message }));
		} finally {
			if (pauseRequests.current.get(id) === request) {
				pauseRequests.current.delete(id);
				if (current()) setPausingIds(ids => ids.filter(currentId => currentId !== id));
			}
		}
	};
	const transfer = (id: string) => {
		void run(async (assertActive) => {
			const requested = connectionsRef.current.find(row => row.id === id);
			if (!requested) throw Error('Refresh this device’s connections before continuing.');
            const saved = await prepareExplicitSyncStart(requested, scope, {
                assertCurrent: assertActive,
                hasDraft: id => !draftJournalCurrent.current || retainedDrafts.current.has(id) || hasSavedSyncDraft(scope, id),
                get: async id => {
                    const value = (await apiRef.current.v1.things.get({ id }, { ...options(), expectedApiOrigin: scope.origin })).thing;
                    assertActive();
                    const current = readOwnedFileSyncConfiguration(value, scope.ownerId);
                    if (current.id === id && current.configuration.deviceId === scope.deviceId && !remember(current))
                        throw Error('This connection changed elsewhere. Review its saved settings before starting. No transfer was started.');
                    return value;
                },
                update: async (id, configuration, expectedUpdatedAt) => (await apiRef.current.v1.things.update({ id, crystal: { paused: configuration.paused }, expectedUpdatedAt }, { ...options(), expectedApiOrigin: scope.origin })).thing
            });
            assertActive();
            acceptSave(saved);
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
		}, id);
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
			if (pending.configuration.photoAutomation) {
				for (const [feature, minimum] of Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS)) await requireCapability(feature, minimum);
				assertCurrent();
			}
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
			acceptSave(saved);
			if (photoAutomation && saved.configuration.sourceKind === 'photos') window.dispatchEvent(new Event(SYNC_JOBS_CHANGED_EVENT));
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
				{photoAutomation ? 'Enabled Photos backups resume when you open Thingtime and check again every 5 minutes while it’s open. iOS chooses when to allow background work. Your network, charging, upload limits, and pauses still apply.' : appOwned && !host ? 'You can leave this screen while Thingtime stays open. iOS may let the current upload finish in the background. Open Thingtime to continue saved work with the same account and folder access. Pause sync keeps a job paused until you resume it.' : appOwned ? 'Started transfers continue when you leave this screen or close the Mac window. Reopen this connection to review conflicts or stop a transfer. Quitting interrupts transfers; unfinished jobs resume when you reopen Thingtime with the same account and access. Stop transfer keeps a job paused until you retry.' :
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
				const automatic = photoAutomation && saved.configuration.sourceKind === 'photos';
				const nativeOwns = soleNativePhotoRun && automatic;
				const observed = nativeOwns ? nativePhotoRuns.get(saved.id) : undefined;
				const nativeRun = observed?.revision === saved.updatedAt ? observed : undefined;
				const nativeProgress = nativeRun?.progress;
				const continuation = continuations[saved.id]?.revision === saved.updatedAt ? continuations[saved.id] : undefined;
				const continuationHeld = nativeProgress?.continuation === 'held';
				const continuationActive = nativeProgress?.continuation === 'active';
				const job = automatic && !nativeOwns ? photoJobs[saved.id] : undefined;
				const currentJob = job?.reviewed.updatedAt === saved.updatedAt ? job : undefined;
				const pausing = pausingIds.includes(saved.id);
				const task = !nativeOwns && ownNativeTask?.scope.rootId === saved.id ? ownNativeTask : null;
				const progress: ConnectionProgress | null = nativeOwns ? null : task?.progress ?? transfers[saved.id] ?? readStampedCache<ConnectionProgress>(progressKey(saved.id));
				const running = nativeOwns ? nativePhotoRunActive(nativeRun) : !!task?.active || (viewBusy && activeTransfer === saved.id);
				const taskPaused = nativeOwns ? nativeProgress?.stage === 'paused' || continuationHeld : job?.state === 'paused' || (task?.status === 'paused' && !task.waiting);
				const paused = saved.configuration.paused || taskPaused;
				const jobWaiting = !running && !paused ? photoSyncWaitingMessage(currentJob?.waitReason, currentJob?.minimumPartBytes) : '';
				const waiting = !paused && (nativeOwns ? nativeProgress?.stage === 'waiting' : (task?.waiting ?? (!!jobWaiting || progress?.waiting === true)));
				const runError = transferErrors[saved.id] || (!running && !waiting && !paused &&
					(task?.status === 'error' || currentJob?.state === 'attention' || (!task && progress?.message && !['complete', 'retained'].includes(progress.stage))
						? progress?.message || 'Sync needs attention. Retry this connection.' : ''));
				const nativeRoot = roots.find((root) => root.id === saved.configuration.localRootId);
				const photos = saved.configuration.sourceKind === 'photos' || nativeRoot?.sourceKind === 'photos';
				const preparation = photos && running && !waiting && !task?.stopping ? photoDownloadPreparation(progress?.photoDownload) : undefined;
				const nativeQueue = nativeProgress && (nativeProgress.pendingOriginals !== undefined || nativeProgress.unavailableOriginals !== undefined)
					? { pending: nativeProgress.pendingOriginals ?? 0, unavailable: nativeProgress.unavailableOriginals ?? 0 } : undefined;
				const photoQueue = photos && rootsReady && nativeRoot ? photoQueueDisplay(nativeOwns ? nativeQueue : progress?.photoQueue) : undefined;
				const downloading = saved.configuration.mode === 'download';
				const twoWay = saved.configuration.mode === 'two-way';
				const wifiWait = waiting && saved.configuration.network === 'wifi' &&
					(progress?.message === 'Waiting for the selected network.' || progress?.message?.startsWith('Waiting for Wi-Fi.'));
				const statusMessage = wifiWait ? photoSyncWaitingMessage('wifi') : jobWaiting;
				const statusProgress = statusMessage ? { stage: 'checking' as const, confirmed: 0, total: 0, ...progress, message: statusMessage } : progress;
				const automaticallyWaiting = nativeOwns ? nativeProgress?.stage === 'ready' || (waiting && nativeProgress?.syncWait === 'data-budget') :
					automaticEnabled && waiting && (currentJob?.waitReason === 'inactive' ||
					(currentJob?.waitReason === 'data-budget' && (currentJob.minimumPartBytes !== undefined || (currentJob.retryAt ?? Infinity) > Date.now())));
				const actionLabel = pausing || task?.stopping ? 'Pausing…' : running ? 'Pause sync' :
					automatic && paused ? 'Resume automatic backup' :
					saved.configuration.paused ? saved.configuration.mode === 'backup' ? 'Start backup' : 'Resume sync' :
					waiting ? 'Check again' : taskPaused ? 'Resume sync' :
					runError || nativeProgress?.stage === 'needs-review' || (progress && !['complete', 'retained'].includes(progress.stage)) ? 'Retry transfer' :
					automatic ? 'Back up now' : twoWay ? 'Sync now' : downloading ? 'Download now' : saved.configuration.mode === 'backup' ? 'Start backup' : 'Upload now';
				const progressScope = { ...scope, rootId: saved.id };
				const progressDescriptor = nativeOwns ? undefined : task ? task.progressDescriptor : progressDescriptors[saved.id] ?? (!running
					? readStampedCache<SyncProgressDescriptor>('tt:sync-progress-tree:' + syncScopeKey(progressScope)) ?? undefined : undefined);
				const inventoryDescriptor = nativeOwns ? undefined : task ? task.inventoryDescriptor : inventoryDescriptors[saved.id] ?? (!running
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
					(!saved.configuration.photoAutomation || automatic) &&
					supported &&
					roots.some((root) => root.id === saved.configuration.localRootId);
				return (
					<SyncFolderCard key={saved.id} title={saved.configuration.name} editorSlotId={`${editorPrefix}-${saved.id}`} scopeKey={`${key}:${generation}:${saved.id}`} accountTransport={reviewTransport}
						path={(nativeRoot?.sourceKind === 'photos' || saved.configuration.sourceKind === 'photos' ? nativeRoot?.name || 'Photo Library' : undefined) || (supportsNativeSourcePaths(capabilities) && validNativeSourcePath(nativeRoot?.sourcePath) && nativeRoot?.sourceKind !== 'photos' ? nativeRoot.sourcePath : undefined) || (nativeRoot ? 'Folder path unavailable' : 'Folder access missing')}
                        destination={folders.find(folder => folder.id === saved.configuration.remoteFolderId)?.path || 'Cloud destination unavailable · refresh folders'}
                        error={runError || ''}
                        preparation={preparation}
                        photoQueue={photoQueue}
                        automation={nativeOwns ? nativePhotoRunSchedule(nativeRun) : automatic ? (!automaticEnabled && !paused ? 'Automatic backup is disabled in Activity manager.' : photoSyncScheduleLabel(currentJob, paused, running, !!runError)) :
                            photos && capabilities?.platform === 'ios' ? 'Update Thingtime on this iPhone to use automatic backup and upload limits.' : undefined}
                        pauseAction={automatic && !running && !paused && !pausing ? { label: 'Pause sync', run: () => pausePhotoAutomation(saved.id) } : undefined}
                        continuationAction={nativeOwns && photoContinuation && !saved.configuration.paused && nativePhotoCanContinue(nativeRun) ? {
                            label: continuation?.pending ? 'Requesting background processing…' : 'Run in Background',
                            disabled: pausing || continuation?.pending,
                            run: () => continuePhotoInBackground(saved)
                        } : undefined}
                        continuationStatus={!nativeOwns || saved.configuration.paused || nativeProgress?.stage === 'complete' ? undefined :
                            continuationActive && !nativeRun?.stale ? 'Continuing this backup with iOS background processing.' :
                            continuationHeld ? undefined : continuation?.status}
                        quickAction={!pausing && automaticallyWaiting ? undefined : { label: actionLabel,
                            disabled: pausing || (running ? !!task?.stopping : !allowed || busy || retainedDrafts.current.has(saved.id) || !ready || (nativeOwns && (!nativeRun || nativeRun.stale))),
                            run: () => {
                                if (running && automatic) return pausePhotoAutomation(saved.id);
                                if (running) { if (task?.active) return pauseNativeSyncJob(task.scope, generation).catch(cause => setError(cause instanceof Error ? cause.message : 'Pause could not be saved.')); controller.current?.abort(); }
                                else transfer(saved.id);
                            }
                        }}
						description={saved.configuration.mode === 'backup' ? 'Backup to cloud · keep deleted files' : twoWay ? 'Two-way sync' : downloading ? 'Cloud to device' : 'Device to cloud'}
						glance={nativeOwns ? nativePhotoRunGlance(nativeRun) : syncConnectionGlance({ deviceLabel: capabilities?.platform === 'ios' ? 'iPhone' : capabilities?.platform === 'android' ? 'Device' : 'Mac', progress, online: rootsReady, active: running, paused, waiting, preparing: !!preparation, mode: saved.configuration.mode, ...(task?.transferSeries ? { rates: { upload: task.transferSeries.read({ direction: 'upload', unit: 'Mbps', windowMs: 5000 }), download: task.transferSeries.read({ direction: 'download', unit: 'Mbps', windowMs: 5000 }) } } : {}) })}
                        stats={nativeOwns ? pausing ? 'Pausing…' : saved.configuration.paused ? 'Paused' : rootsReady && !nativeRoot ? 'Folder access missing' : nativePhotoRunLabel(nativeRun) : preparation ? '' : syncFolderActivityLabel({ paused: saved.configuration.paused || (automatic && taskPaused), rootsReady, hasRoot: !!nativeRoot,
                            taskPaused, running, waiting, failed: !!runError, stopping: pausing || task?.stopping, progress: statusProgress, photos })}
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
									: nativeOwns || !rootsReady || running || saved.configuration.paused || taskPaused || waiting || runError ? null : twoWay
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
					<SyncConfigurationForm photoAutomation={photoAutomation} iosManagedResources={iosManagedSyncResources(capabilities)} sourcePathsAvailable={supportsNativeSourcePaths(capabilities)} draft={draft} roots={roots} folders={folders} disabled={viewBusy || draft.pending || !ready} scopeKey={`${key}:${generation}:${draft.id}`} accountTransport={reviewTransport} onChange={edit} onResourceDraftChange={resourceDraft => { const latest = retainedDrafts.current.get(draft.id); if (latest) edit({ ...latest, resourceDraft }); }} onResourceValidityChange={valid => { resourceValidity.current.set(draft.id, valid); if (selectedId === draft.id) setResourceDraftValid(valid); }} />
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
							<SyncConfigurationForm photoAutomation={photoAutomation} iosManagedResources={iosManagedSyncResources(capabilities)}
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
	iosManagedResources = false,
	photoAutomation = false
}: {
	iosManagedResources?: boolean;
	photoAutomation?: boolean;
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
	const showPhotoControls = photos && (photoAutomation || !!c.photoAutomation);
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
						if (root?.sourceKind !== 'photos' && c.photoAutomation) {
							onChange({ ...draft, photoAutomationDraft: undefined, configuration: {
								...c, localRootId: e.target.value, sourceKind: root?.sourceKind, photoAutomation: undefined,
								configurationVersion: c.resourceLimits ? 3 : c.ignoreRules ? 2 : 1
							} });
							return;
						}
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
				onChange={ignoreRules => change({ configurationVersion: c.photoAutomation ? 4 : c.resourceLimits ? 3 : ignoreRules ? 2 : 1, ignoreRules })} />
			</Stack></Box>
			<Box as="details"><Box as="summary" cursor="pointer" paddingY={2}>Resource limits</Box>
			{showPhotoControls ? <PhotoAutomationControls
				policy={c.photoAutomation} draft={draft.photoAutomationDraft} disabled={disabled || !photoAutomation}
				availability={photoAutomation ? 'Thingtime applies these limits to this Photos backup.' : 'Open the paired iPhone’s Thingtime app to edit these settings.'}
				scopeKey={scopeKey ?? `${draft.id}:${c.deviceId}`} accountTransport={accountTransport}
				onValidityChange={onResourceValidityChange}
				onChange={(photoAutomationDraft, policy) => onChange({ ...draft, photoAutomationDraft,
					configuration: policy ? { ...c, configurationVersion: 4, sourceKind: 'photos', photoAutomation: policy } : c })} />
			: <SyncResourceControls key={draft.baseUpdatedAt ?? 'new'} initialDraft={draft.resourceDraft} onDraftChange={onResourceDraftChange} onValidityChange={onResourceValidityChange} resourceLimits={c.resourceLimits} availabilityStatus={iosManagedResources ? IOS_SYNC_RESOURCE_STATUS : photos ? 'Native resource controls are unavailable for this photo source.' : ''} disabled={disabled || photos || iosManagedResources} scopeKey={scopeKey ?? `${draft.id}:${c.deviceId}`} accountTransport={accountTransport}
				onChange={resourceLimits => change({ resourceLimits, configurationVersion: resourceLimits ? 3 : c.ignoreRules ? 2 : 1 })} />}
			</Box>
		</Stack>
	);
}
