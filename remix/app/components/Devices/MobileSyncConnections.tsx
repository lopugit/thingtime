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
import { newSyncConfigDraft, useRevealNewSyncDraft } from './syncFolderEditor';
import { SyncConfigActivity } from './SyncConfigActivity';
import { syncJobAttentionMessage } from '~/fileSync/syncJobFailure';
import { SyncEditorBlocks, syncConfigBasicsBlocks, syncConfigDirectionBlocks, syncConfigTransferBlocks, syncConfigExclusionBlocks, syncConfigModes, syncConfigEditBlocks, syncFolderEditorBlocks, syncLocalEditorActionBlocks, syncSourceBlocks } from './SyncEditorBlocks';
import type { UploadPriorityDraftState } from './SyncUploadPriorities';
import { supportsNativeSourcePaths, validNativeSourcePath } from '~/fileSync/mobileFolders.client';
import { cloudFolderPaths, type CloudFolderPath } from '~/fileSync/folderPaths';
import { fileSyncDownloadRequirements } from '~/fileSync/signedDownloadTarget';
import { SyncResourceControls } from './SyncResourceControls';
import { PhotoAutomationControls } from './PhotoAutomationControls';
import { photoSyncScheduleLabel, photoSyncWaitingMessage, useSyncJobs } from './photoSyncPresentation';
import { nativePhotoActivityDisplay, nativePhotoBackgroundLabel, nativePhotoCanContinue, nativePhotoRunActive, nativePhotoRunGlance, nativePhotoRunLabel, nativePhotoRunSchedule, useNativePhotoRunProgress } from './nativePhotoRunView';
import { SyncIgnoreRulesEditor } from './SyncIgnoreRulesEditor';
import { readNativeInventory } from '~/fileSync/nativeInventory';
import { enrollNativeFolderSync, nativeSyncTasks, pauseNativeSyncJob, startNativeSyncTask, supportsNativeSyncTasks } from '~/fileSync/nativeSyncTasks.client';
import { nativeUploadMayContinue } from '~/fileSync/nativeUploadBackground';
import { assertPhotoSourcePolicy, photoAccessDescription } from '~/fileSync/photoSourcePolicy';
import { NativeFileRecovery } from './NativeFileRecovery';
import { TIMELINE_CHANGED_EVENT } from '~/timeline/clientEvents';
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { SyncConflictReview } from './SyncConflictReview';
import { SyncDetailsSection } from './SyncDetailsSection';
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
import { Box, Button, Flex, Stack, Text } from '@chakra-ui/react';
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
	type FolderRequest,
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
import { FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS, FILE_SYNC_RESOURCE_REQUIREMENTS, type FileSyncConfiguration } from '~/fileSync/configuration';
import { SYNC_JOBS_CHANGED_EVENT, syncJobEnabled } from '~/fileSync/syncJobJournal';
import { readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import {
	canonicalDraftConfiguration,
	configurationDraftKey,
	claimSyncEnrollment,
	cancelSyncEnrollmentRecovery,
	SYNC_ENROLLMENT_RECOVERED_EVENT,
	SYNC_ENROLLMENT_WAKE_EVENT,
	ConfigurationConflict,
	persistConfigurationDrafts,
	readConfigurationDrafts,
	readPendingSyncEnrollment,
	type SyncEnrollmentIntent,
	saveConfigurationDraft,
	type ConfigurationDraft,
	type ConfigurationEditorScope
} from '~/fileSync/configurationEditor';

type FolderManagement = { run(request: FolderRequest): Promise<void>; busy: boolean; transferring: boolean; error: string; waiting: boolean; checked: Record<string, string>; picked?: MobileFolder };
type ConnectionsProps = { folderManagement?: FolderManagement; ownerId: string; deviceId: string; roots: MobileFolder[]; rootsReady?: boolean; host?: FolderHost; active?: boolean; onNativePhotoActivity?(active: boolean): void };
export function MobileSyncConnections({ ownerId, deviceId, roots, rootsReady = true, host, folderManagement, active = true, onNativePhotoActivity }: ConnectionsProps) {
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
			folderManagement={folderManagement}
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
	folderManagement,
	onNativePhotoActivity
}: {
	scope: ConfigurationEditorScope;
	generation: number;
	roots: MobileFolder[];
	rootsReady: boolean;
	active: boolean;
	host?: FolderHost;
	folderManagement?: FolderManagement;
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
	const syncJobs = useSyncJobs(scope, generation, appOwned, runtimeOrigin);
	const pauseRequests = useRef(new Map<string, AbortController>());
	const continuationRequests = useRef(new Map<string, AbortController>());
	const [pausingIds, setPausingIds] = useState<string[]>([]);
	const [continuations, setContinuations] = useState<Record<string, { revision: string; pending: boolean; status: string }>>({});
	const [draft, setDraft] = useState<ConfigurationDraft | null>(() => initial.drafts.find(row => row.enrollment) ?? null);
	const draftJournalCurrent = useRef(true);
	const retainedDrafts = useRef(new Map<string, ConfigurationDraft>(initial.drafts.map(draft => [draft.id, draft])));
	const [selectedId, setSelectedId] = useState<string | null>(() => initial.drafts.find(row => row.enrollment)?.id ?? null);
	const editorPrefix = useId();
	const revealDraft = useRevealNewSyncDraft(editorPrefix, selectedId, initial.drafts.some(row => row.enrollment));
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
	const [admissionFailed, setAdmissionFailed] = useState<Record<string, boolean>>({});
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
		[loaded, setLoaded] = useState(false),
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
	const persist = (next: ConfigurationDraft | null, clearId = draft?.id, expose = true) => {
		assertCurrent();
		const retained = new Map(retainedDrafts.current);
		if (next) retained.set(next.id, next);
		else if (clearId) retained.delete(clearId);
		raw.current = persistConfigurationDrafts(window.localStorage, key, raw.current, [...retained.values()]);
		retainedDrafts.current = retained;
		if (expose) setDraft(next);
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
			setLoaded(true);
			if (skipped) setNotice('Some shared or invalid sync configs are excluded. You can review them in Things.');
			return result.nextCursor ?? null;
		} else {
						const paths = await cloudFolderPaths(result.things, scope.ownerId, async id => (await apiRef.current.v1.things.get({ id }, { ...options(), storageMode: 'cloud' })).thing, assertCurrent);
			assertCurrent();
			setFolders((previous) => [...new Map([...(cursor ? previous : []), ...paths].map(row => [row.id, row])).values()]);
			setFolderCursor(result.nextCursor ?? null);
		}
		return null;
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
		const recovered = (event: Event) => {
			const detail = (event as CustomEvent<{ key: string; previous: string | null; raw: string | null }>).detail;
			if (detail?.key !== key || detail.previous !== raw.current || window.localStorage.getItem(key) !== detail.raw) return;
			try {
				const next = new Map(readConfigurationDrafts(detail.raw, scope.deviceId).map(row => [row.id, row]));
				raw.current = detail.raw;
				retainedDrafts.current = next;
				setDraft(current => current ? next.get(current.id) ?? null : null);
			} catch { /* Preserve the existing verified draft journal. */ }
		};
		window.addEventListener(SYNC_ENROLLMENT_RECOVERED_EVENT, recovered);
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
			window.removeEventListener(SYNC_ENROLLMENT_RECOVERED_EVENT, recovered);
			if ([...retainedDrafts.current.values()].some(row => row.enrollment)) window.dispatchEvent(new Event(SYNC_ENROLLMENT_WAKE_EVENT));
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
			publish(nativePhotoBackgroundLabel(result.status));
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
				const response = await apiRef.current.v1.things.get({ id }, { ...transport, storageMode: 'cloud' });
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
	const transfer = (id: string, enroll = false) => {
		void run(async (assertActive) => {
			const requested = connectionsRef.current.find(row => row.id === id);
			if (!requested) throw Error('Refresh this device’s connections before continuing.');
            const saved = await prepareExplicitSyncStart(requested, scope, {
                assertCurrent: assertActive,
                hasDraft: id => !draftJournalCurrent.current || retainedDrafts.current.has(id) || hasSavedSyncDraft(scope, id),
                get: async id => {
                    const value = (await apiRef.current.v1.things.get({ id }, { ...options(), expectedApiOrigin: scope.origin, storageMode: 'cloud' })).thing;
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
                if (enroll && saved.configuration.sourceKind !== 'photos') {
                    try {
                        await enrollNativeFolderSync(saved, { ...scope, rootId: saved.id }, generation,
                            intervalDrafts[saved.id] ?? syncJobs[saved.id]?.intervalMs, controller.current?.signal);
                        assertActive(); setAdmissionFailed(previous => ({ ...previous, [saved.id]: false }));
                    } catch (cause) {
                        assertActive(); setAdmissionFailed(previous => ({ ...previous, [saved.id]: true })); throw cause;
                    }
                    return;
                }
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
	const picked = folderManagement?.picked;
	const handledPick = useRef<MobileFolder | undefined>(undefined);
	const add = (root: MobileFolder) => {
		const next = newSyncConfigDraft(root, scope.deviceId, !appOwned || root.sourceKind === 'photos');
		revealDraft(next.id);
		edit(next);
	};
	const discover = async (assertActive: () => void, rootId?: string) => {
		let cursor = await load('connections');
		const seen = new Set<string>();
		while (cursor && (!rootId || !connectionsRef.current.some(row => row.configuration.localRootId === rootId))) {
			if (seen.has(cursor)) throw Error('The sync config list repeated a page. Refresh and try again.');
			seen.add(cursor);
			cursor = await load('connections', cursor);
			assertActive();
		}
	};
	const setUpFolder = (root: MobileFolder) => void run(async check => {
		await discover(check, root.id);
		const existing = connectionsRef.current.find(row => row.configuration.localRootId === root.id);
		const retained = [...retainedDrafts.current.values()].find(row => row.configuration.localRootId === root.id);
		if (retained) edit(retained);
		else if (existing) setSelectedId(existing.id);
		else add(root);
	});
	useEffect(() => {
		if (!picked || handledPick.current === picked || busy || !ready || storageError || !rootsReady) return;
		handledPick.current = picked;
		setUpFolder(picked);
		// The picker publishes a new object only after observing the exact grant.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [picked, busy, ready, storageError, rootsReady]);
	const open = (id: string, replace = false) =>
		void run(async (assertCurrent) => {
			setSelectedId(id);
			setResourceDraftValid(resourceValidity.current.get(id) ?? true);
			const retained = !replace && retainedDrafts.current.get(id);
			if (retained) { persist(retained); setConflict(null); return; }
			const result = await apiRef.current.v1.things.get({ id }, { ...options(), storageMode: 'cloud' });
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
	const verifyDeviceRoot = async (deviceId: string, rootId: string) => {
		await authorizeDevice(deviceId, controller.current!.signal);
		assertCurrent();
		const access = await requestFolders(scope.ownerId, { action: 'list' }, controller.current!.signal);
		assertCurrent();
		if (!access.roots.some(root => root.id === rootId))
			throw Error('Folder access was removed. Restore access to this folder before retrying.');
	};
	const nativeFolderBusy = !!(nativeTask?.active || nativePhotoTransferActive);
	const mobileFolderBusy = !host && nativeFolderBusy;
	const canQueueDraft = (row: ConfigurationDraft) => appOwned && nativeFolderBusy && row.baseUpdatedAt === null &&
		rootsReady && !row.configuration.paused && row.configuration.sourceKind !== 'photos' &&
		roots.some(root => root.id === row.configuration.localRootId);
	const isConfigRunning = (id: string) => activeTransfer === id || (ownNativeTask?.active && ownNativeTask.scope.rootId === id) || nativePhotoRunActive(nativePhotoRuns.get(id));
	const readCloud = async (id: string) => (await apiRef.current.v1.things.get({ id }, { ...options(), storageMode: 'cloud' })).thing;
	const completeEnrollment = async (saved: SavedFileSyncConfiguration, intent: SyncEnrollmentIntent, queue: boolean) => {
		setNotice('Sync config saved. Confirming automatic setup on this device.');
		try {
			const job = await enrollNativeFolderSync(saved, { ...scope, rootId: saved.id }, generation,
				intent.intervalMs, controller.current?.signal, { queue });
			assertCurrent();
			persist(null, saved.id, draft?.id === saved.id);
			setAdmissionFailed(previous => ({ ...previous, [saved.id]: false }));
			setTransferErrors(previous => ({ ...previous, [saved.id]: '' }));
			setNotice(job.pendingFolderValidation ? 'Sync config saved. Folder access will be checked when the device is free.' : 'Sync config saved. Automatic sync is on.');
		} catch (cause) {
			assertCurrent();
			setAdmissionFailed(previous => ({ ...previous, [saved.id]: true }));
			setNotice('Sync config saved. Automatic setup is pending.');
			setTransferErrors(previous => ({ ...previous, [saved.id]: cause instanceof Error ? cause.message : 'Could not start automatic sync.' }));
		}
	};
	const save = (startAfterSave: boolean) =>
		void run(async (assertCurrent) => {
			if (!draft || !ready || isConfigRunning(draft.id)) return;
			const release = startAfterSave ? claimSyncEnrollment(scope) : undefined;
			if (startAfterSave && !release) throw Error('Automatic setup is already being checked.');
			try {
				const deferRootVerification = startAfterSave && canQueueDraft(draft);
				if (mobileFolderBusy && !deferRootVerification && !draft.enrollment?.savedRevision) return;
				const verify = async (deviceId: string, rootId: string) => {
					assertCurrent();
					if (deferRootVerification && deviceId === scope.deviceId && roots.some(root => root.id === rootId)) return;
					await verifyDeviceRoot(deviceId, rootId);
				};
				if (!resourceDraftValid) throw Error('Correct the resource limit fields before saving.');
				if (startAfterSave && (!appOwned || draft.configuration.paused || draft.configuration.sourceKind === 'photos' || scope.dataPlane !== 'home')) throw Error('This sync config cannot start automatically on this device.');
				if (draft.enrollment && !startAfterSave) throw Error('Retry automatic setup, or keep the saved config as it is.');
				const enrollment = startAfterSave ? draft.enrollment ?? { transport: 'local' as const, intervalMs: intervalDrafts[draft.id] ?? syncJobs[draft.id]?.intervalMs ?? 300_000 } : undefined;
				if (enrollment?.savedRevision) {
					const saved = await readPendingSyncEnrollment(draft, scope, { get: readCloud, assertCurrent });
					acceptSave(saved);
					await completeEnrollment(saved, enrollment, deferRootVerification);
					return;
				}
				let prepared = draft;
	            if (draft.baseUpdatedAt === null && !draft.configuration.remoteFolderId) {
	                if (!draft.configuration.localRootId) throw Error('Choose a device folder first.');
	                await verify(scope.deviceId, draft.configuration.localRootId);
	                const result = await apiRef.current.v1.deviceFolders.resolve({ deviceId: scope.deviceId, connectionId: draft.id, name: roots.find(root => root.id === draft.configuration.localRootId)?.name || (draft.configuration.sourceKind === 'photos' ? 'Photo Library' : draft.configuration.name) }, options());
	                const destination = result.folder as CloudFolderPath;
	                assertCurrent();
	                prepared = { ...draft, configuration: { ...draft.configuration, remoteFolderId: destination.id } };
	                persist(prepared); setFolders(previous => [...previous.filter(folder => folder.id !== destination.id), destination]);
	            }
	            const pending = { ...prepared, configuration: canonicalDraftConfiguration(prepared), pending: true, enrollment };
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
						get: readCloud,
						create: (id, configuration) => {
							dispatched = true;
							return apiRef.current.v1.things.create({ shareId: id, thingtime: ['file-sync'], crystal: configuration, acl: ['tt:user'] }, options());
						},
						update: (id, configuration, expectedUpdatedAt) => {
							dispatched = true;
							return apiRef.current.v1.things.update({ id, crystal: configuration, expectedUpdatedAt, replaceCrystal: true }, options());
						},
						verifyDeviceRoot: verify
					});
				} catch (cause) {
					// A first attempt that never reached a mutation can remain editable.
					// A restored pending save may still have an older request in flight.
					assertCurrent();
					if (!draft.pending && !dispatched && !(cause instanceof ConfigurationConflict)) persist(prepared);
					throw cause;
				}
				assertCurrent();
				setConflict(null);
				acceptSave(saved);
				setSelectedId(saved.id);
				if (enrollment) {
					const confirmed = { ...enrollment, savedRevision: saved.updatedAt };
					// Clearing the draft before admission loses the user's explicit
					// request if the app leaves this view at the next await.
					persist({ ...pending, enrollment: confirmed });
					await completeEnrollment(saved, confirmed, deferRootVerification);
				} else {
					persist(null);
					if (photoAutomation && saved.configuration.sourceKind === 'photos') window.dispatchEvent(new Event(SYNC_JOBS_CHANGED_EVENT));
					setNotice('Sync config saved.');
				}
			 } finally { release?.(); }
		});
	const renderHeader = () => <SyncEditorBlocks documentKey="file-sync-folder-editor" title="Folders & sync configs" blocks={syncFolderEditorBlocks}
		scopeKey={key} accountTransport={reviewTransport} scope={{ editor: {
			canChoose: !!folderManagement, chooseDisabled: !rootsReady || !loaded || busy || !!folderManagement?.busy || !!folderManagement?.transferring,
			busy: viewBusy || !!folderManagement?.busy, cold: (viewBusy || folderManagement?.busy) && !roots.length && !connections.length,
			description: appOwned ? 'Choose a folder, then set where its files go. You can add more than one sync config to each folder.' :
				'Choose a folder and set where its files go. This app can run supported transfers while it is open.',
			notice: folderManagement?.waiting ? 'Folder access will refresh when Thingtime is active.' : notice,
			error: storageError || error || folderManagement?.error || ''
		} }} actions={{
			choose: () => { if (rootsReady && loaded && !busy && !folderManagement?.busy && !folderManagement?.transferring) return folderManagement?.run({ action: 'choose' }); },
			refresh: () => void run(async () => {
				await load('connections');
				await load('folders');
				await folderManagement?.run({ action: 'list' });
			})
		}} />;
	const renderSaved = (saved: SavedFileSyncConfiguration) => {
				const automatic = photoAutomation && saved.configuration.sourceKind === 'photos';
				const nativeOwns = soleNativePhotoRun && automatic;
				const observed = nativeOwns ? nativePhotoRuns.get(saved.id) : undefined;
				const nativeRun = observed?.revision === saved.updatedAt ? observed : undefined;
				const nativeProgress = nativeRun?.progress;
				const continuation = continuations[saved.id]?.revision === saved.updatedAt ? continuations[saved.id] : undefined;
				const continuationHeld = nativeProgress?.continuation === 'held';
				const continuationActive = nativeProgress?.continuation === 'active';
				const job = !nativeOwns ? syncJobs[saved.id] : undefined;
				const currentJob = job?.reviewed.updatedAt === saved.updatedAt ? job : undefined;
				const pausing = pausingIds.includes(saved.id);
				const task = !nativeOwns && ownNativeTask?.scope.rootId === saved.id ? ownNativeTask : null;
				const progress: ConnectionProgress | null = nativeOwns ? null : task?.progress ?? transfers[saved.id] ?? readStampedCache<ConnectionProgress>(progressKey(saved.id));
				const running = nativeOwns ? nativePhotoRunActive(nativeRun) : !!task?.active || (viewBusy && activeTransfer === saved.id);
				const taskPaused = nativeOwns ? nativeProgress?.stage === 'paused' || continuationHeld : currentJob?.state === 'paused' || (task?.status === 'paused' && !task.waiting);
				const paused = saved.configuration.paused || taskPaused;
				const admitted = !!currentJob && syncJobEnabled(currentJob);
				const queued = admitted && !!currentJob?.pendingFolderValidation;
				const jobWaiting = !running && !paused ? photoSyncWaitingMessage(currentJob?.waitReason, currentJob?.minimumPartBytes, saved.configuration.sourceKind === 'photos') : '';
				const waiting = !paused && (nativeOwns ? nativeProgress?.stage === 'waiting' : (task?.waiting ?? (!!jobWaiting || (!currentJob && progress?.waiting === true))));
				const runError = transferErrors[saved.id] || (!running && !waiting && !paused &&
					(task?.status === 'error' || currentJob?.state === 'attention' || (!task && !currentJob && progress?.message && !['complete', 'retained'].includes(progress.stage))
						? currentJob?.state === 'attention' ? syncJobAttentionMessage(currentJob) : progress?.message || 'Sync needs attention. Retry this config.' : ''));
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
				const automaticallyWaiting = admitted && !automatic && !running && !paused && !runError ? true : nativeOwns ? nativeProgress?.stage === 'ready' || (waiting && nativeProgress?.syncWait === 'data-budget') :
					automaticEnabled && waiting && (currentJob?.waitReason === 'inactive' ||
					(currentJob?.waitReason === 'data-budget' && (currentJob.minimumPartBytes !== undefined || (currentJob.retryAt ?? Infinity) > Date.now())));
				const retryAutomatic = !photos && (admissionFailed[saved.id] || (!!job?.intervalMs && (taskPaused || currentJob?.state === 'attention')));
				const actionLabel = pausing || task?.stopping ? 'Pausing…' : running ? 'Pause sync' :
					automatic && paused ? 'Resume automatic backup' : currentJob?.failureReason === 'write-approval' ? 'Approve folder writes' : retryAutomatic ? (taskPaused ? 'Resume automatic sync' : 'Retry automatic sync') :
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
						path={folderManagement ? '' : (nativeRoot?.sourceKind === 'photos' || saved.configuration.sourceKind === 'photos' ? nativeRoot?.name || 'Photo Library' : undefined) || (supportsNativeSourcePaths(capabilities) && validNativeSourcePath(nativeRoot?.sourcePath) && nativeRoot?.sourceKind !== 'photos' ? nativeRoot.sourcePath : undefined) || (nativeRoot ? 'Folder path unavailable' : 'Folder access missing')}
                        destination={folders.find(folder => folder.id === saved.configuration.remoteFolderId)?.path || 'Saved cloud folder'}
                        summaryContent={active && appOwned && !nativeOwns && <SyncConfigActivity scope={progressScope} scopeKey={`${key}:activity:${saved.id}`}
                            currentOrigin={runtimeOrigin} generation={generation} accountTransport={reviewTransport} live={task?.active ? task.activity : undefined} />}
                        error={runError || ''}
                        preparation={preparation}
                        photoQueue={photoQueue}
                        photoActivity={nativeOwns && photos && rootsReady && nativeRoot ? nativePhotoActivityDisplay(nativeRun, paused) : undefined}
                        automation={nativeOwns ? nativePhotoRunSchedule(nativeRun) : automatic ? (!automaticEnabled && !paused ? 'Automatic backup is disabled in Activity manager.' : photoSyncScheduleLabel(currentJob, paused, running, !!runError)) :
                            photos && capabilities?.platform === 'ios' ? 'Update Thingtime on this iPhone to use automatic backup and upload limits.' :
                            currentJob?.state === 'attention' ? 'Automatic sync needs attention.' :
                            admitted && !paused && !running && !waiting ? automaticEnabled ? queued ? undefined : 'Automatic sync is on.' : 'Automatic sync is disabled in Activity manager.' : undefined}
                        pauseAction={(automatic || admitted) && !running && !paused && !pausing ? { label: 'Pause sync', run: () => automatic ? pausePhotoAutomation(saved.id) :
                            pauseNativeSyncJob(progressScope, generation).catch(cause => setTransferErrors(previous => ({ ...previous, [saved.id]: cause instanceof Error ? cause.message : 'Pause could not be saved.' }))) } : undefined}
                        continuationAction={nativeOwns && photoContinuation && !saved.configuration.paused && nativePhotoCanContinue(nativeRun) ? {
                            label: continuation?.pending ? 'Requesting background processing…' : 'Run in Background',
                            disabled: pausing || continuation?.pending,
                            run: () => continuePhotoInBackground(saved)
                        } : undefined}
                        continuationStatus={!nativeOwns || saved.configuration.paused || nativeProgress?.stage === 'complete' ? undefined :
                            continuationActive && !nativeRun?.stale ? 'Continuing this backup with iOS background processing.' :
                            continuationHeld ? undefined : !nativeRun?.stale && nativeProgress?.activity?.reason === 'interrupted' ?
                                nativePhotoBackgroundLabel(nativeProgress.activity.backgroundRequest, nativeProgress.activity.reason) :
                                continuation?.status || (!nativeRun?.stale ? nativePhotoBackgroundLabel(nativeProgress?.activity?.backgroundRequest) : undefined)}
                        quickAction={!pausing && automaticallyWaiting ? undefined : { label: actionLabel,
                            disabled: pausing || (running ? !!task?.stopping : !allowed || busy || retainedDrafts.current.has(saved.id) || !ready || (nativeOwns && (!nativeRun || nativeRun.stale))),
                            run: () => {
                                if (running && automatic) return pausePhotoAutomation(saved.id);
                                if (running) { if (task?.active) return pauseNativeSyncJob(task.scope, generation).catch(cause => setError(cause instanceof Error ? cause.message : 'Pause could not be saved.')); controller.current?.abort(); }
                                else transfer(saved.id, retryAutomatic);
                            }
                        }}
						description={saved.configuration.mode === 'backup' ? 'Backup to cloud · keep deleted files' : twoWay ? 'Two-way sync' : downloading ? 'Cloud to device' : 'Device to cloud'}
						glance={nativeOwns ? nativePhotoRunGlance(nativeRun) : syncConnectionGlance({ deviceLabel: capabilities?.platform === 'ios' ? 'iPhone' : capabilities?.platform === 'android' ? 'Device' : 'Mac', progress, online: rootsReady, active: running, paused, waiting, preparing: !!preparation, mode: saved.configuration.mode, ...(task?.transferSeries ? { rates: { upload: task.transferSeries.read({ direction: 'upload', unit: 'Mbps', windowMs: 5000 }), download: task.transferSeries.read({ direction: 'download', unit: 'Mbps', windowMs: 5000 }) } } : {}) })}
                        stats={nativeOwns ? pausing ? 'Pausing…' : saved.configuration.paused ? 'Paused' : rootsReady && !nativeRoot ? 'Folder access missing' : nativePhotoRunLabel(nativeRun) : queued ? 'Queued · checking folder access when the device is free.' : preparation ? '' : syncFolderActivityLabel({ paused, rootsReady, hasRoot: !!nativeRoot,
                            taskPaused, running, waiting, failed: !!runError, stopping: pausing || task?.stopping, progress: statusProgress, photos })}
						expanded={selectedId === saved.id} onToggle={expanded => { if (expanded) { if (!viewBusy && ready && !storageError) { setSelectedId(saved.id); if (retainedDrafts.current.has(saved.id)) open(saved.id); } } else if (selectedId === saved.id) setSelectedId(null); }}>
					<Flex align="center" gap={2} wrap="wrap">
						<SyncEditorBlocks documentKey="file-sync-edit-actions" title="Sync config actions" blocks={syncConfigEditBlocks}
							scopeKey={`${key}:${saved.id}`} accountTransport={reviewTransport}
							scope={{ config: { disabled: viewBusy || isConfigRunning(saved.id) || !!storageError || !ready, retained: progress?.stage === 'retained' } }}
							actions={{ edit: () => { if (!viewBusy && !isConfigRunning(saved.id) && !storageError && ready) open(saved.id); } }} />

						{active && selectedId === saved.id && appOwned && !photos && <Box width="100%" minW={0}>
							<SyncDetailsSection title="Automatic sync"><DesktopSyncAutomation saved={saved} scope={{ ...scope, rootId: saved.id }} generation={generation}
								disabled={!allowed || saved.configuration.paused || retainedDrafts.current.has(saved.id) || !ready} accountTransport={reviewTransport} intervalDraft={intervalDrafts[saved.id]} onIntervalDraftChange={value => setIntervalDrafts(previous => ({ ...previous, [saved.id]: value }))} /></SyncDetailsSection>
						</Box>}
						{(host || capabilities?.platform === 'ios') && (progress || progressDescriptor) && <Box width="100%" minW={0}>
							<SyncProgressViewer scopeKey={`${key}:${generation}:${saved.id}`} descriptor={progressDescriptor}
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
	};
	const savedIds = new Set(connections.map(saved => saved.id));
	const groups = new Map<string, { root?: MobileFolder; saved: SavedFileSyncConfiguration[]; drafts: ConfigurationDraft[] }>(
		roots.map(root => [root.id, { root, saved: [], drafts: [] }])
	);
	const groupFor = (id: string) => {
		let group = groups.get(id);
		if (!group) { group = { saved: [], drafts: [] }; groups.set(id, group); }
		return group;
	};
	for (const saved of connections) groupFor(saved.configuration.localRootId).saved.push(saved);
	for (const row of retainedDrafts.current.values()) if (!savedIds.has(row.id)) groupFor(row.configuration.localRootId).drafts.push(row);
	return (
		<Box as="section" aria-label="Folders & sync configs" minWidth={0} marginTop={3}>
			{renderHeader()}
			{groups.size === 0 && loaded && rootsReady && !error && !folderManagement?.error && <Text fontSize="sm" marginBlock={3}>No folders added yet.</Text>}
			{[...groups].map(([id, { root, saved, drafts }]) => {
				const hasConfigs = !!(saved.length || drafts.length);
				const nativeDisabled = !!folderManagement?.busy || !!folderManagement?.transferring || viewBusy;
				return <Box key={id} as="section" aria-label={root?.name || 'Folder access unavailable'} minW={0} padding={3} marginTop={3}
					border="1px solid var(--tt-border, #ececef)" borderRadius="12px" overflowWrap="anywhere">
					<SyncEditorBlocks documentKey="file-sync-source" title="Device folder" blocks={syncSourceBlocks}
						scopeKey={`${key}:${id}`} accountTransport={reviewTransport} scope={{ source: {
							name: root?.name || (saved[0]?.configuration.sourceKind === 'photos' ? 'Photo Library' : 'Folder access unavailable'),
							path: root?.sourceKind !== 'photos' && supportsNativeSourcePaths(capabilities) && validNativeSourcePath(root?.sourcePath) ? root?.sourcePath : '',
							count: `${saved.length} sync ${saved.length === 1 ? 'config' : 'configs'}`,
							status: !root ? (rootsReady ? 'Restore access on this device to continue syncing.' : 'Checking folder access') : folderManagement?.checked[id] || '',
							canAdd: !!root, addLabel: hasConfigs ? 'Add sync config' : 'Set up sync',
							disabled: !ready || !loaded || viewBusy || !!storageError, canManage: !!root && !!folderManagement, nativeDisabled
						} }} actions={{
							add: () => { if (root && ready && loaded && !viewBusy && !storageError) { if (hasConfigs) add(root); else setUpFolder(root); } },
							scan: () => { if (root && !nativeDisabled) return folderManagement?.run({ action: 'scan', rootId: id }); },
							remove: () => { if (root && !nativeDisabled) return folderManagement?.run({ action: 'remove', rootId: id }); }
						}} />
					{saved.map(renderSaved)}
					{drafts.map(row => <SyncFolderCard key={row.id} title={row.configuration.name || 'New sync config'} description="Unsaved sync config"
						stats="Draft" path="" scopeKey={`${key}:draft:${row.id}`} accountTransport={reviewTransport}
						expanded={selectedId === row.id} editorSlotId={`${editorPrefix}-${row.id}`}
						onToggle={expanded => { if (expanded && !viewBusy && ready && !storageError) open(row.id); else if (!expanded && selectedId === row.id) setSelectedId(null); }}>
						{null}
					</SyncFolderCard>)}
				</Box>;
			})}
			{connectionCursor && <Button size="sm" minHeight="44px" isDisabled={viewBusy} onClick={() => void run(() => load('connections', connectionCursor).then(() => {}))}>
				More sync configs
			</Button>}
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
			{[...retainedDrafts.current.values()].map(draft => (
				<SyncEditorPlacement key={draft.id} targetId={`${editorPrefix}-${draft.id}`}><Box hidden={selectedId !== draft.id} marginTop={4} border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={3}>
					<SyncConfigurationForm photoAutomation={photoAutomation} iosManagedResources={iosManagedSyncResources(capabilities)} sourcePathsAvailable={supportsNativeSourcePaths(capabilities)} draft={draft} roots={roots} folders={folders} disabled={viewBusy || isConfigRunning(draft.id) || draft.pending || !ready} lockSource={roots.some(root => root.id === draft.configuration.localRootId)} scopeKey={`${key}:${generation}:${draft.id}`} accountTransport={reviewTransport} onChange={edit} onResourceDraftChange={resourceDraft => { const latest = retainedDrafts.current.get(draft.id); if (latest) edit({ ...latest, resourceDraft }); }} onResourceValidityChange={valid => { resourceValidity.current.set(draft.id, valid); if (selectedId === draft.id) setResourceDraftValid(valid); }} />
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
					<SyncEditorBlocks documentKey="file-sync-save-actions" title="Save sync config" blocks={syncLocalEditorActionBlocks}
						scopeKey={`${key}:save:${draft.id}`} accountTransport={reviewTransport} scope={{ editor: {
							status: draft.enrollment?.savedRevision ? 'Settings are saved. Retry automatic setup to finish this exact config.' :
								draft.pending ? 'This save is not confirmed. Retry checks the same sync config.' :
								mobileFolderBusy && !canQueueDraft(draft) ? 'Folder access is busy. Your draft is saved; apply it when this transfer finishes.' :
								appOwned && !draft.configuration.paused && draft.configuration.sourceKind !== 'photos' ? 'Saving and syncing enables automatic checks on this device. Downloads may require folder approval.' : 'Draft saved on this device.',
							canSync: appOwned && scope.dataPlane === 'home' && !draft.configuration.paused && draft.configuration.sourceKind !== 'photos' && !!draft.configuration.localRootId,
							canSave: !draft.enrollment && (draft.baseUpdatedAt !== null || !appOwned || draft.configuration.sourceKind === 'photos' || draft.configuration.paused || scope.dataPlane !== 'home' || !draft.configuration.localRootId),
							syncLabel: draft.enrollment?.savedRevision ? 'Retry automatic setup' : draft.pending ? 'Retry save & sync' : 'Save & sync',
							saveLabel: draft.pending ? 'Retry save' : 'Save sync config',
							canDiscard: !draft.pending, canKeepSaved: !!draft.enrollment?.savedRevision, saveDisabled: viewBusy || (mobileFolderBusy && !canQueueDraft(draft) && !draft.enrollment?.savedRevision) || isConfigRunning(draft.id) || !ready || !!conflict || !resourceDraftValid || !!storageError,
							hasConflict: !!conflict, conflictLabel: conflict?.latest ? 'Replace draft with saved version' : 'Discard draft for deleted sync config',
							hasMoreFolders: !!folderCursor, busy: viewBusy || !ready
						} }} actions={{
							'save-sync': () => save(true), save: () => save(false),
							'keep-saved': () => void run(async () => {
								if (!draft.enrollment?.savedRevision) return;
								cancelSyncEnrollmentRecovery(scope);
								persist(null);
								setNotice('Saved settings kept. Check this config’s automatic sync status.');
							}),
							discard: () => void run(async () => { if (!draft.pending) { persist(null); setSelectedId(null); } }),
							reload: () => { if (conflict?.latest) open(draft.id, true); else void run(async () => { persist(null); setSelectedId(null); setConflict(null); }); },
							'more-folders': () => void run(() => load('folders', folderCursor).then(() => {}))
						}} />
				</Box></SyncEditorPlacement>
			))}
		</Box>
	);
}

export function SyncConfigurationForm({
	draft,
	roots,
	folders,
	disabled,
	lockSource = false,
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
	lockSource?: boolean;
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
	const key = scopeKey ?? `${draft.id}:${c.deviceId}`;
	const rootOptions = c.localRootId && !selectedRoot ? [{ id: c.localRootId, name: 'Folder access missing' }, ...roots] : roots;
	const fieldNames = ['name', 'source', 'mode', 'network', 'exclusions'];
	const fieldScope = { form: {
		ids: Object.fromEntries(fieldNames.map(name => [name, `${prefix}-${name}`])),
		name: c.name, source: c.localRootId, mode: c.mode, network: c.network, disabled,
		paused: c.paused, 'charging-only': c.chargingOnly, 'propagate-deletes': c.propagateDeletes,
		exclusions: draft.exclusions, roots: rootOptions, canChooseSource: !lockSource,
		modeDisabled: disabled || photos, isBackup: c.mode === 'backup', deleteDisabled: disabled || c.mode === 'backup',
		photoAccess: selectedRoot?.sourceKind === 'photos' ? photoAccessDescription(selectedRoot) + '.' : ''
	} };
	return (
		<Stack spacing={3} fontSize="13px" minWidth={0}>
			<SyncEditorBlocks documentKey="file-sync-config-basics" title="Sync config details" blocks={syncConfigBasicsBlocks}
				scopeKey={key} accountTransport={accountTransport} scope={fieldScope} actions={{
					name: ({ value }) => { if (!disabled && typeof value === 'string') change({ name: value }); },
					source: ({ value }) => {
						if (disabled || lockSource || typeof value !== 'string') return;
						const root = roots.find(row => row.id === value);
						if (!root && value) return;
						if (root?.sourceKind !== 'photos' && c.photoAutomation) {
							onChange({ ...draft, photoAutomationDraft: undefined, configuration: {
								...c, localRootId: value, sourceKind: root?.sourceKind, photoAutomation: undefined,
								configurationVersion: c.resourceLimits ? 3 : c.ignoreRules ? 2 : 1
							} });
						} else change({ localRootId: value, sourceKind: root?.sourceKind,
							...(root?.sourceKind === 'photos' ? { mode: 'backup', propagateDeletes: false } : {}) });
					}
				}} />
			<SyncDestinationControl sourceName={selectedRoot?.name || (photos ? 'Photo Library' : c.name)} draft={draft}
				folders={folders} disabled={disabled} scopeKey={key} accountTransport={accountTransport}
				onChange={remoteFolderId => change({ remoteFolderId })} />
			<SyncEditorBlocks documentKey="file-sync-config-direction" title="Sync direction" blocks={syncConfigDirectionBlocks}
				scopeKey={key} accountTransport={accountTransport} scope={fieldScope} actions={{
					mode: ({ value }) => {
						const match = syncConfigModes.find(([mode]) => mode === value);
						if (!disabled && !photos && match) change({ mode: match[0], ...(value === 'backup' ? { propagateDeletes: false } : {}) });
					}
				}} />
				<SyncEditorBlocks documentKey="file-sync-config-transfer" title="Transfer options" blocks={syncConfigTransferBlocks}
					scopeKey={key} accountTransport={accountTransport} scope={fieldScope} actions={{
						network: ({ value }) => { if (!disabled && (value === 'wifi' || value === 'any')) change({ network: value }); },
						paused: ({ value }) => { if (!disabled && typeof value === 'boolean') change({ paused: value }); },
						'charging-only': ({ value }) => { if (!disabled && typeof value === 'boolean') change({ chargingOnly: value }); },
						'propagate-deletes': ({ value }) => { if (!disabled && c.mode !== 'backup' && typeof value === 'boolean') change({ propagateDeletes: value }); }
					}} />
			<Box as="details"><Box as="summary" cursor="pointer" paddingY={2}>Exclusions and ignore rules</Box><Stack spacing={3}>
				<SyncEditorBlocks documentKey="file-sync-config-exclusions" title="Excluded paths" blocks={syncConfigExclusionBlocks}
					scopeKey={key} accountTransport={accountTransport} scope={fieldScope} actions={{
						exclusions: ({ value }) => { if (!disabled && typeof value === 'string') onChange({ ...draft, exclusions: value }); }
					}} />
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
