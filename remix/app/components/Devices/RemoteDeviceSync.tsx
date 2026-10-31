import type { TransferSpeedDraftState } from './TransferSpeedTrackers';
import { SyncEditorPlacement } from './SyncEditorPlacement';
import type { UploadPriorityDraftState } from './SyncUploadPriorities';
import { supportsNativeSourcePaths, validNativeSourcePath } from '~/fileSync/mobileFolders.client';
import { prepareSyncCloudDestination } from '~/fileSync/cloudDestination';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { readStampedCache, writeStampedCache, pruneCacheNamespace } from '~/hooks/localCache';
import { rootIdentity } from '~/utils/rootIdentity';
import { createRemoteSyncClient, negotiateRemoteSourcePaths } from '~/fileSync/remoteSyncClient.client';
import { type RemoteSyncStatus, type RemoteSyncCommand, validateRemoteSyncCommand } from '~/fileSync/remoteSyncProtocol';
import { type FolderResult, type MobileFolder, supportsMobileTrashRecovery, supportsNativeFileVersions } from '~/fileSync/mobileFolders.client';
import { type SavedFileSyncConfiguration, readOwnedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { newFileSyncConfiguration, FILE_SYNC_RESOURCE_REQUIREMENTS } from '~/fileSync/configuration';
import { fileSyncDownloadRequirements } from '~/fileSync/signedDownloadTarget';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { canonicalDraftConfiguration, configurationDraftKey, ConfigurationConflict, persistConfigurationDraft, readConfigurationDraft,
	readOwnedSyncFolder, saveConfigurationDraft, type ConfigurationDraft, type ConfigurationEditorScope } from '~/fileSync/configurationEditor';
import { assertRemoteDeviceRoot, hasSavedDeviceRoot } from '~/fileSync/remoteConfigurationRoot';
import { SYNC_INTERVALS } from '~/fileSync/syncJobJournal';
import { SyncConfigurationForm } from './MobileSyncConnections';
import { NativeFileRecovery } from './NativeFileRecovery';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { remoteSyncBlocks, remoteSyncEditorBlocks, remoteSyncDisclosureBlocks } from './remoteSyncBlocks';
import { syncConflictReviewBlocks, syncConflictReviewDisplay } from './syncConflictReviewBlocks';
import { openThingHistory } from '../Timeline/TimelineHost';
import { SyncDetailsSection } from './SyncDetailsSection';
import { SettingsSection } from '../Settings/SettingsSection';
import { RemoteSyncDetails } from './RemoteSyncDetails';
import type { SpeedReading } from '~/fileSync/transferSpeed';

function Controls({ documentKey, title, blocks, scopeKey, scope, actions, onError }: {
	documentKey: string; title: string; blocks: WebpageBlock[]; scopeKey: string; scope: Record<string, unknown>; actions: TransientBlockActions; onError(): void;
}) {
	return <SettingsDocumentHost documentKey={documentKey} title={title} defaultDocument={blocks} scopeKey={scopeKey}>
		{({ blocks: saved, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={scope} actions={actions} enabled={!editing} onError={onError}>
			<WebpageBlocksRenderer blocks={documentKey === 'remote-device-sync' ? remoteSyncDisclosureBlocks(saved) : saved} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}

/** The enclosing device view verifies ownership. This boundary also removes
 * protected state synchronously when the signed-in identity or storage changes. */
export function RemoteDeviceSync({ ownerId, deviceId, active = true }: { ownerId: string; deviceId: string; active?: boolean }) {
	const user = useCurrentUser(), dataPlane = useDataPlane();
	const identity = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	if (user?.id !== ownerId || user.temporary || user.isCharacter || user.accountKind !== 'user' || dataPlane !== 'home' || identity.pending || typeof window === 'undefined') return null;
	const scope = { origin: window.location.origin, ownerId, deviceId, dataPlane };
	return <RemoteConnections active={active} key={`${configurationDraftKey(scope)}:${identity.generation}`} scope={scope} generation={identity.generation} />;
}

function RemoteConnections({ scope, generation, active }: { scope: ConfigurationEditorScope; generation: number; active: boolean }) {
	const visible = useRef(active); visible.current = active;
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
		try { const raw = window.localStorage.getItem(key); return { raw, draft: readConfigurationDraft(raw, scope.deviceId), error: '' }; }
		catch (cause) { return { raw: null, draft: null, error: cause instanceof Error ? cause.message : 'The saved draft could not be read.' }; }
	});
	const raw = useRef(initial.raw);
	const [draft, setDraft] = useState<ConfigurationDraft | null>(initial.draft);
	const retainedDrafts = useRef(new Map<string, ConfigurationDraft>(initial.draft ? [[initial.draft.id, initial.draft]] : []));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const editorPrefix = React.useId();
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
	const connectionsRef = useRef(connections); connectionsRef.current = connections;
	const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
	const [connectionCursor, setConnectionCursor] = useState<string | null>(null), [folderCursor, setFolderCursor] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), busyRef = useRef(false);
	const [error, setError] = useState(''), [notice, setNotice] = useState('');
	const [status, setStatus] = useState<RemoteSyncStatus | null>(null), [online, setOnline] = useState(false), [checking, setChecking] = useState(false);
	const [deviceError, setDeviceError] = useState('');
	const [sourcePathsReady, setSourcePathsReady] = useState(false);
	const statusController = useRef<AbortController | null>(null);
	const refreshAgain = useRef(false);
	const [intervals, setIntervals] = useState<Record<string, number>>({});
	const [detailsId, setDetailsId] = useState<string | null>(null);
	const [pausingId, setPausingId] = useState<string | null>(null);
	const pausing = useRef(false);
	const cache = (rows: SavedFileSyncConfiguration[]) => {
		check(); setConnections(rows); connectionsRef.current = rows;
		writeStampedCache(cacheKey, rows.map(row => ({ id: row.id, updatedAt: row.updatedAt, crystal: row.configuration,
			author: { id: scope.ownerId }, acl: ['tt:user'], thingtime: ['file-sync'] })));
		pruneCacheNamespace('tt-remote-sync-connections:', cacheKey, 32);
	};
	const persist = (next: ConfigurationDraft | null) => {
		if (next) retainedDrafts.current.set(next.id, next);
		else if (draft) retainedDrafts.current.delete(draft.id);
		check(); raw.current = persistConfigurationDraft(window.localStorage, key, raw.current, next); setDraft(next); setStorageError('');
	};
	const edit = (next: ConfigurationDraft) => {
		retainedDrafts.current.set(next.id, next); setSelectedId(next.id);
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
		const result = await apiRef.current.v1.things.list({ thingtime: kind === 'connections' ? 'file-sync' : 'folder', limit: 50, cursor }, options());
		activeSignal.throwIfAborted(); check(); if (!Array.isArray(result.things)) throw Error('Saved sync settings could not be loaded. Refresh to retry.');
		if (kind === 'connections') {
			const accepted = result.things.flatMap(row => { try { const saved = readOwnedFileSyncConfiguration(row, scope.ownerId); return saved.configuration.deviceId === scope.deviceId ? [saved] : []; } catch { return []; } });
			cache([...new Map([...(cursor ? connectionsRef.current : []), ...accepted].map(row => [row.id, row])).values()]);
			setConnectionCursor(result.nextCursor ?? null); setLoaded(true);
		} else {
			const accepted = result.things.flatMap(row => { try { return [readOwnedSyncFolder(row, scope.ownerId)]; } catch { return []; } });
			setFolders(previous => [...new Map([...(cursor ? previous : []), ...accepted].map(row => [row.id, row])).values()]); setFolderCursor(result.nextCursor ?? null);
		}
	};
	const refreshStatus = async () => {
		if (lifetime.current.signal.aborted) return;
		if (statusController.current) { refreshAgain.current = true; return; }
		const controller = new AbortController(); statusController.current = controller; setChecking(true);
		try {
			let cursor: string | undefined, snapshot: RemoteSyncStatus | undefined;
			const cursors = new Set<string>(), roots = new Map<string, MobileFolder>(), jobs = new Map<string, RemoteSyncStatus['jobs'][number]>();
			do {
				const value = await client.send<RemoteSyncStatus>({ action: 'status', ...(cursor ? { cursor } : {}) }, { signal: controller.signal, timeoutMs: 12_000 }); check();
				if (value?.version !== 1 || value.deviceId !== scope.deviceId || !Array.isArray(value.roots) || !Array.isArray(value.jobs) || !Number.isFinite(Date.parse(value.observedAt)) ||
					value.roots.some(root => !root || typeof root.id !== 'string' || typeof root.name !== 'string' || (root.sourcePath !== undefined && (!validNativeSourcePath(root.sourcePath) || root.sourceKind === 'photos'))) || value.jobs.some(job => !job || typeof job.connectionId !== 'string') ||
					(value.nextCursor !== undefined && (typeof value.nextCursor !== 'string' || cursors.has(value.nextCursor)))) throw Error('The device returned an invalid sync status.');
				for (const root of value.roots) roots.set(root.id, root);
				for (const job of value.jobs) jobs.set(job.connectionId, job);
				snapshot = value; cursor = value.nextCursor; if (cursor) cursors.add(cursor);
			} while (cursor);
			setStatus({ ...snapshot!, roots: [...roots.values()], jobs: [...jobs.values()] }); setOnline(true); setDeviceError('');
		} catch (cause) { if (!lifetime.current.signal.aborted && !controller.signal.aborted) { setOnline(false); setDeviceError(cause instanceof Error ? cause.message : 'Device unavailable. Saved settings remain editable.'); } }
		finally { if (statusController.current === controller) { statusController.current = null; if (!lifetime.current.signal.aborted) { setChecking(false); if (refreshAgain.current) { refreshAgain.current = false; void refreshStatus(); } } } }
	};
	useEffect(() => {
		if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
		const effectSignal = lifetime.current.signal;
		void negotiateRemoteSourcePaths().then(available => { if (!effectSignal.aborted) { check(); setSourcePathsReady(available); } }).catch(() => { if (!effectSignal.aborted) setSourcePathsReady(false); });
		void run(async () => { await load('connections'); await load('folders'); });
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => { if (effectSignal.aborted) return; if (visible.current && document.visibilityState === 'visible') await refreshStatus(); if (!effectSignal.aborted) timer = setTimeout(poll, 10_000); };
		void poll();
		const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) { setDraftReady(false); setStorageError('This draft changed in another tab. Reload this page before saving.'); } };
		window.addEventListener('storage', changed);
		// Invalidate the latest operation, including operations started after setup.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		return () => { lifetime.current.abort(); ++operationSequence.current; busyRef.current = false; statusController.current?.abort(); statusController.current = null; clearTimeout(timer); window.removeEventListener('storage', changed); };
		// Scope and generation are the mounted component identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const open = async (id: string, replace = false) => {
		setSelectedId(id); setDetailsId(null); setResourceValid(resourceValidity.current.get(id) ?? true);
		const retained = !replace && retainedDrafts.current.get(id);
		if (retained) { persist(retained); setConflict(null); return; }
		const result = await apiRef.current.v1.things.get({ id }, options()); check();
		const saved = readOwnedFileSyncConfiguration(result.thing, scope.ownerId);
		if (saved.id !== id || saved.configuration.deviceId !== scope.deviceId) throw Error('This connection belongs to another device.');
		persist({ version: 1, id, baseUpdatedAt: saved.updatedAt, configuration: saved.configuration, exclusions: saved.configuration.excludedPaths.join('\n'), pending: false }); setConflict(null);
	};
	const save = () => run(async () => {
		if (!draft || !draftReady || !resourceValid) return;
		let prepared = draft;
            if (draft.baseUpdatedAt === null && !draft.configuration.remoteFolderId) {
                const source = roots.find(root => root.id === draft.configuration.localRootId);
                if (!source || !sourcePathsReady || !supportsNativeSourcePaths(status?.capabilities) || !validNativeSourcePath(source?.sourcePath) || source?.sourceKind === 'photos') throw Error('Choose a private cloud folder. This device has not provided the selected folder’s absolute path.');
                const destination = await prepareSyncCloudDestination({ baseUpdatedAt: null, remoteFolderId: '', source }, scope, {
                    assertCurrent: check,
                    negotiate: async requirements => { for (const [feature, minimum] of Object.entries(requirements)) await requireThingtimeCapability(feature, minimum); },
                    get: async id => (await apiRef.current.v1.things.get({ id }, options())).thing,
                    create: input => apiRef.current.v1.things.create(input, options())
                });
                check();
                prepared = { ...draft, configuration: { ...draft.configuration, remoteFolderId: destination.id } };
                persist(prepared); setFolders(previous => [...previous.filter(folder => folder.id !== destination.id), destination]);
            }
            const pending = { ...prepared, configuration: canonicalDraftConfiguration(prepared), pending: true };
		if (pending.configuration.resourceLimits) for (const [feature, minimum] of Object.entries({ ...FILE_SYNC_RESOURCE_REQUIREMENTS, ...fileSyncDownloadRequirements(pending.configuration) })) await requireThingtimeCapability(feature, minimum);
		else if (pending.configuration.ignoreRules) await requireThingtimeCapability('api.things', '1.38.0');
		persist(pending);
		let previous: SavedFileSyncConfiguration | null = null, dispatched = false;
		let saved: SavedFileSyncConfiguration;
		try {
			saved = await saveConfigurationDraft(pending, scope, { assertCurrent: check,
				get: async id => { const value = (await apiRef.current.v1.things.get({ id }, options())).thing; check(); if (id === pending.id) previous = readOwnedFileSyncConfiguration(value, scope.ownerId); return value; },
				create: (id, configuration) => { dispatched = true; return apiRef.current.v1.things.create({ shareId: id, thingtime: ['file-sync'], crystal: configuration, acl: ['tt:user'] }, options()); },
				update: (id, configuration, expectedUpdatedAt) => { dispatched = true; return apiRef.current.v1.things.update({ id, crystal: configuration, expectedUpdatedAt, replaceCrystal: true }, options()); },
				verifyDeviceRoot: async deviceId => {
					if (hasSavedDeviceRoot(previous, pending.configuration, deviceId)) return;
					const result = await client.send<FolderResult>({ action: 'folders', request: { action: 'list' } }); check();
					assertRemoteDeviceRoot(result.roots, pending.configuration, scope.deviceId);
				}
			});
		} catch (cause) { check(); if (!draft.pending && !dispatched && !(cause instanceof ConfigurationConflict)) persist(prepared); throw cause; }
		check(); persist(null); setConflict(null); cache([saved, ...connectionsRef.current.filter(row => row.id !== saved.id)]);
		setNotice('Connection saved to your account. The device uses these settings when you start or resume sync.');
	});
	const send = async <T,>(command: RemoteSyncCommand): Promise<T> => {
		check(); setNotice('Waiting for this device to confirm…');
		const result = await client.send<T>(command); check(); setNotice('Device request completed.'); return result;
	};
	const roots = status?.roots ?? [];
	const formRoots = [...new Map([...connections.map(row => ({ id: row.configuration.localRootId, name: `Saved device folder · ${row.configuration.localRootId}`, ...(row.configuration.sourceKind === 'photos' ? { sourceKind: 'photos' as const } : {}) })), ...roots].map(root => [root.id, root])).values()];
	const selected = (id: unknown) => { check(); const saved = connectionsRef.current.find(row => row.id === id); if (!saved || saved.configuration.deviceId !== scope.deviceId) throw Error('Refresh this device’s connections before continuing.'); return saved; };
	const start = (id: unknown, automatic: boolean) => run(async () => {
		const saved = selected(id); if (selectedId !== saved.id || retainedDrafts.current.has(saved.id) || !online || saved.configuration.paused) throw Error('Save the connection and connect the device before starting sync.');
		await send({ action: 'start', connectionId: saved.id, expectedUpdatedAt: saved.updatedAt, ...(automatic ? { intervalMs: intervals[saved.id] ?? status?.jobs.find(job => job.connectionId === saved.id)?.intervalMs ?? 300_000 } : {}) });
		await refreshStatus();
	});
	const pause = async (id: unknown) => {
		if (pausing.current || !online) return;
		const activeSignal = lifetime.current.signal;
		try {
			const saved = selected(id); if (selectedId !== saved.id) return; pausing.current = true; setPausingId(saved.id); setError('');
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
	const display = {
		remote: {
			status: online && status ? `Connected to this device · Updated ${new Date(status.observedAt).toLocaleTimeString()}` : deviceError || 'Connecting to this device. Saved settings are available independently.',
			error: error || (!draft ? storageError : ''), notice, busy, checking, editDisabled: busy || !!draft?.pending || !draftReady, addDisabled: busy || !!draft || !draftReady || !online || !roots.length,
			deviceDisabled: busy || !online, roots: roots.map(root => ({ ...root, path: (sourcePathsReady && supportsNativeSourcePaths(status?.capabilities) ? root.sourcePath : undefined) || 'Folder path unavailable', accessDescription: connections.some(saved => saved.configuration.localRootId === root.id) ? 'Folder access granted · sync configured below' : 'Folder access granted · no sync connection configured' })), rootsEmpty: online ? status?.rootsReady === false ? 'Folder access will refresh after the current device operation.' : 'No folders selected. Choose a device folder to begin.' : 'Connect the device to manage its folder access.',
			empty: loaded ? 'No saved sync connections for this device.' : 'Reading saved sync connections…', hasMore: !!connectionCursor,
			connections: connections.map(saved => {
				const job = status?.jobs.find(row => row.connectionId === saved.id), task = status?.task?.connectionId === saved.id ? status.task : null;
				const progress = task?.progress, active = !!task?.active;
				const rates = task?.transferRates;
				const rate = (reading: SpeedReading) => reading.status === 'known' ? `${reading.value.toFixed(2)} ${reading.unit}` : reading.status === 'paused' ? 'paused' : 'unavailable';
				return { editorSlotId: `${editorPrefix}-${saved.id}`, editorHidden: selectedId !== saved.id, toggleGlyph: selectedId === saved.id ? '⌃' : '⌄', summaryStatus: saved.configuration.paused || task?.status === 'paused' || job?.state === 'paused' ? 'Paused' : !online ? 'Device offline' : !roots.some(root => root.id === saved.configuration.localRootId) ? 'Folder access missing' : active ? 'Running' : 'No active transfer', quickStats: progress ? `${progress.confirmed} / ${progress.total} confirmed` : 'No transfer statistics yet', expanded: selectedId === saved.id, expandLabel: selectedId === saved.id ? 'Collapse folder' : 'Expand folder', path: (sourcePathsReady && supportsNativeSourcePaths(status?.capabilities) ? roots.find(root => root.id === saved.configuration.localRootId)?.sourcePath : undefined) || 'Folder path unavailable', id: saved.id, name: saved.configuration.name, href: `/things?${new URLSearchParams({ folder: saved.configuration.remoteFolderId })}`,
					mode: ({ 'two-way': 'Two-way sync', upload: 'Device to cloud', download: 'Cloud to device', backup: 'Backup to cloud · keep deleted files' })[saved.configuration.mode],
					status: saved.configuration.paused ? 'Saved configuration: paused' : !online ? 'Device unavailable · settings remain editable' : task?.stopping ? 'Pausing…' : task?.waiting ? 'Waiting for this device’s conditions' : active ? 'Transfer in progress' : task?.status === 'error' ? 'Needs attention' : task?.status === 'complete' ? 'Last transfer finished' : job?.state === 'paused' ? 'Sync is paused' : 'Ready to sync',
					progress: progress ? progress.message || `${progress.stage} · ${progress.confirmed} of ${progress.total} operations confirmed${progress.path ? ` · ${progress.path}` : ''}` : 'No transfer statistics yet',
					speed: rates ? `Upload ${rate(rates.upload)} · Download ${rate(rates.download)}` : '',
					startDisabled: busy || retainedDrafts.current.has(saved.id) || !online || !!status?.task?.active || saved.configuration.paused,
					pauseDisabled: !online || !!pausingId || !!task?.stopping || (!active && !job),
					interval: intervals[saved.id] ?? job?.intervalMs ?? 300_000,
					automatic: !online ? 'Automatic sync status will appear when the device connects.' : job?.intervalMs && ['runnable', 'scheduled'].includes(job.state)
						? job.nextRunAt ? `Automatic sync is on. Next check: ${new Date(job.nextRunAt).toLocaleTimeString()}.` : 'Automatic sync is on.' : job?.state === 'attention' ? 'Automatic sync needs attention. Pause its saved job before restarting with changed settings.' : 'Automatic sync is off.' };
			})
		}
	};
	return <Box minWidth={0}>
		<Controls documentKey="remote-device-sync" title="Remote device sync" blocks={remoteSyncBlocks} scopeKey={scopeKey} scope={display} onError={() => setError('The sync action could not be completed. Refresh and retry.')} actions={{
			refreshSettings: () => run(async () => { await load('connections'); await load('folders'); }), refreshDevice: refreshStatus,
			more: () => run(() => load('connections', connectionCursor)),
			add: () => { if (display.remote.addDisabled) return; edit({ version: 1, id: crypto.randomUUID(), baseUpdatedAt: null, pending: false, exclusions: '', configuration: { ...newFileSyncConfiguration({ name: roots[0].name, deviceId: scope.deviceId, localRootId: roots[0].id, remoteFolderId: 'unselected', sourceKind: roots[0].sourceKind }), remoteFolderId: '' } }); },
			edit: ({ inputs }) => { if (selectedId === inputs.id) void run(() => open(selected(inputs.id).id)); },
			expand: ({ inputs }) => { const id = selected(inputs.id).id; if (selectedId === id) { setSelectedId(null); setDetailsId(null); } else if (!busy && !draft?.pending) { setSelectedId(id); setDetailsId(null); if (retainedDrafts.current.has(id)) void run(() => open(id)); } },
			choose: () => run(async () => { if (!online) return; await send({ action: 'folders', request: { action: 'choose' } }); await refreshStatus(); }),
			remove: ({ inputs }) => run(async () => { if (!online || typeof inputs.rootId !== 'string' || !roots.some(root => root.id === inputs.rootId)) throw Error('Refresh the device folder list.'); await send({ action: 'folders', request: { action: 'remove', rootId: inputs.rootId } }); await refreshStatus(); }),
			start: ({ inputs }) => start(inputs.id, false), automatic: ({ inputs }) => start(inputs.id, true),
			details: ({ inputs }) => { if (online && selectedId === inputs.id) setDetailsId(selected(inputs.id).id); },
			pause: ({ inputs }) => pause(inputs.id),
			interval: ({ inputs, value }) => { const saved = selected(inputs.id), interval = Number(value); if (selectedId !== saved.id) return; if (!SYNC_INTERVALS.some(ms => ms === interval)) throw Error('Choose a supported interval.'); setIntervals(previous => ({ ...previous, [saved.id]: interval })); }
		}} />
		{active && detailsSaved && online && <SettingsSection eyebrow={`${detailsSaved.configuration.name} · Progress, coverage & priorities`} open onToggle={open => { if (!open) setDetailsId(null); }}>
			<RemoteSyncDetails speedDraftState={speedDrafts.current.get(detailsSaved.id)} draftState={priorityDrafts.current.get(detailsSaved.id)} saved={detailsSaved} scope={{ ...scope, rootId: detailsSaved.id }} generation={generation} status={status} command={client.send} />
		</SettingsSection>}
		{[...retainedDrafts.current.values()].filter(row => !connections.some(saved => saved.id === row.id)).map(row => <SettingsSection key={`draft-${row.id}`} eyebrow={row.configuration.name || 'New folder connection'} description="Unsaved connection settings" summary="Draft · no transfer started" open={selectedId === row.id} onToggle={expanded => { if (expanded) { setSelectedId(row.id); setDraft(row); } else if (selectedId === row.id) setSelectedId(null); }}><Box>Continue editing this draft below.</Box></SettingsSection>)}
		{[...retainedDrafts.current.values()].map(draft => <SyncEditorPlacement key={draft.id} targetId={connections.some(saved => saved.id === draft.id) ? `${editorPrefix}-${draft.id}` : undefined}><Box hidden={selectedId !== draft.id} marginTop={4} padding={3} border="1px solid var(--tt-border, #ddd)" borderRadius="12px" minWidth={0}>
			<SyncConfigurationForm sourcePathsAvailable={sourcePathsReady && supportsNativeSourcePaths(status?.capabilities)} draft={draft} roots={formRoots} folders={folders} disabled={busy || draft.pending || !draftReady} scopeKey={`${scopeKey}:${draft.id}`} onChange={edit} onResourceValidityChange={valid => { resourceValidity.current.set(draft.id, valid); if (selectedId === draft.id) setResourceValid(valid); }} />
			<Controls documentKey="remote-sync-editor" title="Sync connection actions" blocks={remoteSyncEditorBlocks} scopeKey={`${scopeKey}:${draft.id}`} scope={{ editor: {
				status: draft.pending ? 'This save is not confirmed. Retry checks the same connection without creating a duplicate.' : 'Draft saved in this browser. Saving settings does not grant folder permission or start a transfer.',
				error: storageError || (conflict ? conflict.message : ''), saveLabel: draft.pending ? 'Retry save' : 'Save connection', saveDisabled: busy || !draftReady || !resourceValid || !!conflict,
				discardDisabled: busy || !draftReady || draft.pending, hasConflict: !!conflict, hasMoreFolders: !!folderCursor, busy
			} }} onError={() => setError('The connection action could not be completed.')} actions={{
				save, discard: () => run(async () => { if (!draft.pending) persist(null); }),
				reload: () => run(async () => { if (conflict?.latest) await open(draft.id, true); else persist(null); setConflict(null); }), moreFolders: () => run(() => load('folders', folderCursor))
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
