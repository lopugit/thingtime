import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { rootIdentity } from '../utils/rootIdentity';
import { negotiateRemoteDirectionalProgress, createRemoteSyncClient, type RemoteSyncClient } from './remoteSyncClient.client';
import { parseRemoteSyncResources, supportsRemoteResourceControls, type RemoteSyncStatus, type RemoteSyncResources } from './remoteSyncProtocol';
import { validNativeSourcePath, type MobileFolder } from './mobileFolders.client';
import { parseSyncResourceStatus, type SyncResourceStatus } from './resourceGovernor';
import { parseDeviceSyncResourcePolicy, type DeviceSyncResourcePolicy } from './deviceResourcePolicy';

type Scope = { origin: string; ownerId: string; deviceId: string };
type State = { status: RemoteSyncStatus | null; receivedAt?: number; online: boolean; checking: boolean; error: string };
const empty: State = { status: null, online: false, checking: false, error: '' };

/** One current-only, identity-qualified heartbeat shared by the overview and
 * connection manager. It never persists measurements or viewer-local policy. */
export function createRemoteDeviceStatusSession(input: Scope & {
 assertCurrent(): void; createClient(signal: AbortSignal): Pick<RemoteSyncClient, 'send'>;
 visible(): boolean; onIdle?(): void; subscribeVisibility?(listener: () => void): () => void; pollMs?: number; negotiateDirections?(): Promise<boolean>;
}) {
 let state = empty, consumers = 0, controller = new AbortController(), client = input.createClient(controller.signal);
 let timer: ReturnType<typeof setTimeout> | undefined, reading: Promise<void> | undefined, readAbort: AbortController | undefined, unsubscribe: (() => void) | undefined;
 const listeners = new Set<() => void>();
 const publish = (next: State) => { state = next; for (const listener of listeners) listener(); };
 const check = () => { controller.signal.throwIfAborted(); input.assertCurrent(); };
 const schedule = () => { clearTimeout(timer); if (consumers && input.visible() && !controller.signal.aborted) timer = setTimeout(() => void refresh(), input.pollMs ?? 10_000); };
 const refresh = (): Promise<void> => {
  if (reading) return reading;
  if (!consumers || !input.visible() || controller.signal.aborted) return Promise.resolve();
  clearTimeout(timer); const abort = new AbortController(); readAbort = abort;
  const signal = AbortSignal.any([controller.signal, abort.signal]);
  publish({ ...state, checking: true });
  reading = (async () => {
   try {
    const directionsReady = input.negotiateDirections ? await input.negotiateDirections().catch(() => false) : false;
    check(); let cursor: string | undefined, snapshot: RemoteSyncStatus | undefined, heartbeat: RemoteSyncStatus | undefined, resourceUsage: RemoteSyncResources | undefined;
    let receivedAt: number | undefined;
    const cursors = new Set<string>(), roots = new Map<string, MobileFolder>(), jobs = new Map<string, RemoteSyncStatus['jobs'][number]>();
    do {
     const value = await client.send<RemoteSyncStatus>({ action: 'status', ...(cursor ? { cursor } : {}) }, { signal, timeoutMs: 12_000 }); signal.throwIfAborted(); check();
     if (value?.version !== 1 || value.deviceId !== input.deviceId || !Array.isArray(value.roots) || !Array.isArray(value.jobs) || !Number.isFinite(Date.parse(value.observedAt)) ||
      value.roots.some(root => !root || typeof root.id !== 'string' || typeof root.name !== 'string' || (root.sourcePath !== undefined && (!validNativeSourcePath(root.sourcePath) || root.sourceKind === 'photos'))) ||
      value.jobs.some(job => !job || typeof job.connectionId !== 'string') || (value.nextCursor !== undefined && (typeof value.nextCursor !== 'string' || cursors.has(value.nextCursor)))) throw Error('The device returned an invalid sync status.');
     if (!cursor) {
      receivedAt = Date.now();
      if (value.resourceUsage !== undefined) resourceUsage = parseRemoteSyncResources(value.resourceUsage);
     }
     if (!directionsReady || value.directionalProgressVersion !== '1.0.0') {
      value.jobs = value.jobs.map(({ progress: _progress, ...job }) => job);
      if (value.task) { const { directions: _directions, ...legacy } = value.task.progress; value.task = { ...value.task, progress: legacy }; }
     }
     for (const root of value.roots) roots.set(root.id, root); for (const job of value.jobs) jobs.set(job.connectionId, job);
     heartbeat ??= value; snapshot = value; cursor = value.nextCursor; if (cursor) cursors.add(cursor);
    } while (cursor);
    publish({ status: { ...snapshot!, observedAt: heartbeat!.observedAt, task: heartbeat!.task, ...(resourceUsage ? { resourceUsage } : {}), roots: [...roots.values()], jobs: [...jobs.values()] }, receivedAt, online: true, checking: false, error: '' });
   } catch (cause) {
    if (!signal.aborted) publish({ ...state, online: false, checking: false, error: cause instanceof Error ? cause.message : 'Device unavailable. Saved settings remain editable.' });
   } finally { reading = undefined; readAbort = undefined; if (state.checking) publish({ ...state, checking: false }); schedule(); }
  })();
  return reading;
 };
 return {
  read: () => state, retained: () => consumers > 0,
  invalidate() { controller.abort(); clearTimeout(timer); publish(empty); },
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, refresh,
  retain() {
   if (++consumers === 1) {
    if (controller.signal.aborted) { controller = new AbortController(); client = input.createClient(controller.signal); }
    unsubscribe = input.subscribeVisibility?.(() => { clearTimeout(timer); if (input.visible()) void refresh(); else readAbort?.abort(); });
    void refresh();
   }
   let released = false;
   return () => { if (released) return; released = true; if (--consumers === 0) { clearTimeout(timer); controller.abort(); unsubscribe?.(); unsubscribe = undefined; input.onIdle?.(); } };
  },
  async save(policy: DeviceSyncResourcePolicy): Promise<DeviceSyncResourcePolicy> {
   check(); if (!consumers || !state.online || !state.status?.resourceUsage || !supportsRemoteResourceControls(state.status.capabilities)) throw Error('Connect the updated selected device before saving its resource limits.');
   const value = parseDeviceSyncResourcePolicy(policy);
   const result = parseRemoteSyncResources(await client.send({ action: 'resources', operation: 'save', deviceResourceLimits: value })); check();
   if (JSON.stringify(result.deviceResourceLimits) !== JSON.stringify(value)) throw Error('The selected device did not confirm the requested resource policy.');
   publish({ ...state, status: { ...state.status, resourceUsage: result } });
   return result.deviceResourceLimits;
  }
 };
}
const sessions = new Map<string, ReturnType<typeof createRemoteDeviceStatusSession>>();
function sessionFor(scope: Scope, generation: number) {
 const key = JSON.stringify([scope.origin, scope.ownerId, scope.deviceId, generation]); let session = sessions.get(key);
 if (!session) {
  const check = () => { const identity = rootIdentity.read(); if (identity.pending || identity.generation !== generation || window.location.origin !== scope.origin) throw Error('The account or device changed.'); };
  session = createRemoteDeviceStatusSession({ ...scope, assertCurrent: check, createClient: signal => createRemoteSyncClient({ ...scope, signal, assertCurrent: check }),
   negotiateDirections: () => negotiateRemoteDirectionalProgress(),
   onIdle: () => queueMicrotask(() => { if (!session!.retained() && sessions.get(key) === session) sessions.delete(key); }),
   visible: () => document.visibilityState === 'visible', subscribeVisibility: listener => { document.addEventListener('visibilitychange', listener); return () => document.removeEventListener('visibilitychange', listener); } });
  sessions.set(key, session);
 }
 return session;
}
rootIdentity.subscribe(() => { if (rootIdentity.read().pending) { for (const session of sessions.values()) session.invalidate(); sessions.clear(); } });
export function useRemoteDeviceSyncStatus(scope: Scope, enabled: boolean) {
 const identity = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
 const { origin, ownerId, deviceId } = scope;
 const session = useMemo(() => typeof window !== 'undefined' && enabled && !identity.pending ? sessionFor({ origin, ownerId, deviceId }, identity.generation) : null, [origin, ownerId, deviceId, enabled, identity.generation, identity.pending]);
 const state = useSyncExternalStore(session?.subscribe ?? (() => () => {}), session?.read ?? (() => empty), () => empty);
 useEffect(() => session?.retain(), [session]);
 return { ...state, refresh: session?.refresh ?? (async () => {}), save: session?.save };
}
export function useDeviceSyncRemoteResources({ ownerId, deviceId, enabled }: { ownerId: string; deviceId: string; enabled: boolean }) {
 const origin = typeof window === 'undefined' ? '' : window.location.origin;
 const state = useRemoteDeviceSyncStatus({ ownerId, deviceId, origin }, enabled);
 const usage = state.status?.resourceUsage;
 let taskResources: SyncResourceStatus | undefined;
 if (state.status?.task?.active && state.status.task.progress?.resources) {
  try { taskResources = parseSyncResourceStatus(state.status.task.progress.resources); }
  catch { /* Malformed or unsupported task telemetry remains unavailable. */ }
 }
 return { origin, taskResources, receivedAt: state.receivedAt, online: state.online, checking: state.checking, refresh: state.refresh, policy: usage?.deviceResourceLimits, resources: usage?.resources, observedAt: state.status ? Date.parse(state.status.observedAt) : undefined,
  active: state.online && !!state.status?.task?.active, status: state.error || (!enabled ? 'Remote device resources are unavailable.' : state.online ? usage ? usage.resources ? 'Measured on the selected device.' : 'Selected device policy available; resource measurements are unavailable.' : 'Update the selected device and server to view resource usage.' : 'Connecting to the selected device…'),
  save: enabled && state.online && usage && supportsRemoteResourceControls(state.status?.capabilities) ? state.save : undefined };
}
