import React from 'react';
import { useLocation } from 'react-router';
import { useApi } from '../../hooks/useApi';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useDataPlane } from '../../hooks/useDataPlane';
import { ThingtimeApiError } from '../../hooks/apiFailure';
import { rootIdentity } from '../../utils/rootIdentity';
import type { ThingStoragePolicyResponse } from '../../utils/thingStoragePolicy';
import { createBrowserThingReplicas, readStoredThing } from '../../storage/thingReplicas.client';
import { useCharacterScope } from '../Characters/CharacterScope';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { thingStorageBlocks } from './thingStorageBlocks';
import {
  createThingStorageClient, isStoragePlacement, selectedStoragePlacement, storagePlacementCommand, storagePlacements,
  StoragePolicyUnavailable, type StoragePlacement, type StoragePolicyScope,
} from './thingStorageClient';
import {
  isNativeFileStorage, readNativeStorageDevice, requestNativeThingReplica,
  type ThingReplicaAction, type ThingReplicaState,
} from './thingStorageNative.client';
import { THING_STORAGE_FRAGMENT } from './thingStorageNavigation';

type StoragePanelProps = {
  id: string;
  ownerId?: string;
  kind?: string;
  revision?: string;
  sourceVerified: boolean;
  sourceLoading?: boolean;
};
type PolicyClient = ReturnType<typeof createThingStorageClient>;

export function ThingStoragePanel(props: StoragePanelProps) {
  const user = useCurrentUser();
  const character = useCharacterScope();
  const plane = useDataPlane();
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const scopeKey = JSON.stringify([origin, user?.id, character?.id, plane, identity.generation, props.id, props.ownerId]);
  if (identity.pending) return null;

  const owns = !!user?.id && user.id === props.ownerId && !user.temporary;
  const unavailable = !owns
    ? 'Storage settings are available to the owner of this Thing.'
    : character ? 'Switch to the owning account to manage local copies.'
    : plane !== 'home' ? 'Storage settings require the home database.' : '';
  return <StorageSession key={scopeKey} {...props} scopeKey={scopeKey} generation={identity.generation}
    origin={origin} actor={user?.id} characterId={character?.id} unavailable={unavailable} />;
}

function desiredLocalOperation(snapshot: ThingStoragePolicyResponse): 'keep' | 'evict' | null {
  const { policy, device } = snapshot;
  if (!device) return null;
  if (device.localAvailability === 'cloud-only') return policy.cloudSync ? 'evict' : null;
  if (policy.automaticDownloadDeviceId && policy.automaticDownloadDeviceId !== device.id) return null;
  if (device.localAvailability === 'keep' || policy.defaultLocalAvailability === 'keep') return 'keep';
  return null;
}

function savedPreferenceLabel(snapshot: ThingStoragePolicyResponse): string {
  const choice = selectedStoragePlacement(snapshot);
  if (choice) return storagePlacements.find(entry => entry.id === choice)!.label;
  if (!snapshot.policy.cloudSync) return 'Managed cloud sync paused';
  if (snapshot.policy.automaticDownloadDeviceId) return 'On demand on this device';
  return 'Default behavior';
}

function localReplicaLabel(replica: ThingReplicaState | null, snapshot: ThingStoragePolicyResponse): string {
  if (!snapshot.device) return 'No managed copy registered here';
  if (replica?.pendingChanges) return 'Local edits waiting to sync';
  switch (replica?.state) {
    case 'missing': return 'No managed copy';
    case 'evicted': return replica.retainedOriginal ? 'Unuploaded original still on this iPhone' : 'Managed copy removed';
    case 'error': return 'Needs attention';
    case 'present':
    case 'saved':
      if (replica.sourceRevision && replica.sourceRevision !== snapshot.source.revision) return 'Older managed copy';
      return replica.state === 'saved' || replica.sourceRevision ? 'Managed copy saved' : 'Managed copy present';
    default: return 'Status unavailable';
  }
}

function StorageSession({
  id, kind, revision, sourceVerified, sourceLoading, scopeKey, generation, origin, actor, characterId, unavailable,
}: StoragePanelProps & { scopeKey: string; generation: number; origin: string; actor?: string; characterId?: string; unavailable: string }) {
  const location = useLocation();
  const api = useApi();
  const apiRef = React.useRef(api); apiRef.current = api;
  const host = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(location.hash === THING_STORAGE_FRAGMENT);
  const [snapshot, setSnapshot] = React.useState<ThingStoragePolicyResponse | null>(null);
  const [replica, setReplica] = React.useState<ThingReplicaState | null>(null);
  const [draft, setDraft] = React.useState<StoragePlacement | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [refused, setRefused] = React.useState('');
  const [needsRefresh, setNeedsRefresh] = React.useState(false);
  const [workingLocally, setWorkingLocally] = React.useState(false);
  const active = React.useRef<AbortController | null>(null);
  const autoAttempt = React.useRef<string | null>(null);
  const authorityRefused = React.useRef(false);
  const native = isNativeFileStorage(kind);
  const canUseBrowser = typeof window !== 'undefined' && !!window.indexedDB;

  React.useLayoutEffect(() => {
    const node = host.current?.querySelector<HTMLDetailsElement>('#thing-storage');
    if (!node) return;
    const toggled = () => setOpen(node.open);
    node.addEventListener('toggle', toggled);
    return () => node.removeEventListener('toggle', toggled);
  });
  React.useLayoutEffect(() => {
    if (location.hash !== THING_STORAGE_FRAGMENT) return;
    setOpen(true);
    const frame = requestAnimationFrame(() => {
      const node = host.current?.querySelector<HTMLDetailsElement>('#thing-storage');
      node?.scrollIntoView({ block: 'start' });
      node?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash, location.key]);
  React.useLayoutEffect(() => {
    setBusy(false);
    setWorkingLocally(false);
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [revision, sourceVerified]);

  const run = React.useCallback(async (operation: (
    client: PolicyClient, scope: StoragePolicyScope, signal: AbortSignal, guard: () => void,
  ) => Promise<void>, allowOfflineLocal = false) => {
    const offlineLocal = allowOfflineLocal && navigator.onLine === false && !authorityRefused.current;
    if (active.current || (!sourceVerified && !offlineLocal) || unavailable || !actor || !origin) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    const guard = () => {
      const current = rootIdentity.read();
      if (current.pending || current.generation !== generation || window.location.origin !== origin) controller.abort();
      controller.signal.throwIfAborted();
    };
    const scope = { origin, ownerId: actor, characterId, dataPlane: 'home' } as const;
    const client = createThingStorageClient(scope, {
      signal: controller.signal, assertCurrent: guard,
      onIdentityChange: () => { rootIdentity.changed(); window.dispatchEvent(new Event('thingtime:root-data-refresh')); },
    });
    try {
      await operation(client, scope, controller.signal, guard);
    } catch (cause) {
      if (controller.signal.aborted) return;
      const status = cause instanceof ThingtimeApiError ? cause.status : null;
      const accessRefused = [401, 403, 404, 410].includes(status ?? 0);
      if (accessRefused) authorityRefused.current = true;
      if (cause instanceof StoragePolicyUnavailable || accessRefused) {
        setSnapshot(null);
        setReplica(null);
        setRefused(cause instanceof StoragePolicyUnavailable ? cause.message : 'Storage settings are unavailable with the current access.');
      } else {
        setNeedsRefresh(true);
        setError(status === 409 ? 'The Thing or its storage settings changed. Refresh before saving again.'
          : status === 429 ? 'Storage settings are busy. Wait a moment before refreshing.'
          : 'Could not confirm storage settings. Refresh to check what was saved.');
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        setWorkingLocally(false);
      }
    }
  }, [actor, characterId, generation, origin, sourceVerified, unavailable]);

  const browserManager = React.useCallback((
    current: ThingStoragePolicyResponse, client: PolicyClient, scope: StoragePolicyScope, signal: AbortSignal, guard: () => void,
  ) => {
    const device = current.device;
    if (!canUseBrowser || !device) throw new Error('Local Thing data storage is unavailable on this device.');
    const timelineScope = { ownerId: scope.ownerId, apiOrigin: scope.origin, dataPlane: scope.dataPlane };
    const requestOptions = {
      signal, expectedActor: scope.ownerId, expectedApiOrigin: scope.origin, expectedDataPlane: scope.dataPlane, storageMode: 'cloud',
    } as const;
    return createBrowserThingReplicas({
      scope: { ...timelineScope, deviceId: device.id },
      signal, assertCurrent: guard, manageFileBytes: !native,
      readThing: thingId => apiRef.current.v1.things.get({ id: thingId }, requestOptions),
      writeThing: payload => apiRef.current.v1.things.update(payload, requestOptions),
      readPolicy: thingId => client.read(thingId, device.kind === 'paired' ? device.id : undefined),
      readFile: fileId => apiRef.current.v1.files.read(timelineScope, fileId, { signal }),
    });
  }, [native, canUseBrowser]);

  const localOperation = React.useCallback(async (
    action: ThingReplicaAction, current: ThingStoragePolicyResponse, client: PolicyClient, scope: StoragePolicyScope,
    signal: AbortSignal, guard: () => void,
  ): Promise<ThingReplicaState> => {
    if (!current.device) return { state: 'missing' };
    const manager = browserManager(current, client, scope, signal, guard);
    const thingId = current.source.id;
    let nativeSnapshot = current;
    if (action !== 'status' && current.policy.cloudSync) {
      const synced = await manager.sync(thingId);
      if (native && synced.sourceRevision && synced.sourceRevision !== current.source.revision) {
        nativeSnapshot = await client.read(thingId, current.device.id);
        if (nativeSnapshot.policy.revision !== current.policy.revision || nativeSnapshot.device?.revision !== current.device.revision) {
          throw new Error('Storage changed while syncing. The file copy was kept.');
        }
      }
    }
    guard();
    if (!native) return manager[action](thingId);
    const nativeAction = action === 'keep' && !current.policy.cloudSync ? 'status' : action;
    const [data, file] = await Promise.allSettled([
      manager[action](thingId), requestNativeThingReplica(nativeAction, scope, nativeSnapshot, signal),
    ]);
    guard();
    const dataCopy: ThingReplicaState = data.status === 'fulfilled' ? data.value : { state: 'error' as const };
    const fileCopy: ThingReplicaState = file.status === 'fulfilled' ? file.value : { state: 'error' as const };
    if (dataCopy.state === 'error' || fileCopy.state === 'error') {
      return { ...fileCopy, state: 'error', jsonBytes: dataCopy.jsonBytes, pendingChanges: dataCopy.pendingChanges,
        detail: 'Thing data and the original file are managed separately. One copy still needs attention.' };
    }
    const dataPresent = dataCopy.state === 'present' || dataCopy.state === 'saved';
    const filePresent = fileCopy.state === 'present' || fileCopy.state === 'saved';
    if (action === 'status' && dataPresent !== filePresent) {
      return { ...fileCopy, state: 'present', sourceRevision: undefined, jsonBytes: dataCopy.jsonBytes,
        pendingChanges: dataCopy.pendingChanges,
        detail: filePresent ? 'The local file is available. Thing data has not been saved here.' : 'Thing data is saved here. The original file is unavailable locally.' };
    }
    return {
      ...fileCopy, jsonBytes: dataCopy.jsonBytes, pendingChanges: dataCopy.pendingChanges,
      ...(dataCopy.sourceRevision === fileCopy.sourceRevision ? { sourceRevision: fileCopy.sourceRevision } : { sourceRevision: undefined }),
    };
  }, [browserManager, native]);

  const applyLocal = React.useCallback(async (
    operation: 'keep' | 'evict', current: ThingStoragePolicyResponse, client: PolicyClient,
    scope: StoragePolicyScope, signal: AbortSignal, guard: () => void,
  ) => {
    setWorkingLocally(true);
    try {
      const result = await localOperation(operation, current, client, scope, signal, guard);
      guard();
      setReplica(result);
      if (!native && result.sourceRevision && result.sourceRevision !== current.source.revision) {
        const fresh = await client.read(current.source.id);
        guard();
        setSnapshot(fresh);
      }
      if (result.state === 'error') setError('Storage settings were saved. Apply on this device to retry its copy.');
    } catch {
      guard();
      setError('Storage settings were saved. Apply on this device to retry its copy.');
    } finally {
      if (!signal.aborted) setWorkingLocally(false);
    }
  }, [localOperation, native]);

  const refresh = React.useCallback(() => run(async (client, scope, signal, guard) => {
    let deviceId: string | undefined;
    const saved = canUseBrowser && !authorityRefused.current
      ? await readStoredThing({ apiOrigin: scope.origin, ownerId: scope.ownerId, dataPlane: scope.dataPlane }, id, guard)
        .catch(() => { guard(); return null; })
      : null;
    if (saved) {
      setSnapshot(saved.policy);
      setReplica(previous => ({
        ...previous, state: 'present', jsonBytes: saved.jsonBytes, fileBytes: native ? previous?.fileBytes : saved.fileBytes,
        sourceRevision: saved.sourceRevision, sourceHash: saved.sourceHash, pendingChanges: !!saved.pendingMutation,
      }));
    }
    if (navigator.onLine === false) {
      setNeedsRefresh(true);
      if (saved && !authorityRefused.current) setRefused('');
      if (!authorityRefused.current) setError('You’re offline. Existing local copies can open here. Reconnect to change storage settings.');
      if (native && saved?.policy.device?.kind === 'paired') {
        setWorkingLocally(true);
        try {
          const result = await requestNativeThingReplica('status', scope, saved.policy, signal);
          guard();
          setReplica({ ...result, jsonBytes: saved.jsonBytes, pendingChanges: !!saved.pendingMutation });
        } catch {
          guard();
          setReplica({ state: 'error', jsonBytes: saved.jsonBytes, detail: 'The iPhone file copy could not be verified offline.' });
        }
      }
      return;
    }
    try {
      if (native) deviceId = await readNativeStorageDevice(scope.ownerId, signal);
    } catch (cause) {
      guard();
      setRefused(cause instanceof Error ? cause.message : 'This iPhone is unavailable for local storage.');
      return;
    }
    let current = await client.read(id, deviceId);
    guard();
    const optedInAllDevices = current.policy.revision && current.policy.cloudSync &&
      current.policy.defaultLocalAvailability === 'keep' && !current.policy.automaticDownloadDeviceId;
    if (current.canEdit && optedInAllDevices && !current.device && !native && canUseBrowser) {
      const installation = await client.registerBrowser();
      current = await client.read(id);
      guard();
      if (current.device?.id !== installation.id) throw new Error('This browser installation could not be verified.');
    }
    authorityRefused.current = !current.canEdit;
    setSnapshot(current);
    setNeedsRefresh(false);
    setRefused(current.canEdit ? '' : 'Storage settings are available to the owner of this Thing.');
    if (!current.canEdit || !current.device) { setReplica(null); return; }
    try {
      if (native) setWorkingLocally(true);
      const result = await localOperation('status', current, client, scope, signal, guard);
      guard();
      setReplica(result);
      const key = JSON.stringify([current.source.revision, current.policy.revision, current.device.id, current.device.revision]);
      const stale = result.state === 'missing' || (native && !result.nativeFilePresent) ||
        (!!result.sourceRevision && result.sourceRevision !== current.source.revision) ||
        (!!result.sourceHash && result.sourceHash !== current.source.sourceHash);
      const reconcile = current.policy.cloudSync && (stale || result.pendingChanges);
      if (current.policy.revision && desiredLocalOperation(current) === 'keep' && reconcile && autoAttempt.current !== key) {
        autoAttempt.current = key;
        await applyLocal('keep', current, client, scope, signal, guard);
      }
    } catch {
      guard();
      setReplica({ state: 'error', detail: 'The current local copy could not be checked.' });
    }
  }, true), [applyLocal, canUseBrowser, id, localOperation, native, run]);

  React.useEffect(() => {
    if ((sourceLoading || !sourceVerified) && navigator.onLine !== false) return;
    void refresh();
    const online = () => { void refresh(); };
    const replicaChanged = (event: Event) => {
      const changed = (event as CustomEvent).detail;
      if (changed?.id === id && changed.ownerId === actor && changed.apiOrigin === origin && changed.dataPlane === 'home') void refresh();
    };
    window.addEventListener('online', online);
    window.addEventListener('thingtime:replica-changed', replicaChanged);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('thingtime:replica-changed', replicaChanged);
    };
  }, [actor, id, origin, refresh, revision, sourceLoading, sourceVerified]);

  const save = () => {
    if (!snapshot || !draft || needsRefresh || !snapshot.canEdit || (draft === 'local' && localPausedNative)) return;
    void run(async (client, scope, signal, guard) => {
      let current = snapshot;
      if (!current.device) {
        if (native || !canUseBrowser) throw new Error('This device is unavailable.');
        const installation = await client.registerBrowser();
        current = await client.read(id);
        guard();
        if (current.device?.id !== installation.id || current.source.revision !== snapshot.source.revision ||
            current.source.sourceHash !== snapshot.source.sourceHash || current.policy.revision !== snapshot.policy.revision) {
          throw new ThingtimeApiError('The storage context changed.', { status: 409, method: 'POST' });
        }
      }
      const saved = await client.save(storagePlacementCommand(current, draft));
      guard();
      setSnapshot(saved);
      setDraft(null);
      const operation = desiredLocalOperation(saved);
      if (operation) await applyLocal(operation, saved, client, scope, signal, guard);
    });
  };
  const apply = () => {
    if (!snapshot || !snapshot.canEdit || needsRefresh) return;
    const operation = desiredLocalOperation(snapshot);
    if (operation) void run((client, scope, signal, guard) => applyLocal(operation, snapshot, client, scope, signal, guard));
  };
  const openCopy = () => {
    if (!snapshot || !snapshot.device || !replica || refused || authorityRefused.current) return;
    void run(async (client, scope, signal, guard) => {
      setWorkingLocally(true);
      try {
        if (native) {
          const opened = await requestNativeThingReplica('open', scope, snapshot, signal);
          if (opened.state === 'error') throw new Error('Local file unavailable.');
        } else {
          await browserManager(snapshot, client, scope, signal, guard).download(id);
        }
      } catch (cause) {
        guard();
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(native ? 'Could not open the managed file on this iPhone.' : 'Could not export the managed copy. Use a browser that supports saving a local file.');
      }
    }, true);
  };
  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setWorkingLocally(false);
    setError('The local copy operation stopped. Refresh storage status to check what finished.');
    setNeedsRefresh(true);
  };

  const localPausedNative = native && (!replica?.nativeFilePresent || !replica.sourceRevision || replica.sourceRevision !== snapshot?.source.revision);
  const available = !unavailable && !refused && (native || canUseBrowser);
  const selected = draft ?? (snapshot ? selectedStoragePlacement(snapshot) : null);
  const choices = Object.fromEntries(storagePlacements.map(({ id: placement }) => [placement, {
    selected: selected === placement, disabled: busy || needsRefresh || (placement === 'local' && localPausedNative),
    border: selected === placement ? 'var(--tt-accent, #e24697)' : 'var(--tt-border, #ececef)',
    background: selected === placement ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-surface, #fafafb)',
    notice: placement === 'local' && localPausedNative ? 'Keep a verified copy on this iPhone first.' : '',
  }]));
  const desired = snapshot ? desiredLocalOperation(snapshot) : null;
  const upToDate = (replica?.state === 'saved' || replica?.state === 'present') &&
    replica.sourceRevision === snapshot?.source.revision && !replica.pendingChanges;
  const applyNeeded = desired === 'keep' ? !upToDate : desired === 'evict' && replica?.state !== 'missing' && replica?.state !== 'evicted';
  const saveDisabled = busy || needsRefresh || !draft;
  const scope = {
    open, busy, error, choices, workingLocally,
    canOpen: available && !authorityRefused.current &&
      (native ? replica?.nativeFilePresent === true : replica?.state === 'present' || replica?.state === 'saved'),
    openLabel: native ? 'Open local file' : 'Export local copy',
    unavailable: unavailable || refused || (!native && !canUseBrowser ? 'Local storage is unavailable in this browser.' : ''),
    ready: !!snapshot, editable: available && snapshot?.canEdit === true,
    canRetry: !unavailable && (needsRefresh || !!refused), canApply: !!snapshot && !needsRefresh && !draft && applyNeeded,
    saveDisabled, saveOpacity: saveDisabled ? '0.55' : '1', registeringBrowser: !native && !!snapshot && !snapshot.device,
    policyLabel: snapshot ? savedPreferenceLabel(snapshot) : '',
    deviceLabel: native ? 'On this iPhone' : 'In this browser',
    replicaLabel: snapshot ? localReplicaLabel(replica, snapshot) : '',
    replicaDetail: replica?.retainedOriginal ? 'Original bytes that had not been uploaded were kept on the iPhone.' : replica?.detail ?? '',
  };
  return <div ref={host}><SettingsDocumentHost documentKey="thing-storage" defaultDocument={thingStorageBlocks} scopeKey={scopeKey}
    title="Thing storage layout" editLayoutLabel="Edit storage layout" showLayoutControls={open && !unavailable} layoutEditingDisabled={busy}>
    {({ blocks, chrome, editing }) => <TransientBlockHost enabled={!editing} scopeKey={scopeKey} scope={scope}
      actions={{
        choose: ({ inputs }) => { if (!busy && !needsRefresh && snapshot?.canEdit && isStoragePlacement(inputs.choice) && !choices[inputs.choice].disabled) setDraft(inputs.choice); },
        save, apply, refresh, cancel, 'open-copy': openCopy,
      }}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
    </TransientBlockHost>}
  </SettingsDocumentHost></div>;
}
