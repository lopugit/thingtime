import type { FolderCapabilities } from '~/fileSync/mobileFolders.client';
import React from 'react';
import { activityManager } from '~/activity/activityManager';
import type { FolderHost } from '~/fileSync/desktopFolders.client';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useDeviceSyncRemoteResources } from '~/fileSync/remoteDeviceResources.client';
import { readDeviceSyncHistory } from '~/fileSync/deviceSyncHistory.client';
import type { DeviceSyncHistory } from '~/fileSync/deviceSyncHistory';
import { createRemoteSyncClient } from '~/fileSync/remoteSyncClient.client';
import type { SyncResourceStatus } from '~/fileSync/resourceGovernor';
import { createNativeSyncHost, getNativeSyncAdapter } from '~/fileSync/nativeSyncHost.client';
import { rootIdentity } from '~/utils/rootIdentity';
import { nativeSyncTasks } from '~/fileSync/nativeSyncTasks.client';
import { deviceResourceKey, readDeviceSyncResourcePolicy, saveDeviceSyncResourcePolicy, subscribeDeviceSyncResourcePolicy, type DeviceSyncResourcePolicy } from '~/fileSync/deviceResourcePolicy';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { deviceSyncResourceBlocks, migrateDeviceSyncResourceBlocks, withDeviceResourceAvailability } from './deviceSyncResourceBlocks';
import { IOS_SYNC_RESOURCE_STATUS, iosManagedSyncResources, deviceResourceHistoryDisplay, deviceResourceWindows, liveDeviceResourceDisplay, resourceDateTime, resourceReading, type DeviceResourceWindow } from './deviceSyncResourceDisplay';

const migrateResourcePresentation = (blocks: Parameters<typeof migrateDeviceSyncResourceBlocks>[0]) => withDeviceResourceAvailability(migrateDeviceSyncResourceBlocks(blocks));
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
export type RemoteDeviceResources = {
 origin: string; capabilities?: FolderCapabilities; policy?: DeviceSyncResourcePolicy; resources?: SyncResourceStatus; taskResources?: SyncResourceStatus; observedAt?: number; receivedAt?: number; active: boolean;
 online?: boolean; checking?: boolean; refresh?(): Promise<void>; status: string;
 save?(policy: DeviceSyncResourcePolicy): Promise<DeviceSyncResourcePolicy>;
};
type Props = { ownerId: string; deviceId: string; allowed: boolean; remote?: RemoteDeviceResources };
type Host = Awaited<ReturnType<typeof createNativeSyncHost>>;
const draftFrom = (value: DeviceSyncResourcePolicy) => ({ transfer: String(value.transferBytesPerSecond / 125000), scan: String(value.scanBytesPerSecond / 125000), cpu: String(value.cpuPercent) });
const formDateTime = (time: number) => {
 const date = new Date(time);
 return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function DeviceSyncResources(props: Props) {
 const dataPlane = useDataPlane();
 const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
 const rendererOrigin = typeof window === 'undefined' ? '' : window.location.origin;
 const allowed = props.allowed && dataPlane === 'home' && !identity.pending;
 return <DeviceResourceSession key={JSON.stringify([rendererOrigin, dataPlane, props.ownerId, props.deviceId, identity.generation, allowed])}
  {...props} allowed={allowed} rendererOrigin={rendererOrigin} generation={identity.generation} />;
}

function DeviceResourceSession({ ownerId, deviceId, allowed, remote: suppliedRemote, rendererOrigin, generation }: Props & { rendererOrigin: string; generation: number }) {
 const [localCapabilities, setLocalCapabilities] = React.useState<FolderCapabilities>();
 const [native, setNative] = React.useState<{ origin: string; observedAt: number; resources?: SyncResourceStatus; online: boolean }>();
 const [discovery, setDiscovery] = React.useState<'checking' | 'local' | 'remote'>('checking');
 const [checking, setChecking] = React.useState(false);
 const hostRef = React.useRef<Host | undefined>(undefined);
 const refreshRef = React.useRef<(() => void) | undefined>(undefined);
 const discoveredRemote = useDeviceSyncRemoteResources({ ownerId, deviceId, enabled: allowed && discovery === 'remote' && !suppliedRemote && !iosManagedSyncResources(localCapabilities) });
 const remote = suppliedRemote ?? discoveredRemote;
 const local = discovery === 'local';
 const iosManaged = !local && iosManagedSyncResources(localCapabilities ?? remote.capabilities);
 const origin = local ? native!.origin : remote.origin || rendererOrigin;
 const key = deviceResourceKey(origin, ownerId, deviceId), prefix = React.useId();
 const policy = React.useSyncExternalStore(subscribeDeviceSyncResourcePolicy, () => readDeviceSyncResourcePolicy(key), () => readDeviceSyncResourcePolicy(key));
 const run = React.useSyncExternalStore(nativeSyncTasks.subscribe, nativeSyncTasks.read, () => null);
 const [observation, setObservation] = React.useState<{ host: FolderHost; resources: SyncResourceStatus }>();
 const [draft, setDraft] = React.useState(() => draftFrom(policy));
 const dirty = React.useRef(false), draftIdentity = React.useRef(key);
 const [error, setError] = React.useState('');
 const [, tick] = React.useState(0);
 const assertCurrent = () => {
  const identity = rootIdentity.read();
  if (!allowed || identity.generation !== generation || identity.pending || window.location.origin !== rendererOrigin) throw Error('The selected account or device changed.');
 };
 const assertRef = React.useRef(assertCurrent);
 assertRef.current = assertCurrent;

 React.useEffect(() => {
  if (!allowed) return;
  const adapter = getNativeSyncAdapter();
  if (!suppliedRemote && adapter?.platform === 'ios') {
   // Bind the installed bridge's capability to this exact paired device before
   // showing OS-managed limits. Selecting a different remote device stays remote.
   const abort = new AbortController();
   const check = () => { abort.signal.throwIfAborted(); assertRef.current(); };
   void createNativeSyncHost({ adapter, ownerId, deviceId, signal: abort.signal, assertCurrent: check }).then(host => {
    check(); setLocalCapabilities(host.capabilities); setDiscovery('remote');
   }).catch(() => { if (!abort.signal.aborted) setDiscovery('remote'); });
   return () => abort.abort();
  }
  if (suppliedRemote || !adapter || adapter.platform !== 'macos') { setDiscovery('remote'); return; }
  const abort = new AbortController();
  let reading = false, timer: ReturnType<typeof setTimeout>;
  const check = () => { abort.signal.throwIfAborted(); assertRef.current(); };
  const visible = () => document.visibilityState === 'visible';
  const read = async () => {
   if (reading || abort.signal.aborted || !visible()) return;
   clearTimeout(timer);
   reading = true;
   setChecking(true);
   try {
    let host = hostRef.current;
    if (!host) {
     const candidate = await createNativeSyncHost({ adapter, ownerId, deviceId, signal: abort.signal, assertCurrent: check });
     check();
     const compatible = (version: string | undefined, minimum: number) => {
      const [major, minor] = version?.split('.').map(Number) ?? [];
      return major === 1 && minor != null && minor >= minimum;
     };
     if (!compatible(candidate.capabilities?.fileAccessVersion, 16) || !compatible(candidate.capabilities?.fileResourceLimitsVersion, 1))
      throw Error('Update Thingtime to manage device-wide Sync targets.');
     host = candidate;
    }
    const result = await host.request(ownerId, { action: 'resources' }, AbortSignal.timeout(10_000));
    check();
    if (!result.deviceResourceLimits || result.roots.length) throw Error('The device did not confirm its resource policy.');
    const origin = host.origin();
    const policyKey = deviceResourceKey(origin, ownerId, deviceId);
    if (JSON.stringify(readDeviceSyncResourcePolicy(policyKey)) !== JSON.stringify(result.deviceResourceLimits))
     saveDeviceSyncResourcePolicy(policyKey, result.deviceResourceLimits);
    hostRef.current = host;
    setNative({ origin, observedAt: Date.now(), resources: result.resources, online: true });
    setDiscovery('local');
   } catch {
    if (abort.signal.aborted) return;
    if (!hostRef.current) setDiscovery('remote');
    else setNative(previous => previous && { ...previous, online: false });
   } finally {
    reading = false;
    if (!abort.signal.aborted) {
     setChecking(false);
     if (hostRef.current && visible()) timer = setTimeout(() => void read(), 5_000);
    }
   }
  };
  const onVisibility = () => {
   clearTimeout(timer);
   if (visible()) void read();
  };
  refreshRef.current = () => void read();
  document.addEventListener('visibilitychange', onVisibility);
  void read();
  return () => {
   abort.abort();
   clearTimeout(timer);
   document.removeEventListener('visibilitychange', onVisibility);
   hostRef.current = undefined;
   refreshRef.current = undefined;
  };
 }, [ownerId, deviceId, allowed, suppliedRemote]);

 const selectedPolicy = iosManaged ? undefined : local ? policy : allowed ? remote.policy : undefined;
 const { transferBytesPerSecond, scanBytesPerSecond, cpuPercent } = selectedPolicy ?? {};
 React.useEffect(() => {
  if (draftIdentity.current !== key) { draftIdentity.current = key; dirty.current = false; }
  if (!dirty.current && transferBytesPerSecond != null && scanBytesPerSecond != null && cpuPercent != null)
   setDraft(draftFrom({ transferBytesPerSecond, scanBytesPerSecond, cpuPercent }));
 }, [key, transferBytesPerSecond, scanBytesPerSecond, cpuPercent]);

 const current = allowed && local && run?.scope.ownerId === ownerId && run.scope.deviceId === deviceId
  && run.scope.origin === origin && run.scope.dataPlane === 'home' && run.active && !run.stopping;
 const activeHost = current ? run.host : undefined;
 React.useEffect(() => {
  if (!activeHost) return;
  return subscribeLocalResources(activeHost, ownerId, resources => {
   assertRef.current();
   setObservation({ host: activeHost, resources });
  });
 }, [activeHost, ownerId]);
 const sampled = activeHost && observation?.host === activeHost ? observation.resources : undefined;
 const observed = allowed ? (local ? native?.resources : remote.resources) : undefined;
 const activeSample = current ? run.progress.resources : allowed && !local ? remote.taskResources : undefined;
 const currentSample = (activeSample?.measuredAt ?? 0) > (observed?.measuredAt ?? 0) ? activeSample : observed;
 const latestResources = (sampled?.measuredAt ?? 0) > (currentSample?.measuredAt ?? 0) ? sampled : currentSample;
 // A policy/status reply may omit a resource sample while the same scoped
 // connection refreshes. Retain only the last measured sample, never authority.
 const lastMeasurement = React.useRef<{ key: string; resources: SyncResourceStatus } | undefined>(undefined);
 if (!allowed || iosManaged || lastMeasurement.current?.key !== key) lastMeasurement.current = undefined;
 if (allowed && !iosManaged && latestResources?.measuredAt != null && latestResources.measuredAt >= (lastMeasurement.current?.resources.measuredAt ?? -1))
  lastMeasurement.current = { key, resources: latestResources };
 const resources = allowed && !iosManaged ? lastMeasurement.current?.resources ?? latestResources : undefined;
 const retainingMeasurement = !!resources && resources !== latestResources;
 const observedAt = allowed ? local ? native?.observedAt : remote.observedAt : undefined;
 const receivedAt = allowed && !local ? remote.receivedAt : undefined;
 const sourceClock = React.useRef({ observedAt, receivedAt });
 sourceClock.current = { observedAt, receivedAt };
 const active = allowed && (local ? !!current : remote.active);
 const online = allowed && (local ? !!native?.online : remote.online ?? remote.active);
 const display = liveDeviceResourceDisplay({
  resources, active, online, observedAt, receivedAt, remote: !local, now: Date.now()
 });
 const { heartbeatExpiry, sampleExpiry } = display;
 React.useEffect(() => {
  const now = Date.now();
  const expiries = [heartbeatExpiry, sampleExpiry]
   .filter((expiry): expiry is number => expiry != null && expiry >= now);
  const timers = expiries.map(expiry => setTimeout(() => tick(value => value + 1), expiry + 1 - now));
  return () => timers.forEach(clearTimeout);
 }, [heartbeatExpiry, sampleExpiry]);
 const { upload, download, transfer, scan, cpu, memory } = iosManaged ? { upload: null, download: null, transfer: null, scan: null, cpu: null, memory: null } : display;

 const [windowId, setWindowId] = React.useState<DeviceResourceWindow>('live');
 const [custom, setCustom] = React.useState(() => ({ from: formDateTime(Date.now() - 3_600_000), to: formDateTime(Date.now()) }));
 const [query, setQuery] = React.useState<{ from: number; to: number; bucketCount: number }>();
 const [history, setHistory] = React.useState<{ key: string; range: typeof query; value?: DeviceSyncHistory; error?: string; loading: boolean }>();
 const [historyError, setHistoryError] = React.useState('');
 const [historyRefresh, setHistoryRefresh] = React.useState(0);
 const selectWindow = (id: DeviceResourceWindow) => {
  setHistoryError('');
  setWindowId(id);
  const duration = deviceResourceWindows.find(([key]) => key === id)?.[2];
  const to = Date.now();
  setQuery(duration ? { from: to - duration, to, bucketCount: 24 } : undefined);
 };
 const applyCustom = () => {
  const from = Date.parse(custom.from), to = Date.parse(custom.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) {
   setHistoryError('Enter a start date and an end date after it.');
   return;
  }
  setHistoryError('');
  setQuery({ from, to, bucketCount: 24 });
 };
 const historyAvailable = allowed && !iosManaged && discovery !== 'checking';
 const historyKey = JSON.stringify([key, local]);
 React.useEffect(() => {
  if (!historyAvailable || !query || windowId === 'live') return;
  const controller = new AbortController();
  const check = () => {
   controller.signal.throwIfAborted();
   assertRef.current();
   if (local && hostRef.current?.origin() !== origin) throw Error('The selected Sync server changed.');
   if (!local && rendererOrigin !== origin) throw Error('The selected Sync server changed.');
  };
  const scope = { origin, ownerId, deviceId, dataPlane: 'home' };
  const duration = deviceResourceWindows.find(([key]) => key === windowId)?.[2];
  const viewerNow = Date.now();
  const clock = sourceClock.current;
  const to = !local && clock.observedAt != null && clock.receivedAt != null
   ? clock.observedAt + Math.max(0, viewerNow - clock.receivedAt) : viewerNow;
  const range = duration ? { from: to - duration, to, bucketCount: query.bucketCount } : query;
  setHistory(previous => ({ key: historyKey, range: query, value: previous?.key === historyKey && previous.range === query ? previous.value : undefined, loading: true }));
  void (async () => {
   check();
   const remote = local ? undefined : createRemoteSyncClient({ ...scope, assertCurrent: check, signal: controller.signal });
   const value = await readDeviceSyncHistory({ scope, range, assertCurrent: check, signal: controller.signal, remote });
   check();
   setHistory({ key: historyKey, range: query, value, loading: false });
  })().catch(cause => {
   if (!controller.signal.aborted) setHistory(previous => ({ key: historyKey, range: query, value: previous?.key === historyKey && previous.range === query ? previous.value : undefined,
    error: cause instanceof Error ? cause.message : 'History could not be read.', loading: false }));
  });
  return () => controller.abort();
 }, [query, historyAvailable, historyKey, historyRefresh, local, origin, rendererOrigin, ownerId, deviceId, windowId]);
 const selectedHistory = historyAvailable && query && history?.key === historyKey && history.range === query ? history : undefined;
 React.useEffect(() => {
  // Schedule from settled success, never abort an in-flight request to catch
  // up to a timer. An error leaves the last result and the explicit retry.
  if (!selectedHistory?.value || selectedHistory.loading || selectedHistory.error || windowId === 'live' || windowId === 'custom') return;
  let timer: ReturnType<typeof setTimeout>;
  const update = () => setHistoryRefresh(value => value + 1);
  const visible = () => document.visibilityState === 'visible';
  const onVisibility = () => {
   clearTimeout(timer);
   if (visible()) update();
  };
  if (visible()) timer = setTimeout(update, 10_000);
  document.addEventListener('visibilitychange', onVisibility);
  return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
 }, [selectedHistory, windowId]);
 const historyValue = selectedHistory?.value;
 const historyDisplay = React.useMemo(() => deviceResourceHistoryDisplay(historyValue), [historyValue]);
 const refreshDisabled = !allowed || discovery === 'checking' || (windowId === 'live'
  ? local ? checking : !!remote.checking || !remote.refresh : !!selectedHistory?.loading || !query);
 const refresh = () => {
  if (refreshDisabled) return;
  if (windowId === 'live') { if (local) refreshRef.current?.(); else void remote.refresh?.(); return; }
  if (query) setHistoryRefresh(value => value + 1);
 };
 const budget = (value: number | undefined, unit: string) => value === undefined ? 'Unverified budget' : resourceReading(value, unit);
 const meter = (name: string, value: number | null, max: number, unit: string, target: string, qualifier = '') => ({
  [`${name}Text`]: `${resourceReading(value, unit)}${qualifier} / ${target}`,
  [`${name}Width`]: value == null ? 0 : Math.min(100, Math.max(0, value / max * 100)),
  [`${name}Unknown`]: value == null, [`${name}Value`]: Math.min(value ?? 0, max), [`${name}Max`]: max
 });
 const liveLoading = checking || !!remote.checking;
 const liveCold = allowed && (discovery === 'checking' || (liveLoading && observedAt == null));
 const data = {
  status: iosManaged ? IOS_SYNC_RESOURCE_STATUS : !allowed ? 'Sign in to view this device’s private Sync resources.'
   : liveCold ? ''
   : display.idle ? display.lastNative || retainingMeasurement ? 'Idle · no active Sync or Backup work. CPU and memory show the last measurements, not current usage.' : 'Idle · no active Sync or Backup work on this device.'
   : retainingMeasurement ? 'Last measurements · waiting for a new reading. These values are not current.'
   : display.stale ? 'Last measurement · stale. These readings are not current.'
   : display.sampleCurrent ? 'Measuring Sync and Backup on this device.'
   : local ? (online ? 'Sync is active. Waiting for the first resource measurement…' : 'Local resource status is temporarily unavailable.')
   : remote.status,
  measurement: iosManaged ? 'Native resource telemetry unavailable on this iOS version.' : display.measurementAt == null ? liveCold ? '' : 'No resource reading yet.' : `${display.idle && !display.lastNative && !retainingMeasurement ? 'Idle confirmed' : 'Last measured'}: ${resourceDateTime(retainingMeasurement ? resources!.measuredAt! : display.measurementAt)}`,
  ...meter('transfer', transfer, (selectedPolicy?.transferBytesPerSecond ?? 625000) / 125000, 'Mbps', iosManaged ? 'iOS-managed' : budget(selectedPolicy && selectedPolicy.transferBytesPerSecond / 125000, 'Mbps shared')),
  ...meter('scan', scan, (selectedPolicy?.scanBytesPerSecond ?? 625000) / 125000, 'Mbps', iosManaged ? 'iOS-managed' : budget(selectedPolicy && selectedPolicy.scanBytesPerSecond / 125000, 'Mbps')),
  ...meter('cpu', cpu, 100, '%', iosManaged ? 'iOS-managed' : budget(selectedPolicy?.cpuPercent, '% target'), cpu != null ? ` (${resources?.cpuScopes?.length ?? '?'} of 3 scopes)${display.lastNative || retainingMeasurement ? ' · last measured' : ''}` : ''),
  ...meter('memory', memory, 512, 'MiB', iosManaged ? 'iOS-managed' : selectedPolicy ? '512 MiB indexer budget' : 'Unverified budget', memory != null && (display.lastNative || retainingMeasurement) ? ' · last measured' : ''),
  targetsUnavailable: iosManaged,
  policyDescription: iosManaged ? 'iOS manages this device; native CPU, scan and rate budgets are not enforced here.' : 'Device-wide budgets apply only after the selected device confirms its active policy. CPU is an adaptive target for Sync work. Directory discovery uses CPU and worker backpressure; Mbps measures file-content reads.',
  directions: iosManaged ? 'Upload/download progress is shown per connection. Native resource telemetry is unavailable.' : `Upload: ${resourceReading(upload, 'Mbps')} · Download: ${resourceReading(download, 'Mbps')}. Memory covers the native indexer only.`,
  ...Object.fromEntries((['transfer', 'scan', 'cpu'] as const).flatMap(name => [[`${name}Id`, `${prefix}-${name}`], [`${name}Target`, draft[name]]])),
  disabled: !allowed || iosManaged || (local ? !native?.online : !remote.save), error,
  history: { ...historyDisplay,
   id: prefix, custom, showCustom: !iosManaged && windowId === 'custom', showLive: iosManaged || windowId === 'live', showHistory: !iosManaged && windowId !== 'live',
   disabled: !historyAvailable, pressed: Object.fromEntries(deviceResourceWindows.map(([id]) => [id, id === (iosManaged ? 'live' : windowId)])),
   backgrounds: Object.fromEntries(deviceResourceWindows.map(([id]) => [id, id === windowId ? 'color-mix(in srgb, var(--tt-accent, #7864d9) 16%, transparent)' : 'transparent'])),
   refreshDisabled: iosManaged || refreshDisabled,
   refreshLabel: windowId === 'live' ? 'Refresh live' : 'Refresh history',
   hasData: historyDisplay.sampleCount > 0,
   recordingIssue: historyValue?.recordingIssue === 'storage-unavailable',
   workingLabel: windowId === 'live'
    ? liveCold ? 'Checking device…' : liveLoading ? 'Refreshing…' : ''
    : query && (!selectedHistory || selectedHistory.loading) ? 'Reading history…' : '',
   status: historyError || (selectedHistory?.error ? `${historyValue ? 'Showing previous readings. ' : ''}${selectedHistory.error}`
    : !query ? 'Select a start and end time to view history.'
    : (!selectedHistory || selectedHistory.loading) && !historyValue ? ''
    : !historyValue?.sampleCount ? 'No measurements in this window. History begins once this version records activity on the device.'
    : `${historyDisplay.sampleCount.toLocaleString()} recorded readings. Gaps indicate intervals without a reading.`),
   timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }
 };
 const actions: React.ComponentProps<typeof TransientBlockHost>['actions'] = {
  ...Object.fromEntries((['transfer', 'scan', 'cpu'] as const).map(name => [`target-${name}`, ({ value }: { value?: unknown }) => { dirty.current = true; setDraft(old => ({ ...old, [name]: String(value ?? '') })); }])),
  'select-history-window': ({ inputs: { id } }) => {
   if (historyAvailable && deviceResourceWindows.some(([value]) => value === id)) selectWindow(id as DeviceResourceWindow);
  },
  'history-from': ({ value }) => setCustom(previous => ({ ...previous, from: String(value ?? '') })),
  'history-to': ({ value }) => setCustom(previous => ({ ...previous, to: String(value ?? '') })),
  'history-apply': applyCustom,
  'refresh-resources': refresh,
  'save-targets': async () => {
   try {
    assertCurrent();
    if (iosManaged || (local ? !native?.online : !remote.save)) throw Error('The selected device is unavailable for resource changes.');
    const next = { transferBytesPerSecond: Number(draft.transfer) * 125000, scanBytesPerSecond: Number(draft.scan) * 125000, cpuPercent: Number(draft.cpu) };
    if (!local && remote.save) { await remote.save(next); assertCurrent(); dirty.current = false; setError('Selected device targets saved.'); return; }
    if (!hostRef.current) throw Error('The paired device connection changed.');
    const result = await hostRef.current.request(ownerId, { action: 'resources', deviceResourceLimits: next }, AbortSignal.timeout(20_000));
    assertCurrent();
    if (!result.deviceResourceLimits) throw Error('The device did not confirm its saved resource targets.');
    dirty.current = false;
    saveDeviceSyncResourcePolicy(key, result.deviceResourceLimits);
    setError('Device targets saved. Active captures retain their scan and CPU budgets until the next capture.');
   } catch (cause) { setError(cause instanceof Error ? cause.message : 'Targets could not be saved.'); }
  }
 };
 return <SettingsDocumentHost documentKey="device-sync-total-resources" defaultDocument={deviceSyncResourceBlocks} migrateBlocks={migrateResourcePresentation} scopeKey={key} title="Total Sync resource usage">
  {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={key} enabled={!editing} scope={{ deviceResources: data }} actions={actions}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
 </SettingsDocumentHost>;
}
