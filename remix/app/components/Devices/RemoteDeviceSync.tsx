import { iosManagedSyncResources } from './deviceSyncResourceDisplay';
import { prepareExplicitSyncStart } from '~/fileSync/configurationStart';
import { syncJobAttentionMessage } from '~/fileSync/syncJobFailure';
import { syncConnectionGlance } from '~/fileSync/connectionGlance';
import { hasSavedSyncDraft, observeSavedSyncConnections, publishSavedSyncConnection, reconcileSavedSyncList } from './savedSyncConnectionUpdates';
import { useRemoteDeviceSyncStatus } from '~/fileSync/remoteDeviceResources.client';
import type { TransferSpeedDraftState } from './TransferSpeedTrackers';
import { AccountBackupWorkspace, AccountBackupWorkspaceBoundary } from './BackupWorkspace';
import { DeviceSyncResources } from './DeviceSyncResources';
import { SyncEditorPlacement } from './SyncEditorPlacement';
import type { UploadPriorityDraftState } from './SyncUploadPriorities';
import { supportsNativeSourcePaths } from '~/fileSync/mobileFolders.client';
import { cloudFolderPaths, type CloudFolderPath } from '~/fileSync/folderPaths';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { readStampedCache, writeStampedCache, pruneCacheNamespace } from '~/hooks/localCache';
import { rootIdentity } from '~/utils/rootIdentity';
import { createRemoteSyncClient, negotiateRemoteSourcePaths, readRemoteSyncActivity } from '~/fileSync/remoteSyncClient.client';
import { REMOTE_SYNC_ENROLLMENT_REQUIREMENTS, assertRemoteFolderEnrollment, type RemoteSyncStatus, type RemoteSyncCommand, validateRemoteSyncCommand } from '~/fileSync/remoteSyncProtocol';
import { type FolderResult, type MobileFolder, supportsMobileTrashRecovery, supportsNativeFileVersions } from '~/fileSync/mobileFolders.client';
import { type SavedFileSyncConfiguration, readOwnedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS, FILE_SYNC_RESOURCE_REQUIREMENTS } from '~/fileSync/configuration';
import { fileSyncDownloadRequirements } from '~/fileSync/signedDownloadTarget';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { canonicalDraftConfiguration, configurationDraftKey, ConfigurationConflict, persistConfigurationDrafts, readConfigurationDrafts, readPendingSyncEnrollment, claimSyncEnrollment, cancelSyncEnrollmentRecovery, SYNC_ENROLLMENT_RECOVERED_EVENT, SYNC_ENROLLMENT_WAKE_EVENT, type SyncEnrollmentIntent,
	saveConfigurationDraft, type ConfigurationDraft, type ConfigurationEditorScope } from '~/fileSync/configurationEditor';
import { assertRemoteDeviceRoot, hasSavedDeviceRoot } from '~/fileSync/remoteConfigurationRoot';
import { SYNC_INTERVALS } from '~/fileSync/syncJobJournal';
import { SyncConfigurationForm } from './MobileSyncConnections';
import { NativeFileRecovery } from './NativeFileRecovery';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { remoteSyncBlocks, remoteSyncEditorBlocks, remoteSyncDisclosureBlocks, remoteSyncSaveActions, remoteSyncAuthoringBlocks } from './remoteSyncBlocks';
import { syncConflictReviewBlocks, syncConflictReviewDisplay } from './syncConflictReviewBlocks';
import { openThingHistory } from '../Timeline/TimelineHost';
import { SyncDetailsSection } from './SyncDetailsSection';
import { SettingsSection } from '../Settings/SettingsSection';
import { RemoteSyncDetails } from './RemoteSyncDetails';
import { SyncConfigActivity, syncActivityBytesLabel, syncActivityLastLabel } from './SyncConfigActivity';
import { newSyncConfigDraft, newlyGrantedFolder, useRevealNewSyncDraft } from './syncFolderEditor';
import type { SpeedReading } from '~/fileSync/transferSpeed';

function Controls({ documentKey, title, blocks, scopeKey, scope, actions, onError }: {
	documentKey: string; title: string; blocks: WebpageBlock[]; scopeKey: string; scope: Record<string, unknown>; actions: TransientBlockActions; onError(): void;
}) {
	return <SettingsDocumentHost documentKey={documentKey} title={title} defaultDocument={blocks} scopeKey={scopeKey}
		migrateBlocks={documentKey === 'remote-device-sync' ? remoteSyncAuthoringBlocks : documentKey === 'remote-sync-editor' ? remoteSyncSaveActions : undefined}>
		{({ blocks: saved, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={scope} actions={actions} enabled={!editing} onError={onError}>
			<WebpageBlocksRenderer blocks={documentKey === 'remote-device-sync' ? remoteSyncDisclosureBlocks(saved) : documentKey === 'remote-sync-editor' ? remoteSyncSaveActions(saved) : saved} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}

/** The enclosing device view verifies ownership. This boundary also removes
 * protected state synchronously when the signed-in identity or storage changes. */
export function RemoteDeviceSync({ ownerId, deviceId, devicePlatform, active = true, showResourceSummary = true }: { ownerId: string; deviceId: string; devicePlatform?: string; active?: boolean; showResourceSummary?: boolean }) {
	const user = useCurrentUser(), dataPlane = useDataPlane();
	const identity = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	if (user?.id !== ownerId || user.temporary || user.isCharacter || user.accountKind !== 'user' || dataPlane !== 'home' || identity.pending || typeof window === 'undefined') return null;
	const scope = { origin: window.location.origin, ownerId, deviceId, dataPlane };
	const savedOnly = devicePlatform !== 'macos' && devicePlatform !== 'darwin';
	return <>{showResourceSummary && !savedOnly && <DeviceSyncResources ownerId={ownerId} deviceId={deviceId} allowed={active} />}<AccountBackupWorkspaceBoundary><RemoteConnections active={active} devicePlatform={devicePlatform} savedOnly={savedOnly} key={`${configurationDraftKey(scope)}:${identity.generation}`} scope={scope} generation={identity.generation} /></AccountBackupWorkspaceBoundary><Box mt={4}><AccountBackupWorkspace ownerId={ownerId} /></Box></>;
}

function RemoteConnections({ scope, generation, active, devicePlatform, savedOnly }: { scope: ConfigurationEditorScope; generation: number; active: boolean; devicePlatform?: string; savedOnly: boolean }) {
	const api = useApi(), apiRef = useRef(api); apiRef.current = api;
	const lifetime = useRef(new AbortController());
	const operationSequence = useRef(0);
	const key = configurationDraftKey(scope), scopeKey = `${key}:${generation}`, cacheKey = `tt-remote-sync-connections:${key}`;
	const check = () => {
		lifetime.current.signal.throwIfAborted();
		const current = rootIdentity.read();
		if (current.pending || current.generation !== generation || window.location.origin !== scope.origin) throw Error('The account or device changed.');
	};
	const options = () => ({ expectedActor: scope.ownerId, expectedDataPlane: 'home', expectedApiOrigin: scope.origin, signal: lifetime.current.signal });
	const [client] = useState(() => createRemoteSyncClient({ ...scope, get signal() { return lifetime.current.signal; }, assertCurrent: check }));
	const [initial] = useState(() => {
		try { const raw = window.localStorage.getItem(key); return { raw, drafts: readConfigurationDrafts(raw, scope.deviceId), error: '' }; }
		catch (cause) { return { raw: null, drafts: [] as ConfigurationDraft[], error: cause instanceof Error ? cause.message : 'The saved draft could not be read.' }; }
	});
	const raw = useRef(initial.raw);
	const [draft, setDraft] = useState<ConfigurationDraft | null>(() => initial.drafts.find(row => row.enrollment) ?? null);
	const draftJournalCurrent = useRef(true);
	const retainedDrafts = useRef(new Map<string, ConfigurationDraft>(initial.drafts.map(draft => [draft.id, draft])));
	const [selectedId, setSelectedId] = useState<string | null>(() => initial.drafts.find(row => row.enrollment)?.id ?? null);
	const editorPrefix = React.useId();
	const revealDraft = useRevealNewSyncDraft(editorPrefix, selectedId, initial.drafts.some(row => row.enrollment));
	const resourceValidity = useRef(new Map<string, boolean>());
	const speedDrafts = useRef(new Map<string, TransferSpeedDraftState>());
	const priorityDrafts = useRef(new Map<string, UploadPriorityDraftState>());
	const [storageError, setStorageError] = useState(initial.error), [draftReady, setDraftReady] = useState(!initial.error);
	const [resourceValid, setResourceValid] = useState(true), [conflict, setConflict] = useState<ConfigurationConflict | null>(null);
	const [connections, setConnections] = useState<SavedFileSyncConfiguration[]>(() => {
		const cached = readStampedCache<unknown[]>(cacheKey);
		return (Array.isArray(cached) ? cached : []).flatMap(row => {
			try { const saved = readOwnedFileSyncConfiguration(row, scope.ownerId); return saved.configuration.deviceId === scope.deviceId ? [saved] : []; } catch { return []; }
		});
	});
	const connectionsRef = useRef(connections);
	const [folders, setFolders] = useState<CloudFolderPath[]>([]);
	const [connectionCursor, setConnectionCursor] = useState<string | null>(null), [folderCursor, setFolderCursor] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), busyRef = useRef(false);
	const [error, setError] = useState(''), [notice, setNotice] = useState('');
	const { status, online, checking, error: deviceError, refresh: refreshStatus } = useRemoteDeviceSyncStatus(scope, active && !savedOnly);
	const [sourcePathsReady, setSourcePathsReady] = useState(false);
	const [intervals, setIntervals] = useState<Record<string, number>>({});
	const [historyId, setHistoryId] = useState<string | null>(null);
	const [detailsId, setDetailsId] = useState<string | null>(null);
	const [pausingId, setPausingId] = useState<string | null>(null);
	const pausing = useRef(false);
	const cache = (rows: SavedFileSyncConfiguration[]) => {
		check(); setConnections(rows); connectionsRef.current = rows;
		writeStampedCache(cacheKey, rows.map(row => ({ id: row.id, updatedAt: row.updatedAt, crystal: row.configuration,
			author: { id: scope.ownerId }, acl: ['tt:user'], thingtime: ['file-sync'] })));
		pruneCacheNamespace('tt-remote-sync-connections:', cacheKey, 32);
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
	const persist = (next: ConfigurationDraft | null, clearId = draft?.id, expose = true) => {
		check();
		const retained = new Map(retainedDrafts.current);
		if (next) retained.set(next.id, next);
		else if (clearId) retained.delete(clearId);
		raw.current = persistConfigurationDrafts(window.localStorage, key, raw.current, [...retained.values()]);
		retainedDrafts.current = retained; if (expose) setDraft(next); if (!next && expose) setSelectedId(null); setStorageError('');
	};
	const edit = (next: ConfigurationDraft) => {
		retainedDrafts.current.set(next.id, next); setSelectedId(next.id); setResourceValid(resourceValidity.current.get(next.id) ?? true);
		setDraft(next); setConflict(null); setError('');
		try { persist(next); } catch (cause) { setStorageError(cause instanceof Error ? cause.message : 'Draft could not be saved.'); }
	};
	const run = async (work: () => Promise<void>) => {
		if (busyRef.current) return;
		const sequence = ++operationSequence.current, activeSignal = lifetime.current.signal;
		busyRef.current = true; setBusy(true); setError(''); setNotice('');
		try { check(); await work(); check(); }
		catch (cause) {
			if (!activeSignal.aborted && sequence === operationSequence.current) { setError(cause instanceof Error ? cause.message : 'Sync could not be updated.'); if (cause instanceof ConfigurationConflict) setConflict(cause); }
		} finally { if (sequence === operationSequence.current) { busyRef.current = false; if (!activeSignal.aborted) setBusy(false); } }
	};
	const load = async (kind: 'connections' | 'folders', cursor?: string | null) => {
		const activeSignal = lifetime.current.signal;
		const before = connectionsRef.current;
		const result = await apiRef.current.v1.things.list({ thingtime: kind === 'connections' ? 'file-sync' : 'folder', limit: 50, cursor }, options());
		activeSignal.throwIfAborted(); check(); if (!Array.isArray(result.things)) throw Error('Saved sync settings could not be loaded. Refresh to retry.');
		if (kind === 'connections') {
			const accepted = result.things.flatMap(row => { try { const saved = readOwnedFileSyncConfiguration(row, scope.ownerId); return saved.configuration.deviceId === scope.deviceId ? [saved] : []; } catch { return []; } });
			cache(reconcileSavedSyncList(before, connectionsRef.current, accepted, !!cursor));
			setConnectionCursor(result.nextCursor ?? null); setLoaded(true); return result.nextCursor ?? null;
		} else {
			const accepted = await cloudFolderPaths(result.things, scope.ownerId, async id => (await apiRef.current.v1.things.get({ id }, { ...options(), storageMode: 'cloud' })).thing, check);
			check();
			setFolders(previous => [...new Map([...(cursor ? previous : []), ...accepted].map(row => [row.id, row])).values()]); setFolderCursor(result.nextCursor ?? null);
		}
		return null;
	};
	useEffect(() => {
		if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
		const effectSignal = lifetime.current.signal;
		const unsubscribe = observeSavedSyncConnections(scope, generation, saved => {
			const identity = rootIdentity.read();
			if (!effectSignal.aborted && !identity.pending && identity.generation === generation && window.location.origin === scope.origin) remember(saved);
		});
		void negotiateRemoteSourcePaths().then(available => { if (!effectSignal.aborted) { check(); setSourcePathsReady(available); } }).catch(() => { if (!effectSignal.aborted) setSourcePathsReady(false); });
		void run(async () => { await load('connections'); await load('folders'); });
		const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) { draftJournalCurrent.current = false; setDraftReady(false); setStorageError('This draft changed in another tab. Reload this page before saving.'); } };
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
		// Invalidate the latest operation, including operations started after setup.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		return () => { unsubscribe(); lifetime.current.abort(); ++operationSequence.current; busyRef.current = false; window.removeEventListener('storage', changed);
			window.removeEventListener(SYNC_ENROLLMENT_RECOVERED_EVENT, recovered);
			if ([...retainedDrafts.current.values()].some(row => row.enrollment)) window.dispatchEvent(new Event(SYNC_ENROLLMENT_WAKE_EVENT)); };
		// Scope and generation are the mounted component identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const open = async (id: string, replace = false) => {
		setSelectedId(id); setDetailsId(null); setResourceValid(resourceValidity.current.get(id) ?? true);
		const retained = !replace && retainedDrafts.current.get(id);
		if (retained) { persist(retained); setConflict(null); return; }
		const result = await apiRef.current.v1.things.get({ id }, { ...options(), storageMode: 'cloud' }); check();
		const saved = readOwnedFileSyncConfiguration(result.thing, scope.ownerId);
		if (saved.id !== id || saved.configuration.deviceId !== scope.deviceId) throw Error('This connection belongs to another device.');
		persist({ version: 1, id, baseUpdatedAt: saved.updatedAt, configuration: saved.configuration, exclusions: saved.configuration.excludedPaths.join('\n'), pending: false }); setConflict(null);
	};
	const verifyRemoteRoot = async (configuration: ConfigurationDraft['configuration']) => {
		if (savedOnly || !online) throw Error('Choose the source folder in Thingtime on this device.');
		const result = await client.send<FolderResult>({ action: 'folders', request: { action: 'list' } });
		check();
		assertRemoteDeviceRoot(result.roots, configuration, scope.deviceId);
	};
	const canEnroll = !savedOnly && online && status?.folderEnrollmentVersion === '1.0.0';
	const readCloud = async (id: string) => (await apiRef.current.v1.things.get({ id }, { ...options(), storageMode: 'cloud' })).thing;
	const completeEnrollment = async (saved: SavedFileSyncConfiguration, intent: SyncEnrollmentIntent, queueOnly = false) => {
		try {
			const receipt = await enroll(saved, intent.intervalMs, queueOnly);
			check();
			persist(null, saved.id, draft?.id === saved.id);
			if (draft?.id === saved.id) setSelectedId(saved.id);
			setNotice(receipt.pendingFolderValidation ? 'Sync config saved. Folder access will be checked when the device is free.' : 'Sync config saved. Automatic sync is on.');
		} catch (cause) {
			check();
			setNotice('');
			throw Error(`Sync config saved. Automatic sync could not be confirmed: ${cause instanceof Error ? cause.message : 'check the device and try again.'}`);
		} finally { if (!lifetime.current.signal.aborted) await refreshStatus(); }
	};
	const save = (startAfterSave = false) => run(async () => {
		if (!draft || !draftReady || !resourceValid) return;
		const release = startAfterSave ? claimSyncEnrollment(scope) : undefined;
		if (startAfterSave && !release) throw Error('Automatic setup is already being checked.');
		try {
			if (draft.enrollment && !startAfterSave) throw Error('Retry automatic setup, or keep the saved config as it is.');
			if (startAfterSave) {
				if (!canEnroll || draft.configuration.paused || draft.configuration.sourceKind === 'photos') throw Error('Enable this sync config and connect to an updated Thingtime app before syncing.');
				for (const [feature, minimum] of Object.entries(REMOTE_SYNC_ENROLLMENT_REQUIREMENTS)) await requireThingtimeCapability(feature, minimum);
				check();
			}
			const enrollment = startAfterSave ? draft.enrollment ?? {
				transport: 'remote' as const, intervalMs: intervals[draft.id] ?? status?.jobs.find(job => job.connectionId === draft.id)?.intervalMs ?? 300_000
			} : undefined;
			if (enrollment?.savedRevision) {
				const saved = await readPendingSyncEnrollment(draft, scope, { get: readCloud, assertCurrent: check });
				acceptSave(saved);
				await completeEnrollment(saved, enrollment);
				return;
			}
			const deferRootVerification = startAfterSave && draft.baseUpdatedAt === null && !!status?.task?.active && status.rootsReady &&
				status.roots.some(root => root.id === draft.configuration.localRootId);
			const verify = async (configuration: ConfigurationDraft['configuration']) => {
				if (deferRootVerification) { check(); assertRemoteDeviceRoot(status!.roots, configuration, scope.deviceId); }
				else await verifyRemoteRoot(configuration);
			};
			let prepared = draft;
	            if (draft.baseUpdatedAt === null && !draft.configuration.remoteFolderId) {
	                if (!draft.configuration.localRootId) throw Error('Choose a device folder first.');
	                await verify(draft.configuration);
	                const result = await apiRef.current.v1.deviceFolders.resolve({ deviceId: scope.deviceId, connectionId: draft.id, name: roots.find(root => root.id === draft.configuration.localRootId)?.name || (draft.configuration.sourceKind === 'photos' ? 'Photo Library' : draft.configuration.name) }, options());
	                const destination = result.folder as CloudFolderPath;
	                check();
	                prepared = { ...draft, configuration: { ...draft.configuration, remoteFolderId: destination.id } };
	                persist(prepared); setFolders(previous => [...previous.filter(folder => folder.id !== destination.id), destination]);
	            }
	            const pending = { ...prepared, configuration: canonicalDraftConfiguration(prepared), pending: true, enrollment };
			if (pending.configuration.photoAutomation) {
				for (const [feature, minimum] of Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS)) await requireThingtimeCapability(feature, minimum);
				check();
			}
			if (pending.configuration.resourceLimits) for (const [feature, minimum] of Object.entries({ ...FILE_SYNC_RESOURCE_REQUIREMENTS, ...fileSyncDownloadRequirements(pending.configuration) })) await requireThingtimeCapability(feature, minimum);
			else if (pending.configuration.ignoreRules) await requireThingtimeCapability('api.things', '1.38.0');
			persist(pending);
			let previous: SavedFileSyncConfiguration | null = null, dispatched = false;
			let saved: SavedFileSyncConfiguration;
			try {
				saved = await saveConfigurationDraft(pending, scope, { assertCurrent: check,
					get: async id => { const value = await readCloud(id); check(); if (id === pending.id) previous = readOwnedFileSyncConfiguration(value, scope.ownerId); return value; },
					create: (id, configuration) => { dispatched = true; return apiRef.current.v1.things.create({ shareId: id, thingtime: ['file-sync'], crystal: configuration, acl: ['tt:user'] }, options()); },
					update: (id, configuration, expectedUpdatedAt) => { dispatched = true; return apiRef.current.v1.things.update({ id, crystal: configuration, expectedUpdatedAt, replaceCrystal: true }, options()); },
					verifyDeviceRoot: async deviceId => {
						if (hasSavedDeviceRoot(previous, pending.configuration, deviceId)) return;
						await verify(pending.configuration);
					}
				});
			} catch (cause) { check(); if (!draft.pending && !dispatched && !(cause instanceof ConfigurationConflict)) persist(prepared); throw cause; }
			check(); setConflict(null); acceptSave(saved);
			if (enrollment) {
				const confirmed = { ...enrollment, savedRevision: saved.updatedAt };
				persist({ ...pending, enrollment: confirmed });
				await completeEnrollment(saved, confirmed);
			} else {
				persist(null);
				setSelectedId(saved.id);
				setNotice('Sync config saved. Use Thingtime on the device to enable these settings for automatic sync.');
			}
		 } finally { release?.(); }
	});
	const send = async <T,>(command: RemoteSyncCommand): Promise<T> => {
		if (savedOnly) throw Error('Use Thingtime on this device to control sync.');
		check(); setNotice('Waiting for this device to confirm…');
		const result = await client.send<T>(command); check(); setNotice('Device request completed.'); return result;
	};
	const enroll = async (saved: SavedFileSyncConfiguration, reviewedInterval?: number, queueOnly = false) => {
		const expected = { connectionId: saved.id, expectedUpdatedAt: saved.updatedAt,
			intervalMs: reviewedInterval ?? intervals[saved.id] ?? status?.jobs.find(job => job.connectionId === saved.id)?.intervalMs ?? 300_000 };
		return assertRemoteFolderEnrollment(await send({ action: 'start', ...expected, ...(queueOnly ? { queueOnly: true as const } : {}) }), expected);
	};
	const roots = status?.roots ?? [];
	const formRoots: MobileFolder[] = [...new Map([...connections.map(row => ({ id: row.configuration.localRootId, name: row.configuration.sourceKind === 'photos' ? 'Photo Library' : 'Saved device folder', ...(row.configuration.sourceKind === 'photos' ? { sourceKind: 'photos' as const } : {}) })), ...roots].map(root => [root.id, root])).values()];
	const selected = (id: unknown) => { check(); const saved = connectionsRef.current.find(row => row.id === id); if (!saved || saved.configuration.deviceId !== scope.deviceId) throw Error('Refresh this device’s connections before continuing.'); return saved; };
	const start = (id: unknown, automatic: boolean, fromCard = false) => run(async () => {
		const requested = selected(id);
		if ((automatic && !fromCard && selectedId !== requested.id) || retainedDrafts.current.has(requested.id) || !online) throw Error('Save the sync config and connect the device before starting sync.');
		if (automatic && (!canEnroll || requested.configuration.sourceKind === 'photos')) throw Error('Update Thingtime on this device to enable automatic folder sync.');
		if (automatic) for (const [feature, minimum] of Object.entries(REMOTE_SYNC_ENROLLMENT_REQUIREMENTS)) await requireThingtimeCapability(feature, minimum);
        const saved = await prepareExplicitSyncStart(requested, scope, {
            assertCurrent: check,
            hasDraft: id => !draftJournalCurrent.current || retainedDrafts.current.has(id) || hasSavedSyncDraft(scope, id),
            get: async id => {
                const value = (await apiRef.current.v1.things.get({ id }, { ...options(), storageMode: 'cloud' })).thing;
                check();
                const current = readOwnedFileSyncConfiguration(value, scope.ownerId);
                if (current.id === id && current.configuration.deviceId === scope.deviceId && !remember(current))
                    throw Error('This connection changed elsewhere. Review its saved settings before starting. No transfer was started.');
                return value;
            },
            update: async (id, configuration, expectedUpdatedAt) => (await apiRef.current.v1.things.update({ id, crystal: { paused: configuration.paused }, expectedUpdatedAt }, options())).thing
        });
        check(); acceptSave(saved);
		if (automatic) {
			const receipt = await enroll(saved);
			setNotice(receipt.pendingFolderValidation ? 'Queued · checking folder access when the device is free.' : 'Automatic sync is on.');
		}
		else await send({ action: 'start', connectionId: saved.id, expectedUpdatedAt: saved.updatedAt });
		await refreshStatus();
	});
	const pause = async (id: unknown) => {
		if (pausing.current || !online) return;
		const activeSignal = lifetime.current.signal;
		try {
			const saved = selected(id); pausing.current = true; setPausingId(saved.id); setError('');
			await send({ action: 'pause', connectionId: saved.id }); check(); await refreshStatus();
		} catch (cause) { if (!activeSignal.aborted) setError(cause instanceof Error ? cause.message : 'Pause could not be confirmed. Retry to check the same request.'); }
		finally { pausing.current = false; if (!activeSignal.aborted) setPausingId(null); }
	};
	const review = status?.task?.review;
	const reviewSaved = connections.find(saved => saved.id === status?.task?.connectionId);
	if (detailsId && !speedDrafts.current.has(detailsId)) speedDrafts.current.set(detailsId, {});
	if (detailsId && !priorityDrafts.current.has(detailsId)) priorityDrafts.current.set(detailsId, {});
	const detailsSaved = connections.find(saved => saved.id === detailsId);
	const reviewAction = (operation: Extract<RemoteSyncCommand, { action: 'review' }>['operation'], extra: Record<string, unknown> = {}) => run(async () => {
		if (!review || !status?.task || !online) throw Error('Refresh the device before reviewing conflicts.');
		await send(validateRemoteSyncCommand({ action: 'review', connectionId: status.task.connectionId, reviewId: review.id, operation, ...extra })); await refreshStatus();
	});
	const canShowHistory = !!(online && status?.connectionActivityVersion === '1.0.0');
	const historySaved = canShowHistory && active ? connections.find(saved => saved.id === historyId) : undefined;
	const projected = connections.map(saved => {
		const job = status?.jobs.find(row => row.connectionId === saved.id), task = status?.task?.connectionId === saved.id ? status.task : null;
		const progress = task?.progress, active = !!task?.active;
		const rates = task?.transferRates;
		const rate = (reading: SpeedReading) => reading.status === 'known' ? `${reading.value.toFixed(2)} ${reading.unit}` : reading.status === 'paused' ? 'paused' : 'unavailable';
		const platform = devicePlatform ?? status?.capabilities.platform;
		const deviceLabel = platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : platform === 'macos' || platform === 'darwin' ? 'Mac' : 'Device';
		const glance = syncConnectionGlance({ deviceLabel, progress: progress ?? (job?.progress ? { ...job.progress, confirmed: 0, total: 0 } : undefined), rates, online, active, mode: saved.configuration.mode, paused: saved.configuration.paused || task?.status === 'paused' || job?.state === 'paused', waiting: task?.waiting });
		if (savedOnly) {
			if (saved.configuration.mode !== 'download') glance.upload = { ...glance.upload, rate: 'See progress on the device', progress: '' };
			if (saved.configuration.mode === 'download' || saved.configuration.mode === 'two-way') glance.download = { ...glance.download, rate: 'See progress on the device', progress: '' };
		}
		const activity = canShowHistory ? (task?.active ? task.activity : undefined) ?? job?.activity : undefined;
		const historyOpen = historyId === saved.id;
		const needsWriteApproval = canEnroll && job?.state === 'attention' && job.failureReason === 'write-approval';
		return { sourceId: saved.configuration.localRootId, glance,
			canShowHistory, canEnroll: canEnroll && saved.configuration.sourceKind !== 'photos', historyOpen, historyLabel: historyOpen ? 'Hide activity history' : 'Activity history',
			historySlotId: `${editorPrefix}-activity-${saved.id}`, destination: folders.find(folder => folder.id === saved.configuration.remoteFolderId)?.path || 'Saved cloud folder', hasActivity: !!activity, lastActivity: syncActivityLastLabel(activity),
			sent: syncActivityBytesLabel(activity?.sentBytes ?? null), received: syncActivityBytesLabel(activity?.receivedBytes ?? null), editorSlotId: `${editorPrefix}-${saved.id}`, editorHidden: selectedId !== saved.id, toggleGlyph: selectedId === saved.id ? '⌃' : '⌄', summaryStatus: savedOnly ? saved.configuration.paused ? 'Saved configuration: paused' : 'Saved settings' : !online ? 'Device offline' : saved.configuration.paused ? 'Paused' : job?.pendingFolderValidation ? 'Queued · checking folder access when the device is free.' : task?.waiting ? progress?.message || 'Waiting to continue sync.' : task?.status === 'paused' || job?.state === 'paused' ? 'Paused' : task?.status === 'error' ? 'Needs attention' : !roots.some(root => root.id === saved.configuration.localRootId) ? 'Folder access missing' : active ? 'Running' : 'No active transfer', quickStats: progress?.total || progress?.totalFinal ? `${progress.confirmed} / ${progress.total} confirmed` : '', expanded: selectedId === saved.id, expandLabel: selectedId === saved.id ? 'Collapse folder' : 'Expand folder', path: saved.configuration.sourceKind === 'photos' ? roots.find(root => root.id === saved.configuration.localRootId)?.name || 'Photo Library' : (sourcePathsReady && supportsNativeSourcePaths(status?.capabilities) ? roots.find(root => root.id === saved.configuration.localRootId)?.sourcePath : undefined) || 'Folder path unavailable', id: saved.id, name: saved.configuration.name, href: `/things?${new URLSearchParams({ folder: saved.configuration.remoteFolderId })}`,
			quickError: !active && job?.state === 'attention' ? syncJobAttentionMessage(job) : !active && task?.status === 'error' ? progress?.message || 'This sync config needs attention.' : '',
			quickLabel: task?.stopping ? 'Pausing…' : active ? 'Pause sync' : needsWriteApproval ? 'Approve folder writes' : saved.configuration.paused ? saved.configuration.mode === 'backup' ? 'Start backup' : 'Resume sync' : task?.status === 'paused' || job?.state === 'paused' ? 'Resume sync' : task?.status === 'error' ? 'Retry transfer' : saved.configuration.mode === 'backup' ? 'Start backup' : 'Sync now',
			quickDisabled: active ? !online || !!pausingId || !!task?.stopping : busy || retainedDrafts.current.has(saved.id) || !draftReady || !online || !!status?.task?.active,
			startLabel: saved.configuration.mode === 'backup' ? 'Start backup' : 'Sync now',
			mode: ({ 'two-way': 'Two-way sync', upload: 'Device to cloud', download: 'Cloud to device', backup: 'Backup to cloud · keep deleted files' })[saved.configuration.mode],
			status: savedOnly ? '' : saved.configuration.paused ? 'Saved configuration: paused' : !online ? 'Device unavailable · settings remain editable' : task?.stopping ? 'Pausing…' : task?.waiting ? 'Waiting for this device’s conditions' : active ? 'Transfer in progress' : task?.status === 'error' ? 'Needs attention' : task?.status === 'complete' ? 'Last transfer finished' : job?.state === 'paused' ? 'Sync is paused' : 'Ready to sync',
			progress: progress ? progress.message || `${progress.stage} · ${progress.confirmed} of ${progress.total} operations confirmed${progress.path ? ` · ${progress.path}` : ''}` : 'No transfer statistics yet',
			speed: rates ? `Upload ${rate(rates.upload)} · Download ${rate(rates.download)}` : '',
			startDisabled: busy || retainedDrafts.current.has(saved.id) || !online,
			pauseDisabled: !online || !!pausingId || !!task?.stopping || (!active && !job),
			interval: intervals[saved.id] ?? job?.intervalMs ?? 300_000,
			automatic: !online ? 'Automatic sync status will appear when the device connects.' : job?.pendingFolderValidation ? 'Folder access will be checked before transferring files.' : job?.intervalMs && ['runnable', 'scheduled'].includes(job.state)
				? job.nextRunAt ? `Automatic sync is on. Next check: ${new Date(job.nextRunAt).toLocaleTimeString()}.` : 'Automatic sync is on.' : job?.state === 'attention' ? syncJobAttentionMessage(job) : !canEnroll && saved.configuration.sourceKind !== 'photos' ? 'Update Thingtime on this device to enable automatic folder sync.' : 'Automatic sync is off.' };
	});
	type ConfigView = typeof projected[number];
	const groups = new Map<string, { id: string; name: string; path: string; canManage: boolean; accessDescription: string; configs: ConfigView[];
		drafts: { id: string; name: string; editorHidden: boolean; editorSlotId: string }[] }>();
	for (const root of formRoots) {
		const granted = roots.some(row => row.id === root.id);
		groups.set(root.id, { id: root.id, name: root.name,
			path: granted && root.sourceKind !== 'photos' && sourcePathsReady && supportsNativeSourcePaths(status?.capabilities) ? root.sourcePath ?? '' : '',
			canManage: granted && !savedOnly, accessDescription: granted ? '' : savedOnly || !online || !status?.rootsReady ? 'Folder access can be verified on the device.' : 'Folder access missing on this device.',
			configs: [], drafts: [] });
	}
	for (const row of projected) groups.get(row.sourceId)?.configs.push(row);
	const savedIds = new Set(connections.map(saved => saved.id));
	for (const draft of retainedDrafts.current.values()) if (!savedIds.has(draft.id)) {
		const id = draft.configuration.localRootId;
		if (!groups.has(id)) groups.set(id, { id, name: 'Saved device folder', path: '', canManage: false, accessDescription: 'Folder access can be verified on the device.', configs: [], drafts: [] });
		groups.get(id)!.drafts.push({ id: draft.id, name: draft.configuration.name || 'New sync config', editorHidden: selectedId !== draft.id, editorSlotId: `${editorPrefix}-${draft.id}` });
	}
	const addConfig = (root: MobileFolder) => {
		const next = newSyncConfigDraft(root, scope.deviceId, root.sourceKind === 'photos');
		revealDraft(next.id);
		edit(next);
	};
	const setUp = async (root: MobileFolder) => {
		const seen = new Set<string>();
		let cursor = await load('connections');
		while (cursor && !connectionsRef.current.some(row => row.configuration.localRootId === root.id)) {
			if (seen.has(cursor)) throw Error('The sync config list repeated a page. Refresh and try again.');
			seen.add(cursor);
			cursor = await load('connections', cursor);
		}
		const retained = [...retainedDrafts.current.values()].find(row => row.configuration.localRootId === root.id);
		const existing = connectionsRef.current.find(row => row.configuration.localRootId === root.id);
		if (retained) await open(retained.id);
		else if (existing) setSelectedId(existing.id);
		else addConfig(root);
	};
	const display = {
		remote: {
			hasLiveControls: !savedOnly,
			help: savedOnly ? 'Edit saved settings here. To start, pause, or check a transfer, open Thingtime on the device.' : 'Manage this device from any browser. Transfers continue on the device while Thingtime is running there. Folder selection, download approval and file recovery may ask for confirmation on that device.',
			status: savedOnly ? '' : online && status ? `Connected to this device · Updated ${new Date(status.observedAt).toLocaleTimeString()}` : deviceError || 'Connecting to this device. Saved settings are available independently.',
			error: error || (!draft ? storageError : ''), notice, busy, checking, editDisabled: busy || !!storageError || !draftReady, addDisabled: busy || !!storageError || !draftReady || !online || !loaded || !status?.rootsReady,
			deviceDisabled: busy || !online || !loaded || !status?.rootsReady,
			connections: projected, groups: [...groups.values()].map(group => ({ ...group, addLabel: group.configs.length || group.drafts.length ? 'Add sync config' : 'Set up sync' })),
			empty: loaded ? 'No folders with saved sync configs for this device.' : '', hasMore: !!connectionCursor

		}
	};
	return <Box minWidth={0}>
		<Controls documentKey="remote-device-sync" title="Remote device sync" blocks={remoteSyncBlocks} scopeKey={scopeKey} scope={display} onError={() => setError('The sync action could not be completed. Refresh and retry.')} actions={{
			'refresh-settings': () => run(async () => { await load('connections'); await load('folders'); }), 'refresh-device': refreshStatus,
			more: () => run(async () => { await load('connections', connectionCursor); }),
			add: ({ inputs }) => {
				if (display.remote.addDisabled || !loaded || !status?.rootsReady) return;
				const root = roots.find(row => row.id === inputs.rootId);
				const group = root && groups.get(root.id);
				if (!root || !group?.canManage) return;
				if (group.configs.length || group.drafts.length) addConfig(root);
				else return run(() => setUp(root));
			},
			'edit-draft': ({ inputs }) => { if (!busy && draftReady && !storageError && typeof inputs.id === 'string' && retainedDrafts.current.has(inputs.id)) return run(() => open(String(inputs.id))); },
			edit: ({ inputs }) => { if (selectedId === inputs.id) void run(() => open(selected(inputs.id).id)); },
			expand: ({ inputs }) => { const id = selected(inputs.id).id; if (selectedId === id) { setSelectedId(null); setDetailsId(null); } else if (!busy && draftReady && !storageError) { setSelectedId(id); setDetailsId(null); if (retainedDrafts.current.has(id)) void run(() => open(id)); } },
			choose: () => run(async () => {
				if (!online || !status?.rootsReady || !loaded) return;
				const result = await send<FolderResult>({ action: 'folders', request: { action: 'choose' } });
				const added = newlyGrantedFolder(roots, result.roots);
				await refreshStatus();
				if (added && draftReady && !storageError) await setUp(added);
			}),
			remove: ({ inputs }) => run(async () => { if (!online || typeof inputs.rootId !== 'string' || !roots.some(root => root.id === inputs.rootId)) throw Error('Refresh the device folder list.'); await send({ action: 'folders', request: { action: 'remove', rootId: inputs.rootId } }); await refreshStatus(); }),
			quick: ({ inputs }) => {
				const task = status?.task?.connectionId === inputs.id ? status.task : null;
				const job = status?.jobs.find(row => row.connectionId === inputs.id);
				return task?.active ? pause(inputs.id) : start(inputs.id, canEnroll && job?.state === 'attention' && job.failureReason === 'write-approval', true);
			},
			start: ({ inputs }) => start(inputs.id, false), automatic: ({ inputs }) => start(inputs.id, true),
			details: ({ inputs }) => { if (online && selectedId === inputs.id) setDetailsId(selected(inputs.id).id); },
			pause: ({ inputs }) => pause(inputs.id),
			history: ({ inputs }) => { if (!canShowHistory) return; const id = selected(inputs.id).id; setHistoryId(previous => previous === id ? null : id); },
			interval: ({ inputs, value }) => { const saved = selected(inputs.id), interval = Number(value); if (selectedId !== saved.id) return; if (!SYNC_INTERVALS.some(ms => ms === interval)) throw Error('Choose a supported interval.'); setIntervals(previous => ({ ...previous, [saved.id]: interval })); }
		}} />
		{historySaved && <SyncEditorPlacement key={historySaved.id} targetId={`${editorPrefix}-activity-${historySaved.id}`}>
			<SyncConfigActivity scope={{ ...scope, rootId: historySaved.id }} scopeKey={`${scopeKey}:activity:${historySaved.id}`}
				generation={generation} currentOrigin={() => window.location.origin}
				remotePage={(signal, before) => readRemoteSyncActivity(client, historySaved.id, { signal, before })} />
		</SyncEditorPlacement>}
		{active && detailsSaved && online && <SettingsSection eyebrow={`${detailsSaved.configuration.name} · Progress, coverage & priorities`} open onToggle={open => { if (!open) setDetailsId(null); }}>
			<RemoteSyncDetails speedDraftState={speedDrafts.current.get(detailsSaved.id)} draftState={priorityDrafts.current.get(detailsSaved.id)} saved={detailsSaved} scope={{ ...scope, rootId: detailsSaved.id }} generation={generation} status={status} command={client.send} />
		</SettingsSection>}
		{[...retainedDrafts.current.values()].map(draft => <SyncEditorPlacement key={draft.id} targetId={`${editorPrefix}-${draft.id}`}><Box hidden={selectedId !== draft.id} marginTop={4} padding={3} border="1px solid var(--tt-border, #ddd)" borderRadius="12px" minWidth={0}>
			<SyncConfigurationForm iosManagedResources={devicePlatform === 'ios' || iosManagedSyncResources(status?.capabilities)} sourcePathsAvailable={sourcePathsReady && supportsNativeSourcePaths(status?.capabilities)} draft={draft} roots={formRoots} lockSource={roots.some(root => root.id === draft.configuration.localRootId)} folders={folders} disabled={busy || draft.pending || !draftReady} scopeKey={`${scopeKey}:${draft.id}`} onChange={edit} onResourceDraftChange={resourceDraft => { const latest = retainedDrafts.current.get(draft.id); if (latest) edit({ ...latest, resourceDraft }); }} onResourceValidityChange={valid => { resourceValidity.current.set(draft.id, valid); if (selectedId === draft.id) setResourceValid(valid); }} />
			<Controls documentKey="remote-sync-editor" title="Sync config actions" blocks={remoteSyncEditorBlocks} scopeKey={`${scopeKey}:${draft.id}`} scope={{ editor: {
				status: draft.enrollment?.savedRevision
					? canEnroll ? 'Settings are saved. Retry automatic setup to finish this exact config.' : 'Settings are saved. Reconnect this device to finish automatic setup.'
					: draft.pending ? 'This save is not confirmed. Retry checks the same sync config without creating a duplicate.' : 'Draft saved in this browser. Saving settings does not grant folder permission or start a transfer.',
				error: storageError || (conflict ? conflict.message : ''), canSync: canEnroll && draft.configuration.sourceKind !== 'photos' && !draft.configuration.paused, syncLabel: draft.enrollment?.savedRevision ? 'Retry automatic setup' : draft.pending ? 'Retry save & sync' : 'Save & sync', canSave: !draft.enrollment, canKeepSaved: !!draft.enrollment?.savedRevision, saveLabel: draft.pending ? 'Retry save' : 'Save sync config', saveDisabled: busy || !draftReady || !resourceValid || !!conflict,
				discardDisabled: busy || !draftReady || draft.pending, hasConflict: !!conflict, hasMoreFolders: !!folderCursor, busy
			} }} onError={() => setError('The sync config action could not be completed.')} actions={{
				save: () => save(), 'save-sync': () => save(true),
				'keep-saved': () => run(async () => { if (draft.enrollment?.savedRevision) { cancelSyncEnrollmentRecovery(scope); persist(null); setNotice('Saved settings kept. Check this config’s automatic sync status.'); } }),
				discard: () => run(async () => { if (!draft.pending) persist(null); }),
				reload: () => run(async () => { if (conflict?.latest) await open(draft.id, true); else persist(null); setConflict(null); }), 'more-folders': () => run(async () => { await load('folders', folderCursor); })
			}} />
		</Box></SyncEditorPlacement>)}
		{review && reviewSaved && <Controls documentKey="sync-conflict-review" title="Sync conflict review" blocks={syncConflictReviewBlocks} scopeKey={`${scopeKey}:${review.id}`}
			scope={syncConflictReviewDisplay({ ...review.view, busy: busy || !online || review.view.busy }, reviewSaved.configuration.mode)} onError={() => setError('The conflict review changed. Refresh the device before continuing.')} actions={{
				reload: () => reviewAction('reload'), previous: () => reviewAction('previous'), next: () => reviewAction('next'),
				choose: ({ inputs, value }) => reviewAction('choose', { path: inputs.path, revision: inputs.revision, from: value === '' ? null : value }),
				resolve: () => reviewAction('finish', { resolution: 'resolve', revision: review.view.page?.progress.revision }), retain: () => reviewAction('finish', { resolution: 'retain', revision: review.view.page?.progress.revision }), cancel: () => reviewAction('cancel'),
				history: ({ inputs }) => { const row = review.view.page?.rows.find(row => row.conflict.path === inputs.path && row.revision === inputs.revision); if (row?.conflict.remote?.kind === 'file') openThingHistory(row.conflict.remote.id, ['file']); }
			}} />}
		{supportsMobileTrashRecovery(status?.capabilities) && <SyncDetailsSection title="Recover device files" retainChildren><NativeFileRecovery roots={roots} busy={busy || !online}
			versionsScopeKey={supportsNativeFileVersions(status?.capabilities) ? scopeKey : undefined}
			perform={work => run(async () => { await work(async request => send<FolderResult>(validateRemoteSyncCommand({ action: 'folders', request }))); })} /></SyncDetailsSection>}
	</Box>;
}
