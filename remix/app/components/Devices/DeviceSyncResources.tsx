import { useDeviceSyncRemoteResources } from '~/fileSync/remoteDeviceResources.client';
import { activityManager } from '~/activity/activityManager';
import type { FolderHost } from '~/fileSync/desktopFolders.client';
import type { DeviceSyncResourcePolicy } from '~/fileSync/deviceResourcePolicy';
import type { SyncResourceStatus } from '~/fileSync/resourceGovernor';
import { createNativeSyncHost, getNativeSyncAdapter } from '~/fileSync/nativeSyncHost.client';
import { rootIdentity } from '~/utils/rootIdentity';
import React from 'react';
import { nativeSyncTasks } from '~/fileSync/nativeSyncTasks.client';
import { deviceResourceKey, readDeviceSyncResourcePolicy, saveDeviceSyncResourcePolicy, subscribeDeviceSyncResourcePolicy } from '~/fileSync/deviceResourcePolicy';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { deviceSyncResourceBlocks } from './deviceSyncResourceBlocks';

const resourceActivity = { id: 'sync.resources.local', title: 'Local Sync resource usage', kind: 'polling', detail: 'Samples the selected Mac during an active Sync transfer while the dashboard is visible.' } as const;
const localSamplers = new WeakMap<FolderHost, { listeners: Set<(resources: SyncResourceStatus) => void>; stop(): void }>();

function subscribeLocalResources(host: FolderHost, ownerId: string, listener: (resources: SyncResourceStatus) => void) {
 let sampler = localSamplers.get(host);
 if (!sampler) {
  const listeners = new Set<(resources: SyncResourceStatus) => void>();
  const stop = activityManager.register(resourceActivity, signal => {
   let timer: ReturnType<typeof setTimeout> | undefined;
   const sample = async () => {
    try {
     await activityManager.run(resourceActivity.id, async () => {
      const reply = await host.request(ownerId, { action: 'resources' }, AbortSignal.any([signal, AbortSignal.timeout(2500)]));
      if (!signal.aborted && reply.resources) for (const receive of listeners) receive(reply.resources);
     });
    } catch {
     // Keep the previous measurement until its own timestamp expires.
    } finally {
     if (!signal.aborted) timer = setTimeout(() => void sample(), 1000);
    }
   };
   void sample();
   return () => clearTimeout(timer);
  });
  sampler = { listeners, stop };
  localSamplers.set(host, sampler);
 }
 sampler.listeners.add(listener);
 return () => {
  sampler.listeners.delete(listener);
  if (!sampler.listeners.size) {
   sampler.stop();
   localSamplers.delete(host);
  }
 };
}
export type RemoteDeviceResources = { origin: string; policy?: DeviceSyncResourcePolicy; resources?: SyncResourceStatus; observedAt?: number; active: boolean; status: string; save?(policy: DeviceSyncResourcePolicy): Promise<DeviceSyncResourcePolicy> };
export function DeviceSyncResources({ ownerId, deviceId, allowed, remote: suppliedRemote }: { ownerId: string; deviceId: string; allowed: boolean; remote?: RemoteDeviceResources }) {
 const [origin, setOrigin] = React.useState(typeof window === 'undefined' ? '' : window.location.origin);
 const [local, setLocal] = React.useState(false);
 const [localDiscovery, setLocalDiscovery] = React.useState<'checking' | 'local' | 'remote'>('checking');
 const hostRef = React.useRef<Awaited<ReturnType<typeof createNativeSyncHost>> | undefined>(undefined);
 const discoveredRemote = useDeviceSyncRemoteResources({ ownerId, deviceId, enabled: allowed && localDiscovery === 'remote' && !suppliedRemote });
 const remote = suppliedRemote ?? discoveredRemote;
 const resourceOrigin = local ? origin : remote?.origin || origin;
 const key = deviceResourceKey(resourceOrigin, ownerId, deviceId), prefix = React.useId();
 const policy = React.useSyncExternalStore(subscribeDeviceSyncResourcePolicy, () => readDeviceSyncResourcePolicy(key), () => readDeviceSyncResourcePolicy(key));
 const run = React.useSyncExternalStore(nativeSyncTasks.subscribe, nativeSyncTasks.read, () => null);
 const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
 const [observation, setObservation] = React.useState<{ host: FolderHost; resources: SyncResourceStatus }>();
 const [draft, setDraft] = React.useState(() => ({ transfer: String(policy.transferBytesPerSecond / 125000), scan: String(policy.scanBytesPerSecond / 125000), cpu: String(policy.cpuPercent) }));
 const dirty = React.useRef(false), draftIdentity = React.useRef(key);
 const [error, setError] = React.useState('');
 const [, expireObservation] = React.useState(0);
 React.useEffect(() => {
  if (!allowed) return;
  const adapter = getNativeSyncAdapter(); if (!adapter || adapter.platform !== 'macos') { setLocalDiscovery('remote'); return; }
  const abort = new AbortController(), generation = rootIdentity.read().generation;
  const check = () => { abort.signal.throwIfAborted(); if (rootIdentity.read().generation !== generation || rootIdentity.read().pending) throw Error('The active account changed.'); };
  void (async () => {
   const host = await createNativeSyncHost({ adapter, ownerId, deviceId, signal: abort.signal, assertCurrent: check }); check();
   if (!(Number(host.capabilities.fileAccessVersion?.split('.')[1]) >= 16) || !(Number(host.capabilities.fileResourceLimitsVersion?.split('.')[1]) >= 1)) throw Error('Update Thingtime to manage device-wide Sync targets.');
   const result = await host.request(ownerId, { action: 'resources' }, abort.signal); check();
   hostRef.current = host; setOrigin(host.origin()); setLocal(true); setLocalDiscovery('local');
   if (result.deviceResourceLimits) saveDeviceSyncResourcePolicy(deviceResourceKey(host.origin(), ownerId, deviceId), result.deviceResourceLimits);
  })().catch(() => { if (!abort.signal.aborted) { setLocal(false); setLocalDiscovery('remote'); } });
  return () => { abort.abort(); hostRef.current = undefined; };
 }, [ownerId, deviceId, allowed]);
 const selectedPolicy = local ? policy : remote?.policy;
 React.useEffect(() => {
  if (draftIdentity.current !== key) { draftIdentity.current = key; dirty.current = false; }
  if (!dirty.current && selectedPolicy) setDraft({ transfer: String(selectedPolicy.transferBytesPerSecond / 125000), scan: String(selectedPolicy.scanBytesPerSecond / 125000), cpu: String(selectedPolicy.cpuPercent) });
 }, [key, selectedPolicy?.transferBytesPerSecond, selectedPolicy?.scanBytesPerSecond, selectedPolicy?.cpuPercent]);
 const current = allowed && !identity.pending && run?.scope.ownerId === ownerId && run.scope.deviceId === deviceId && run.scope.origin === origin && run.active && !run.stopping;
 const activeHost = current && local ? run.host : undefined;
 React.useEffect(() => {
  if (!activeHost) return;
  return subscribeLocalResources(activeHost, ownerId, resources => setObservation({ host: activeHost, resources }));
 }, [activeHost, ownerId]);
 const sampled = activeHost && observation?.host === activeHost ? observation.resources : undefined;
 const progressResources = current ? run.progress.resources : undefined;
 const localResources = (sampled?.measuredAt ?? 0) > (progressResources?.measuredAt ?? 0) ? sampled : progressResources;
 const resources = current ? localResources : allowed && !identity.pending && remote?.active ? remote.resources : undefined;
 const appliedPolicy = local ? policy : remote?.policy;
 React.useEffect(() => {
  if (!resources?.measuredAt) return;
  const timer = setTimeout(() => expireObservation(value => value + 1), Math.max(0, resources.measuredAt + 2501 - Date.now()));
  return () => clearTimeout(timer);
 }, [resources?.measuredAt]);
 const fresh = !!resources?.measuredAt && Date.now() - resources.measuredAt >= -1000 && Date.now() - resources.measuredAt < 2500;
 const upload = fresh ? resources?.currentUploadBytesPerSecond : null, download = fresh ? resources?.currentDownloadBytesPerSecond : null;
 const transfer = upload != null && download != null ? (upload + download) * 8 / 1e6 : null;
 const scan = fresh && resources?.scanBytesPerSecond != null ? resources.scanBytesPerSecond * 8 / 1e6 : null;
 const cpu = fresh && resources?.cpuStatus === 'measured' ? resources.cpuPercent : null;
 const memory = fresh && resources?.memoryBytes != null ? resources.memoryBytes / 1048576 : null;
 const known = (v: number | null | undefined, unit: string) => v == null ? 'Unavailable' : `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
 const percent = (value: number | null | undefined, max: number) => value == null ? 0 : Math.min(100, Math.max(0, value / max * 100));
 const budget = (value: number | undefined, unit: string) => value === undefined ? 'Unverified budget' : `${value.toLocaleString()} ${unit}`;
 const data = { status: !allowed ? 'Sign in to view this device’s private Sync resources.' : current ? 'Current app-owned Sync workload across this device’s connections.' : (local ? undefined : remote?.status) ?? 'No current resource observation for this device. Paused or completed run measurements are not shown as live.',
 transferText: `${known(transfer, 'Mbps')} / ${budget(appliedPolicy ? appliedPolicy.transferBytesPerSecond / 125000 : undefined, 'Mbps shared')}`, transferWidth: percent(transfer, (appliedPolicy?.transferBytesPerSecond ?? 625000) / 125000), transferUnknown: transfer == null, transferValue: transfer ?? 0, transferMax: (appliedPolicy?.transferBytesPerSecond ?? 625000) / 125000,
 scanText: `${known(scan, 'Mbps')} / ${budget(appliedPolicy ? appliedPolicy.scanBytesPerSecond / 125000 : undefined, 'Mbps')}`, scanWidth: percent(scan, (appliedPolicy?.scanBytesPerSecond ?? 625000) / 125000), scanUnknown: scan == null, scanValue: scan ?? 0, scanMax: (appliedPolicy?.scanBytesPerSecond ?? 625000) / 125000,
 cpuText: `${known(cpu, '%')}${cpu == null ? '' : ` (${resources?.cpuScopes?.length ?? '?'} of 3 scopes)`} / ${budget(appliedPolicy?.cpuPercent, '% target')}`, cpuWidth: percent(cpu, 100), cpuUnknown: cpu == null, cpuValue: cpu ?? 0, cpuMax: 100,
 memoryText: `${known(memory, 'MiB')} / 512 MiB indexer budget`, memoryWidth: percent(memory, 512), memoryUnknown: memory == null, memoryValue: memory ?? 0, memoryMax: 512,
 directions: `Upload: ${known(upload == null ? null : upload * 8 / 1e6, 'Mbps')} · Download: ${known(download == null ? null : download * 8 / 1e6, 'Mbps')}. Memory covers the native indexer only; unavailable scopes remain unknown.`,
 ...Object.fromEntries((['transfer', 'scan', 'cpu'] as const).flatMap(name => [[`${name}Id`, `${prefix}-${name}`], [`${name}Target`, draft[name]]])), disabled: !allowed || (!local && !remote?.save), error };
 const actions = Object.fromEntries((['transfer', 'scan', 'cpu'] as const).map(name => [`target-${name}`, ({ value }: { value?: unknown }) => { dirty.current = true; setDraft(old => ({ ...old, [name]: String(value ?? '') })); }]));
 actions['save-targets'] = async () => { try {
  if (!allowed || (!local && !remote?.save)) throw Error('The selected device is unavailable for resource changes.');
  const policy = { transferBytesPerSecond: Number(draft.transfer) * 125000, scanBytesPerSecond: Number(draft.scan) * 125000, cpuPercent: Number(draft.cpu) };
  if (!local && remote?.save) { await remote.save(policy); dirty.current = false; setError('Selected device targets saved.'); return; }
  if (!hostRef.current) throw Error('The paired device connection changed.');
  const result = await hostRef.current.request(ownerId, { action: 'resources', deviceResourceLimits: policy }, AbortSignal.timeout(20000));
  if (!result.deviceResourceLimits) throw Error('The device did not confirm its saved resource targets.');
  dirty.current = false; saveDeviceSyncResourcePolicy(key, result.deviceResourceLimits); setError('Device targets saved. Active captures retain their scan and CPU budgets until the next capture.');
 } catch (cause) { setError(cause instanceof Error ? cause.message : 'Targets could not be saved.'); } };
 return <SettingsDocumentHost documentKey="device-sync-total-resources" defaultDocument={deviceSyncResourceBlocks} scopeKey={key} title="Total Sync resource usage">
 {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={key} enabled={!editing} scope={{ deviceResources: data }} actions={actions}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
 </SettingsDocumentHost>;
}
