import { activityInterval, clearActivityInterval } from '~/activity/activityManager';
import React from 'react';
import type { ForegroundSyncProgress } from '~/fileSync/foregroundSync';
import type { SyncProgressState } from '~/fileSync/progressProjection';
import { toWindowMs, type TransferSpeedSeries, type SpeedReading, type TransferUnit } from '~/fileSync/transferSpeed';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { findBlock } from '../Builder/webpageBlocks';
import { SettingsDocumentHost, type SettingsDocumentControls, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { MAX_SPEED_TRACKERS, TRANSFER_UNITS, WINDOW_UNITS, readSpeedTrackers, speedTrackerBlocks, transferSpeedBlocks, updateSpeedTracker, type SpeedTracker } from './transferSpeedBlocks';

export type TransferSpeedTrackersProps = {
 scopeKey: string;
 state?: SyncProgressState;
 stage?: ForegroundSyncProgress['stage'];
 /** Runtime history is owned by the active transfer, never the saved layout. */
 series?: Pick<TransferSpeedSeries, 'read'>;
 accountTransport?: SettingsDocumentHostProps['accountTransport'];
};
export function TransferSpeedTrackers(props: TransferSpeedTrackersProps) {
 return <SettingsDocumentHost documentKey="file-sync-speed-trackers" defaultDocument={transferSpeedBlocks} scopeKey={props.scopeKey} title="Transfer speed trackers" accountTransport={props.accountTransport}>
  {document => <TrackerDocument key={props.scopeKey} {...props} document={document} />}
 </SettingsDocumentHost>;
}
export function speedReadingLabel(reading: SpeedReading | undefined, state: SyncProgressState = 'running', stage?: ForegroundSyncProgress['stage']) {
 if (state === 'complete') {
  if (!reading || (reading.status === 'unknown' && reading.reason === 'unavailable')) return 'Complete · Rate unavailable';
  if (reading.status === 'unknown') return 'Complete · No rate samples';
  return 'Complete';
 }
 if (state === 'paused') return 'Paused';
 if (state === 'running' && (stage === 'checking' || stage === 'scanning')) return 'Waiting for indexing';
 if (!reading) return 'Unavailable';
 if (reading.status === 'paused') return state === 'cancelled' ? 'Cancelled' : state === 'error' ? 'Stopped after error' : 'Paused';
 if (reading.status === 'unknown') return reading.reason === 'unavailable' ? 'Unavailable' : 'Collecting samples…';
 return `${reading.value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${reading.unit}`;
}
export function observedSeconds(reading: SpeedReading | undefined, windowMs: number) {
 return (Math.min(reading?.observedDurationMs || 0, windowMs) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function TrackerDocument({ scopeKey, series, state, stage, document }: TransferSpeedTrackersProps & { document: SettingsDocumentControls }) {
 const [, tick] = React.useReducer(value => value + 1, 0);
 React.useEffect(() => { if (state !== 'running' || !series) return; const timer = activityInterval('timer:components/Devices/TransferSpeedTrackers:1', 'Transfer speed display', tick, 1000); return () => clearActivityInterval(timer); }, [state, series]);
 const [error, setError] = React.useState('');
 const trackers = readSpeedTrackers(document.blocks);
 const readings: Record<string, Record<string, string>> = {};
 for (const tracker of trackers) {
  const windowMs = toWindowMs(tracker.windowValue, tracker.windowUnit);
  const upload = series?.read({ direction: 'upload', unit: tracker.unit, windowMs });
  const download = series?.read({ direction: 'download', unit: tracker.unit, windowMs });
  readings[tracker.id] = { upload: speedReadingLabel(upload, state, stage), download: speedReadingLabel(download, state, stage),
   window: `Averaging over ${tracker.windowValue} ${tracker.windowValue === 1 ? tracker.windowUnit.slice(0, -1) : tracker.windowUnit} · Upload ${observedSeconds(upload, windowMs)}s / Download ${observedSeconds(download, windowMs)}s measured${['Kbps', 'Mbps', 'Gbps'].includes(tracker.unit) ? ' · Acknowledged payload samples; native uploads update on completed-part acknowledgment, not continuous wire progress.' : ''}${!series ? ' · Live transfer counters unavailable.' : ''}` };
 }
 const actions: TransientBlockActions = {
  add: () => {
   if (document.saving || trackers.length >= MAX_SPEED_TRACKERS) return;
   const blocks = structuredClone(document.blocks), parent = findBlock(blocks, 'speed-trackers');
   if (!parent) { setError('Restore the tracker list in Edit layout before adding a tracker.'); return; }
   parent.children = [...(parent.children || []), speedTrackerBlocks({ id: `tracker-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, windowValue: 10, windowUnit: 'seconds', unit: 'Mbps' })];
   document.setBlocks(blocks); setError('');
  },
  remove: ({ inputs }) => {
   if (document.saving || !trackers.some(t => t.id === inputs.id)) return;
   const blocks = structuredClone(document.blocks), parent = findBlock(blocks, 'speed-trackers');
   if (parent) parent.children = parent.children?.filter(node => node.props?.['data-speed-tracker'] !== inputs.id);
   document.setBlocks(blocks); setError('');
  },
  apply: ({ inputs, readField }) => {
   if (document.saving) return;
   const tracker = trackers.find(t => t.id === inputs.id); if (!tracker) return;
   const raw = readField('window'), windowValue = typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
   const windowUnit = readField('time') as SpeedTracker['windowUnit'], unit = readField('unit') as TransferUnit;
   try {
    if (!WINDOW_UNITS.includes(windowUnit) || !TRANSFER_UNITS.includes(unit)) throw Error('Choose a supported time and rate unit.');
    toWindowMs(windowValue, windowUnit);
    document.setBlocks(updateSpeedTracker(document.blocks, { ...tracker, windowValue, windowUnit, unit })); setError('');
   } catch { setError('Choose an averaging timeframe from 1 second to 24 hours and a supported rate unit.'); }
  },
  save: async () => { if (document.canSave && document.dirty) { const result = await document.save(); setError(result.ok ? '' : result.error || 'Tracker settings could not be saved.'); } }
 };
 return <TransientBlockHost scopeKey={scopeKey} enabled={!document.editing} actions={actions} scope={{ speed: {
  readings, error, controlsDisabled: document.saving, addDisabled: document.saving || trackers.length >= MAX_SPEED_TRACKERS,
  saveDisabled: !document.canSave || !document.dirty, saveLabel: document.saving ? 'Saving trackers…' : 'Save trackers',
  status: `${trackers.length} / ${MAX_SPEED_TRACKERS} trackers${document.dirty ? ' · Unsaved tracker settings.' : ''}`
 } }}><WebpageBlocksRenderer blocks={document.blocks} componentsByRef={{}} chrome={document.chrome} /></TransientBlockHost>;
}
