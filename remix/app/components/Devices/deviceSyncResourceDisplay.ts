import { capabilitySatisfies } from '~/api/utils/capabilities/capabilityContract';
import type { FolderCapabilities } from '~/fileSync/mobileFolders.client';
import type { DeviceSyncHistory } from '~/fileSync/deviceSyncHistory';
import type { SyncResourceStatus } from '~/fileSync/resourceGovernor';

export const deviceResourceWindows = [
 ['live', 'Live', 0], ['1m', '1 min', 60_000], ['5m', '5 min', 300_000],
 ['1h', '1 hour', 3_600_000], ['24h', '24 hours', 86_400_000], ['custom', 'Custom', 0]
] as const;
export type DeviceResourceWindow = typeof deviceResourceWindows[number][0];
const resourceTimeFormatter = new Intl.DateTimeFormat(undefined, {
 year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
});
export const resourceDateTime = (time: number) => resourceTimeFormatter.format(time);
export const resourceReading = (value: number | null | undefined, unit: string) =>
 value == null ? 'Unavailable' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit === '%' ? '' : ' '}${unit}`;
const mbps = (bytes?: number | null) => bytes == null ? null : bytes * 8 / 1e6;
const mib = (bytes?: number | null) => bytes == null ? null : bytes / 1048576;

export function liveDeviceResourceDisplay(input: {
 resources?: SyncResourceStatus; active: boolean; online: boolean; observedAt?: number; receivedAt?: number; remote: boolean; now: number;
}) {
 const { resources, active, online, observedAt, receivedAt, remote, now } = input;
 const measuredAt = resources?.measuredAt;
 const heartbeatAt = remote ? receivedAt : observedAt;
 const heartbeatExpiry = heartbeatAt == null ? undefined : heartbeatAt + (remote ? 15_000 : 12_000);
 const sourceSampleAge = observedAt == null || measuredAt == null ? undefined : observedAt - measuredAt;
 // Compare source timestamps only with one another. The viewer clock starts
 // measuring age when the first page arrives, even if later pages take longer.
 const sampleExpiry = remote
  ? heartbeatAt == null || sourceSampleAge == null ? undefined : heartbeatAt + 15_000 - Math.max(0, sourceSampleAge)
  : measuredAt == null ? undefined : measuredAt + 7_500;
 const heartbeatCurrent = online && heartbeatAt != null && heartbeatExpiry != null
  && now - heartbeatAt >= -1_000 && now <= heartbeatExpiry;
 const sampleCurrent = heartbeatCurrent && sourceSampleAge != null && sourceSampleAge <= 2_500
  && sampleExpiry != null && now <= sampleExpiry && (remote || now - measuredAt! >= -1_000);
 const idle = heartbeatCurrent && !active;
 const stale = !idle && !!measuredAt && !sampleCurrent;
 const show = !idle && !!measuredAt;
 const upload = idle ? 0 : show ? mbps(resources?.currentUploadBytesPerSecond) : null;
 const download = idle ? 0 : show ? mbps(resources?.currentDownloadBytesPerSecond) : null;
 const scan = idle ? 0 : show ? mbps(resources?.scanBytesPerSecond) : null;
 const nativeCurrent = sampleCurrent && (!idle || sourceSampleAge! <= 1_000);
 return {
  idle, stale, lastNative: !!measuredAt && !nativeCurrent, heartbeatCurrent, sampleCurrent, heartbeatExpiry, sampleExpiry,
  measurementAt: idle && nativeCurrent ? observedAt : measuredAt ?? (idle ? observedAt : undefined),
  upload, download, scan, transfer: upload == null || download == null ? null : upload + download,
  cpu: !!measuredAt && resources?.cpuStatus === 'measured' ? resources.cpuPercent : null,
  memory: measuredAt ? mib(resources?.memoryBytes) : null
 };
}

export const historyResourceMetrics = [
 ['uploadMbps', 'Upload', 'Mbps'], ['downloadMbps', 'Download', 'Mbps'], ['scanMbps', 'File-content scan', 'Mbps'],
 ['cpuPercent', 'Sync CPU', '%'], ['memoryBytes', 'Indexer memory', 'MiB']
] as const;

export function deviceResourceHistoryDisplay(history?: DeviceSyncHistory) {
 const buckets = history?.buckets ?? [];
 const reading = (bucket: typeof buckets[number], field: typeof historyResourceMetrics[number][0]) =>
  field === 'memoryBytes' ? mib(bucket.memoryBytes) : bucket[field];
 const series = Object.fromEntries(historyResourceMetrics.map(([key, label, unit]) => {
  const values = buckets.map(bucket => reading(bucket, key));
  const measured = values.filter((value): value is number => value != null);
  const peak = measured.length ? Math.max(...measured) : null;
  const measuredReadings = buckets.reduce((total, bucket) => total + bucket.measured[key], 0);
  return [key, {
   peak: resourceReading(peak, unit),
   coverage: `${measured.length} of ${buckets.length} intervals · ${measuredReadings.toLocaleString()} readings`,
   bars: values.map((value, i) => ({
    id: String(i), height: value == null ? '0%' : `${peak ? value / peak * 100 : 0}%`,
    missing: value == null, line: `1px ${value == null ? 'dashed' : 'solid'} var(--tt-border, #dedee5)`,
    title: `${label} · ${resourceDateTime(buckets[i]!.from)} – ${resourceDateTime(buckets[i]!.to)} · ${resourceReading(value, unit)}`
   }))
  }];
 }));
 return {
  series,
  start: history ? resourceDateTime(history.range.from) : '',
  end: history ? resourceDateTime(history.range.to) : '',
  sampleCount: history?.sampleCount ?? 0,
  rows: buckets.map((bucket, i) => ({
   id: String(i), start: resourceDateTime(bucket.from), end: resourceDateTime(bucket.to), hasReadings: bucket.samples > 0, empty: bucket.samples === 0,
   ...Object.fromEntries(historyResourceMetrics.map(([key, , unit]) => [key, resourceReading(reading(bucket, key), unit)]))
  }))
 };
}

/** Missing native support never implies the renderer's saved Mac defaults. */
export const iosManagedSyncResources = (capabilities?: FolderCapabilities): boolean =>
 capabilities?.platform === 'ios' && !capabilitySatisfies(capabilities.fileResourceLimitsVersion, '1.0.0');
export const IOS_SYNC_RESOURCE_STATUS = 'iOS manages scheduling. Native CPU, scan and download limits are unavailable in this version; transfer progress remains available on each connection.';
