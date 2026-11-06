import { formatSyncBytes, parseSyncDirections, type SyncDirectionTotal } from './directionalProgress';
import type { ForegroundSyncProgress } from './foregroundSync';
import type { SpeedReading } from './transferSpeed';
export type ConnectionDirectionGlance = { title: string; rate: string; progress: string; bytes: string; inflight: string; remaining: string; operations: string; percent: number; unknown: boolean };
export type SyncConnectionGlance = Record<'upload' | 'download', ConnectionDirectionGlance>;
export function syncConnectionGlance(input: { progress?: ForegroundSyncProgress | null; rates?: { upload: SpeedReading; download: SpeedReading }; online: boolean; active: boolean; paused: boolean; waiting?: boolean; deviceLabel?: string }): SyncConnectionGlance {
 let directions;
 try { directions = input.progress?.directions ? parseSyncDirections(input.progress.directions) : undefined; } catch { /* A damaged legacy cache is unavailable, never zero. */ }
 const final = input.progress?.totalFinal === true || (input.progress?.stage === 'complete' && input.progress?.indexState !== 'indexing' && input.progress?.totalFinal !== false);
 const direction = (name: 'upload' | 'download'): ConnectionDirectionGlance => {
  const total: SyncDirectionTotal | undefined = directions?.[name], reading = input.rates?.[name];
  const rate = !input.online ? 'Unavailable · device offline' : input.waiting ? 'Unavailable · waiting' : input.paused || !input.active ? '0 Mbps · ' + (input.paused ? 'paused' : 'idle') : reading?.status === 'known' ? `${reading.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${reading.unit} live` : 'Measuring live speed…';
  if (!total) return { title: name === 'upload' ? 'Thingtime · uploads received' : `${input.deviceLabel ?? 'Mac'} · downloads received`, rate, progress: 'Progress unavailable', bytes: 'Confirmed and planned bytes unavailable', inflight: '', remaining: 'Remaining bytes unavailable', operations: 'Operation totals unavailable', percent: 0, unknown: true };
  const planned = BigInt(total.bytesTotal), confirmed = BigInt(total.bytesConfirmed), done = total.confirmed === total.operations;
  const raw = planned > BigInt(0) ? Number(confirmed * BigInt(1000) / planned) / 10 : total.operations ? total.confirmed / total.operations * 100 : 0;
  const percent = final && done ? 100 : Math.min(99.9, raw);
  const suffix = final ? '' : ' · known so far, still growing';
  return { title: name === 'upload' ? 'Thingtime · uploads received' : `${input.deviceLabel ?? 'Mac'} · downloads received`, rate,
   progress: final && total.operations === 0 ? 'No work in this direction' : `${percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%${suffix}`,
   inflight: '',
   bytes: `${formatSyncBytes(total.bytesConfirmed)} confirmed / ${formatSyncBytes(total.bytesTotal)} planned${suffix}`,
   remaining: `${formatSyncBytes(String(planned - confirmed))} ${final ? 'not yet confirmed' : 'not yet confirmed in known work; more may be discovered'}`,
   operations: `${total.confirmed.toLocaleString()} / ${total.operations.toLocaleString()} operations confirmed${suffix}`,
   percent: final && total.operations === 0 ? 0 : percent, unknown: false };
 };
 return { upload: direction('upload'), download: direction('download') };
}
