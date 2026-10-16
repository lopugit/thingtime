import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Button, Checkbox, Flex, FormControl, FormLabel, Input, Select, Stack, Text, Textarea } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { readStampedCache, writeStampedCache, pruneCacheNamespace } from '~/hooks/localCache';
import { rootIdentity } from '~/utils/rootIdentity';
import { type MobileFolder, requestMobileFolders, mobileFolderSource, supportsMobileSyncConditions } from '~/fileSync/mobileFolders.client';
import { openSyncJournal, withSyncRootLock, syncScopeKey } from '~/fileSync/journal.client';
import { readCloudFolderInventory } from '~/fileSync/cloudInventory.client';
import { runForegroundCloudSync, type ForegroundSyncProgress } from '~/fileSync/foregroundSync';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { requestMobileDevice } from './mobileDeviceBridge';
import { newFileSyncConfiguration, type FileSyncConfiguration } from '~/fileSync/configuration';
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

export function MobileSyncConnections({ ownerId, deviceId, roots }: { ownerId: string; deviceId: string; roots: MobileFolder[] }) {
	const owner = useCurrentUser(),
		dataPlane = useDataPlane();
	const identity = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	if (!dataPlane || owner?.id !== ownerId || identity.pending) return null;
	const scope = { origin: window.location.origin, ownerId, dataPlane, deviceId };
	return <Connections key={`${configurationDraftKey(scope)}:${identity.generation}`} scope={scope} generation={identity.generation} roots={roots} />;
}
function Connections({ scope, generation, roots }: { scope: ConfigurationEditorScope; generation: number; roots: MobileFolder[] }) {
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
		[busy, setBusy] = useState(false),
		[notice, setNotice] = useState('');
	const [draft, setDraft] = useState<ConfigurationDraft | null>(initial.draft);
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
	const [activeTransfer, setActiveTransfer] = useState<string | null>(null);
	const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
	const [connectionCursor, setConnectionCursor] = useState<string | null>(null),
		[folderCursor, setFolderCursor] = useState<string | null>(null);
	const controller = useRef<AbortController | null>(null),
		mounted = useRef(false);
	const assertCurrent = () => {
		if (!mounted.current || rootIdentity.read().pending || rootIdentity.read().generation !== generation || window.location.origin !== scope.origin)
			throw Error('The account or storage destination changed.');
		controller.current?.signal.throwIfAborted();
	};
	const options = () => ({ expectedActor: scope.ownerId, expectedDataPlane: scope.dataPlane, signal: controller.current?.signal });
	const persist = (next: ConfigurationDraft | null) => {
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
		mounted.current = true;
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
			if (document.visibilityState !== 'visible') controller.current?.abort();
		};
		window.addEventListener('pagehide', hidden);
		document.addEventListener('visibilitychange', hidden);
		window.addEventListener('storage', changed);
		return () => {
			mounted.current = false;
			controller.current?.abort();
			controller.current = null;
			window.removeEventListener('storage', changed);
			window.removeEventListener('pagehide', hidden);
			document.removeEventListener('visibilitychange', hidden);
		};
		// This component is keyed by the full account/storage/device identity.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const edit = (next: ConfigurationDraft) => {
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
	const upload = (saved: SavedFileSyncConfiguration) =>
		void run(async (assertActive) => {
			const active = controller.current!,
				syncScope = { ...scope, rootId: saved.id };
			const publish = (value: ForegroundSyncProgress & { message?: string }) => {
				assertActive();
				setTransfers((previous) => ({ ...previous, [saved.id]: value }));
				writeStampedCache(progressKey(saved.id), value);
				pruneCacheNamespace('tt:sync-progress:', progressKey(saved.id), 32);
			};
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
						await runForegroundCloudSync(
							saved,
							syncScope,
							{
								currentScope,
								readConfiguration: async () => {
									const value = await apiRef.current.v1.things.get({ id: saved.id }, options());
									assertActive();
									return value.thing;
								},
								authorizeDevice: async () => {
									const status = await requestMobileDevice(scope.ownerId, 'status', active.signal);
									assertActive();
									if (status.state !== 'paired' || status.deviceId !== scope.deviceId)
										throw Error('Reconnect this device before transferring files.');
								},
								conditions: async () => (await requestMobileFolders(scope.ownerId, { action: 'conditions' }, active.signal)).conditions!,
								scanLocal: async () =>
									(
										await requestMobileFolders(scope.ownerId, { action: 'scan', rootId: saved.configuration.localRootId }, active.signal)
									).entries!,
								inventory: () => readCloudFolderInventory(syncScope, saved.configuration.remoteFolderId, { currentScope, signal: active.signal }),
								source: async (entry) => mobileFolderSource(scope.ownerId, saved.configuration.localRootId, entry, active.signal),
								journal: journal!,
								runtime: {
									currentScope,
									origin: () => window.location.origin,
									fetch: (url, init) => fetch(url, init),
									requireCapability: requireThingtimeCapability
								},
								progress: publish
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
						stage: 'checking',
						confirmed: 0,
						total: 0,
						message: cause instanceof Error ? cause.message : 'Upload interrupted. Retry to recover saved work.'
					});
				throw cause;
			} finally {
				journal?.close();
				if (mounted.current) setActiveTransfer(null);
			}
		});
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
					remoteFolderId: 'unselected'
				}),
				localRootId: roots[0]?.id ?? '',
				remoteFolderId: ''
			}
		});
	const open = (id: string) =>
		void run(async (assertCurrent) => {
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
			const pending = { ...draft, configuration: canonicalDraftConfiguration(draft), pending: true };
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
						const status = await requestMobileDevice(scope.ownerId, 'status', controller.current!.signal);
						assertCurrent();
						if (status.state !== 'paired' || status.deviceId !== deviceId) throw Error('Pair this device with the current account before saving.');
						const access = await requestMobileFolders(scope.ownerId, { action: 'list' }, controller.current!.signal);
						assertCurrent();
						if (!access.roots.some((root) => root.id === rootId))
							throw Error('Folder access was removed. Restore access to this folder before retrying.');
					}
				});
			} catch (cause) {
				// A first attempt that never reached a mutation can remain editable.
				// A restored pending save may still have an older request in flight.
				assertCurrent();
				if (!draft.pending && !dispatched && !(cause instanceof ConfigurationConflict)) persist(draft);
				throw cause;
			}
			assertCurrent();
			persist(null);
			setConflict(null);
			cache([saved, ...connections.filter((row) => row.id !== saved.id)]);
			setNotice('Connection saved. Upload and backup connections can be run while this app stays open.');
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
				Upload or back up a selected folder while this app stays open. Stop or retry without losing saved work. Two-way, downloads and background
				transfers are still being added.
			</Text>
			{connections.map((saved) => {
				const progress = transfers[saved.id] ?? readStampedCache<ForegroundSyncProgress & { message?: string }>(progressKey(saved.id));
				const running = busy && activeTransfer === saved.id;
				const supported = ['upload', 'backup'].includes(saved.configuration.mode);
				const allowed =
					supportsMobileSyncConditions() &&
					scope.dataPlane === 'home' &&
					supported &&
					!saved.configuration.paused &&
					roots.some((root) => root.id === saved.configuration.localRootId);
				return (
					<Flex key={saved.id} marginTop={3} align="center" gap={2} wrap="wrap">
						<Box flex={1} minWidth={0} overflowWrap="anywhere">
							<Text fontSize="13px" fontWeight={600}>
								{saved.configuration.name}
							</Text>
							<Text fontSize="12px">
								{saved.configuration.paused
									? 'Paused'
									: !supported
									? 'This direction is not available yet'
									: !supportsMobileSyncConditions()
									? 'Update the mobile app to upload'
									: 'Ready for a foreground upload'}
								{!roots.some((root) => root.id === saved.configuration.localRootId) ? ' · Folder access missing' : ''}
							</Text>
							{progress && (
								<Text role="status" fontSize="12px" marginTop={1} overflowWrap="anywhere">
									{running
										? progress.stage === 'scanning'
											? 'Checking both folders…'
											: progress.stage === 'verifying'
											? 'Verifying completed work…'
											: progress.path
											? `${progress.path}: ${Math.round(((progress.bytes ?? 0) / Math.max(1, progress.size ?? 1)) * 100)}%`
											: `${progress.confirmed} of ${progress.total} operations confirmed`
										: progress.message ||
										  (progress.stage === 'complete' ? 'Last upload finished.' : 'Upload stopped or interrupted. Retry to recover saved work.')}
								</Text>
							)}
						</Box>
						<Button size="sm" minHeight="40px" variant="outline" isDisabled={busy || !!draft || !ready} onClick={() => open(saved.id)}>
							Edit
						</Button>
						{running ? (
							<Button size="sm" minHeight="40px" onClick={() => controller.current?.abort()}>
								Stop upload
							</Button>
						) : (
							<Button size="sm" minHeight="40px" isDisabled={!allowed || busy || !!draft || !ready} onClick={() => upload(saved)}>
								{progress && progress.stage !== 'complete' ? 'Retry upload' : 'Upload now'}
							</Button>
						)}
					</Flex>
				);
			})}
			{connectionCursor && (
				<Button size="sm" minHeight="40px" isDisabled={busy} onClick={() => void run(() => load('connections', connectionCursor))}>
					More connections
				</Button>
			)}
			{draft && (
				<Box marginTop={4} border="1px solid var(--tt-border, #ececef)" borderRadius="12px" padding={3}>
					<SyncConfigurationForm draft={draft} roots={roots} folders={folders} disabled={busy || draft.pending || !ready} onChange={edit} />
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
						<Button size="sm" minHeight="40px" isDisabled={busy || !ready || !!conflict} onClick={save}>
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
										? open(draft.id)
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
				</Box>
			)}
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
	onChange
}: {
	draft: ConfigurationDraft;
	roots: MobileFolder[];
	folders: { id: string; name: string }[];
	disabled: boolean;
	onChange(draft: ConfigurationDraft): void;
}) {
	const prefix = useId(),
		c = draft.configuration;
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
				<Input id={`${prefix}-name`} value={c.name} maxLength={120} onChange={(e) => change({ name: e.target.value })} />
			)}
			{field(
				'local',
				'Device folder',
				<Select id={`${prefix}-local`} value={c.localRootId} onChange={(e) => change({ localRootId: e.target.value })}>
					<option value="">Choose a device folder</option>
					{c.localRootId && !roots.some((r) => r.id === c.localRootId) && <option value={c.localRootId}>Folder access missing</option>}
					{roots.map((r) => (
						<option key={r.id} value={r.id}>
							{r.name}
						</option>
					))}
				</Select>
			)}
			{field(
				'remote',
				'Private cloud folder',
				<Select id={`${prefix}-remote`} value={c.remoteFolderId} onChange={(e) => change({ remoteFolderId: e.target.value })}>
					<option value="">Choose a folder from Things</option>
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
			{field(
				'exclusions',
				'Excluded paths · one per line',
				<Textarea
					id={`${prefix}-exclusions`}
					value={draft.exclusions}
					maxLength={16384}
					placeholder={'Private\nDocuments/archive.zip'}
					onChange={(e) => onChange({ ...draft, exclusions: e.target.value })}
				/>
			)}
			<Text fontSize="12px" color="var(--tt-muted, #71717a)">
				Paths are relative to the selected folder. A folder exclusion includes its contents. Wildcards are not supported.
			</Text>
		</Stack>
	);
}
