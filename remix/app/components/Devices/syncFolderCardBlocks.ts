import type { ForegroundSyncProgress } from '~/fileSync/foregroundSync';
import type { NativePhotoUnavailableReasons } from '~/fileSync/nativePhotoRunProgress';
import type { WebpageBlock } from '../Builder/webpageBlocks';

/** A shared editable summary, never inferred from a Home/name/type alias. */
export const syncFolderCardBlocks: WebpageBlock[] = [{ id: 'folder-card-summary', type: 'element', tag: 'div', css: { display: 'grid', gap: '4px' }, children: [
 { id: 'folder-card-header', type: 'element', tag: 'div', css: { display: 'flex', gap: '8px', 'align-items': 'center' }, children: [
  { id: 'folder-card-title', type: 'element', tag: 'h4', text: '{folder.title}', css: { 'font-weight': '600', flex: '1', 'min-width': '0' } },
  { id: 'folder-card-expand', type: 'element', tag: 'button', text: '{folder.toggleGlyph}',
   props: { type: 'button', disabled: '{folder.disabled}', 'aria-label': '{folder.expandLabel}', 'aria-expanded': '{folder.expanded}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'expand' } },
   css: { 'min-height': '44px', 'min-width': '44px', padding: '4px 8px', 'font-size': '20px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px' } }
 ] },
 { id: 'folder-card-path', type: 'element', tag: 'p', text: '{folder.path}', css: { 'overflow-wrap': 'anywhere', 'font-size': '12px', color: 'var(--tt-muted, #71717a)' } },
 { id: 'folder-card-stats-row', type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '4px 10px' }, children: [
 { id: 'folder-card-description', type: 'element', tag: 'p', text: '{folder.description}', css: { 'font-size': '12px' } },
 { id: 'folder-card-stats', type: 'element', tag: 'p', text: '{folder.stats}', props: { role: 'status' }, css: { 'font-size': '12px', color: 'var(--tt-muted, #71717a)' } }
 ] }
] }];


export type SyncFolderPreparation = { label: string; percent?: number; percentText: string; fillWidth: string; fillBackground: string };

export function photoDownloadPreparation(download?: { fraction: number }): SyncFolderPreparation | undefined {
 if (!download || !Number.isFinite(download.fraction) || download.fraction < 0 || download.fraction > 1) return undefined;
 const percent = Math.min(99.9, Math.floor(download.fraction * 1000) / 10);
 return { label: 'Downloading an original from iCloud', ...(percent > 0 ? { percent } : {}),
  percentText: percent > 0 ? percent.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%' : '',
  fillWidth: percent > 0 ? percent + '%' : '100%',
  fillBackground: percent > 0 ? 'var(--tt-accent, #7864d9)' :
   'repeating-linear-gradient(135deg, transparent 0 6px, var(--tt-surface, #fafafb) 6px 12px)' };
}

export type PhotoQueueProgress = { pending?: number; unavailable?: number; unavailableReasons?: NativePhotoUnavailableReasons };

const activityMuted = { color: 'var(--tt-muted, #71717a)' };
const activityText = (id: string, tag: string, text: string, css?: Record<string, string>): WebpageBlock =>
 ({ id: 'folder-card-activity-' + id, type: 'element', tag, text, css });
const activityMetric = (id: string, label: string): WebpageBlock => ({
 id: 'folder-card-activity-' + id + '-state', type: 'condition', condition: { arg: 'folder.activity.' + id }, children: [
  { id: 'folder-card-activity-' + id, type: 'element', tag: 'div',
   css: { display: 'flex', 'flex-wrap': 'wrap', gap: '2px 8px' }, children: [
    activityText(id + '-label', 'dt', label, activityMuted),
    activityText(id + '-value', 'dd', '{folder.activity.' + id + '}', { 'font-variant-numeric': 'tabular-nums' })
   ] }
 ]
});

const syncFolderActivityBlock: WebpageBlock = {
 id: 'folder-card-activity-state', type: 'condition', condition: { arg: 'folder.hasActivity', equals: true }, children: [
  { id: 'folder-card-activity', type: 'element', tag: 'details',
   css: { 'margin-top': '8px', 'border-top': '1px solid var(--tt-border, #ececef)', 'min-width': '0', 'font-size': '13px' }, children: [
    { id: 'folder-card-activity-summary', type: 'element', tag: 'summary',
     css: { cursor: 'pointer', 'min-height': '44px', 'align-content': 'center', 'padding-block': '8px', 'overflow-wrap': 'anywhere' }, children: [
      activityText('title', 'span', 'Backup activity', { 'font-weight': '600' }),
      activityText('phase', 'span', '{folder.activity.phase}', { ...activityMuted, display: 'block', 'margin-block-start': '2px' })
     ] },
    { id: 'folder-card-activity-reason-state', type: 'condition', condition: { arg: 'folder.activity.reason' }, children: [
     activityText('reason', 'p', '{folder.activity.reason}', { ...activityMuted, 'margin-bottom': '8px' })
    ] },
    { id: 'folder-card-activity-counts', type: 'element', tag: 'dl', css: { display: 'grid', gap: '4px' }, children: [
     activityMetric('indexed', 'Library indexed'),
     activityMetric('prepared', 'Originals prepared in this batch'),
     activityMetric('backlog', 'Originals in queue')
    ] },
    { id: 'folder-card-activity-download-state', type: 'condition', condition: { arg: 'folder.activityHasDownload', equals: true }, children: [
     activityText('download-label', 'p', 'Current iCloud download · {folder.activity.downloadPercent}%', { 'margin-top': '6px' }),
     { id: 'folder-card-activity-download-progress', type: 'element', tag: 'progress',
      props: { max: 100, value: '{folder.activity.downloadPercent}', 'aria-label': 'Current iCloud download' },
      css: { width: '100%', height: '8px', 'accent-color': 'var(--tt-accent, #7864d9)' } }
    ] },
    activityText('history-title', 'h5', 'Recent activity', { 'margin-top': '10px', 'margin-bottom': '4px', 'font-weight': '600' }),
    { id: 'folder-card-activity-history', type: 'collection',
     props: { itemsPath: 'folder.activity.events', label: 'Recent backup activity', hideSearch: true, hideSize: true,
      hideCount: true, size: 'all', transparent: true, empty: 'No activity history reported by this iPhone yet.' },
     children: [{ id: 'folder-card-activity-event', type: 'element', tag: 'div',
      css: { display: 'flex', 'justify-content': 'space-between', 'flex-wrap': 'wrap', gap: '2px 12px', padding: '4px 0',
       'border-top': '1px solid var(--tt-border, #ececef)' }, children: [
       activityText('event-label', 'span', '{item.label}'),
       { ...activityText('event-time', 'span', '{item.time}', activityMuted), props: { title: '{item.at}' } }
      ] }]
    }
   ] }
 ]
};

export function photoQueueDisplay(queue?: PhotoQueueProgress) {
 if (!queue || [queue.pending, queue.unavailable].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) return undefined;
 const reasons = queue.unavailableReasons;
 const knownReasons = reasons && [reasons['cloud-download'], reasons['photo-read']].every(value => Number.isSafeInteger(value) && value >= 0) &&
  reasons['cloud-download'] + reasons['photo-read'] === queue.unavailable;
 const unavailable = knownReasons && queue.unavailable ? [
  reasons['cloud-download'] ? `${reasons['cloud-download'].toLocaleString()} awaiting download` : '',
  reasons['photo-read'] ? `${reasons['photo-read'].toLocaleString()} awaiting Photos read retry` : ''
 ].filter(Boolean).join(' · ') : `${queue.unavailable?.toLocaleString() ?? '—'} ${queue.unavailable === 1 ? 'original' : 'originals'} waiting for Photos`;
 return {
  order: 'Photos queue · newest first',
  pending: `${queue.pending?.toLocaleString() ?? '—'} ${queue.pending === 1 ? 'original' : 'originals'} pending`,
  unavailable
 };
}

/** Cached progress is historical evidence; it cannot establish runnable access. */
export function syncFolderActivityLabel(state: {
 paused: boolean; rootsReady: boolean; hasRoot: boolean; taskPaused: boolean; running: boolean;
 progress?: (ForegroundSyncProgress & { photoQueue?: PhotoQueueProgress }) | null; waiting?: boolean; failed?: boolean; stopping?: boolean; photos?: boolean;
}): string {
 if (state.paused) return 'Paused';
 if (!state.rootsReady) return 'Checking folder access';
 if (!state.hasRoot) return 'Folder access missing';
 if (state.stopping) return 'Pausing…';
 const { progress } = state;
 const queue = state.photos ? photoQueueDisplay(progress?.photoQueue) : undefined;
 if (state.waiting) return progress?.message || 'Waiting to continue sync.';
 if (state.failed) return 'Needs attention';
 if (state.taskPaused) return progress?.message || 'Paused';
 if (state.running) {
  switch (progress?.stage) {
   case 'checking': return 'Checking access and sync conditions…';
   case 'scanning': return queue ? 'Preparing the next batch…' : state.photos ? 'Preparing Photos backup…' : 'Checking both folders…';
   case 'reviewing': return 'Waiting for your conflict choices.';
   case 'verifying': return 'Verifying completed work…';
   default: {
    const phase = queue ? 'Uploading this batch' : 'Transfer in progress';
    const transfer = progress?.total || progress?.totalFinal
     ? `${phase} · ${progress.confirmed} of ${progress.total} operations confirmed`
     : phase;
    return progress?.backgroundTransfer === 'foreground-only'
     ? transfer + ' · Keep Thingtime open; iOS could not schedule background processing.'
     : transfer;
   }
  }
 }
 if (progress?.stage === 'complete') {
  if (queue && (progress.photoQueue?.pending ?? 0) > 0) return 'More Photos originals are queued.';
  if (queue && (progress.photoQueue?.unavailable ?? 0) > 0) return 'Partial backup · waiting for Photos originals.';
  if (progress.coverage === 'partial') {
   const count = progress.skipped?.toLocaleString();
   return `Partial backup · ${count ? `${count} ${progress.skipped === 1 ? 'item needs' : 'items need'}` : 'Some items need'} review.`;
  }
  return progress.photoAccess === 'limited' ? 'Selected photos backed up.' : 'Last transfer finished.';
 }
 if (progress?.stage === 'retained') return 'Both versions are saved in Timeline. This conflict remains unresolved.';
 return 'No active transfer';
}

/** Shared quick controls remain outside the optional settings disclosure. */
export const syncFolderQuickBlocks: WebpageBlock[] = [
 { id: 'folder-card-destination-state', type: 'condition', condition: { arg: 'folder.hasDestination', equals: true }, children: [{ id: 'folder-card-destination', type: 'element', tag: 'p', text: '{folder.destination}', css: { 'font-size': '12px', 'overflow-wrap': 'anywhere' } }] },
 { id: 'folder-card-error-state', type: 'condition', condition: { arg: 'folder.hasError', equals: true }, children: [{ id: 'folder-card-error', type: 'element', tag: 'p', text: '{folder.error}', props: { role: 'alert' }, css: { 'font-size': '12px', 'overflow-wrap': 'anywhere' } }] },
 { id: 'folder-card-automation-state', type: 'condition', condition: { arg: 'folder.hasAutomation', equals: true }, children: [
  { id: 'folder-card-automation', type: 'element', tag: 'p', text: '{folder.automation}', css: { 'font-size': '12px', 'overflow-wrap': 'anywhere' } }
 ] },
 { id: 'folder-card-photo-queue-state', type: 'condition', condition: { arg: 'folder.hasPhotoQueue', equals: true }, children: [
  { id: 'folder-card-photo-queue', type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '4px 10px', 'font-size': '12px' }, children: [
   { id: 'folder-card-photo-queue-order', type: 'element', tag: 'span', text: '{folder.photoQueue.order}', css: { 'font-weight': '600' } },
   { id: 'folder-card-photo-queue-pending-state', type: 'condition', condition: { arg: 'folder.hasPendingPhotos', equals: true }, children: [
    { id: 'folder-card-photo-queue-pending', type: 'element', tag: 'span', text: '{folder.photoQueue.pending}' }
   ] },
   { id: 'folder-card-photo-unavailable-state', type: 'condition', condition: { arg: 'folder.hasUnavailablePhotos', equals: true }, children: [
    { id: 'folder-card-photo-queue-unavailable', type: 'element', tag: 'span', text: '{folder.photoQueue.unavailable}' }
   ] }
  ] }
 ] },
 { id: 'folder-card-preparation-state', type: 'condition', condition: { arg: 'folder.hasPreparation', equals: true }, children: [
  { id: 'folder-card-preparation', type: 'element', tag: 'div', css: { display: 'grid', gap: '4px', 'max-width': '340px', 'min-width': '0' }, children: [
   { id: 'folder-card-preparation-heading', type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '2px 8px', 'justify-content': 'space-between', 'font-size': '12px' }, children: [
    { id: 'folder-card-preparation-label', type: 'element', tag: 'span', text: '{folder.preparation.label}', css: { 'overflow-wrap': 'anywhere' } },
    { id: 'folder-card-preparation-percent', type: 'element', tag: 'span', text: '{folder.preparation.percentText}', props: { 'aria-hidden': true } }
   ] },
   { id: 'folder-card-preparation-progress', type: 'element', tag: 'div',
    props: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': '{folder.preparation.percent}', 'aria-label': '{folder.preparation.label}' },
    css: { height: '5px', background: 'var(--tt-border, #dedee5)', 'border-radius': '4px', overflow: 'hidden' }, children: [
     { id: 'folder-card-preparation-fill', type: 'element', tag: 'div', props: { 'aria-hidden': true, style: { width: '{folder.preparation.fillWidth}', background: '{folder.preparation.fillBackground}' } },
      css: { height: '100%' } }
    ] }
  ] }
 ] },
 { id: 'folder-card-action-state', type: 'condition', condition: { arg: 'folder.hasAction', equals: true }, children: [{ id: 'folder-card-quick-action', type: 'element', tag: 'button', text: '{folder.actionLabel}', props: { type: 'button', disabled: '{folder.actionDisabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'quick' } }, css: { 'min-height': '44px', padding: '8px 12px', 'justify-self': 'start', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', background: 'var(--tt-card, #fff)' } }] },
 { id: 'folder-card-pause-automatic-state', type: 'condition', condition: { arg: 'folder.hasPauseAction', equals: true }, children: [
  { id: 'folder-card-pause-automatic', type: 'element', tag: 'button', text: '{folder.pauseLabel}',
   props: { type: 'button', disabled: '{folder.pauseDisabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'pause-automatic' } },
   css: { 'min-height': '44px', padding: '8px 12px', 'justify-self': 'start', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', background: 'var(--tt-card, #fff)' } }
 ] },
 { id: 'folder-card-background-action-state', type: 'condition', condition: { arg: 'folder.hasContinuation', equals: true }, children: [
  { id: 'folder-card-background-action', type: 'element', tag: 'button', text: '{folder.continuationLabel}',
   props: { type: 'button', disabled: '{folder.continuationDisabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'continue-background' } },
   css: { 'min-height': '44px', padding: '8px 12px', 'justify-self': 'start', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', background: 'var(--tt-card, #fff)' } },
  { id: 'folder-card-background-help', type: 'element', tag: 'p', text: 'Continue this backup while using other apps. It ends when the backup is up to date. iOS can stop it sooner.',
   css: { 'font-size': '12px', 'overflow-wrap': 'anywhere' } }
 ] },
 { id: 'folder-card-background-status-state', type: 'condition', condition: { arg: 'folder.hasContinuationStatus', equals: true }, children: [
  { id: 'folder-card-background-status', type: 'element', tag: 'p', text: '{folder.continuationStatus}', props: { role: 'status' },
   css: { 'font-size': '12px', 'overflow-wrap': 'anywhere' } }
 ] },
 { id: 'folder-card-activity-indexing-state', type: 'condition', condition: { arg: 'folder.activity.indexing' }, children: [
  { id: 'folder-card-activity-indexing', type: 'element', tag: 'div', props: { role: 'status', 'aria-atomic': true },
   css: { display: 'grid', gap: '2px', 'font-size': '13px', 'overflow-wrap': 'anywhere' }, children: [
    activityText('indexing-count', 'p', '{folder.activity.indexing}', activityMuted),
    { id: 'folder-card-activity-live-indexed-state', type: 'condition', condition: { arg: 'folder.activity.indexed' }, children: [
     activityText('live-indexed', 'p', '{folder.activity.indexed}', activityMuted)
    ] },
    { id: 'folder-card-activity-latest-found-state', type: 'condition', condition: { arg: 'folder.activity.latestFound' }, children: [
     activityText('latest-found', 'p', '{folder.activity.latestFound}')
    ] }
   ] }
 ] },
 syncFolderActivityBlock
];
const legacyQuickBlocks = structuredClone(syncFolderQuickBlocks);
const stableIds = new Set(['folder-card-activity-indexing-state', 'folder-card-activity-live-indexed-state',
 'folder-card-activity-latest-found-state', 'folder-card-activity-indexed-state', 'folder-card-activity-prepared-state',
 'folder-card-activity-backlog-state', 'folder-card-activity-download-state', 'folder-card-activity-reason-state',
 'folder-card-photo-queue-pending-state', 'folder-card-photo-unavailable-state']);
function reserveActivity(block: WebpageBlock): void {
 if (stableIds.has(block.id)) { block.type = 'element'; block.tag = 'div'; delete block.condition; }
 if (block.id === 'folder-card-activity') { block.tag = 'details'; block.props = { ...block.props, open: true }; }
 if (block.id === 'folder-card-activity-summary') block.tag = 'summary';
 if (['folder-card-automation', 'folder-card-background-status'].includes(block.id)) block.css = { ...block.css, 'min-height': '2.8em' };
 if (block.id === 'folder-card-photo-queue') block.css = { ...block.css, display: 'grid', 'font-variant-numeric': 'tabular-nums' };
 if (block.id === 'folder-card-photo-unavailable-state') block.css = { ...block.css, 'min-height': '4.2em' };
 if (block.id === 'folder-card-activity-download-state') block.children = block.children?.map(child => child.id === 'folder-card-activity-download-progress' ? {
  id: 'folder-card-activity-download-meter-slot', type: 'element', tag: 'div', css: { height: '8px' }, children: [
   { ...child, props: { ...child.props, hidden: '{folder.activityDownloadHidden}' } }
  ]
 } : child);
 if (block.id === 'folder-card-activity-phase') block.text = 'Latest reported library and transfer details';
 if (block.id === 'folder-card-activity-indexing') block.children = block.children?.filter(child => child.id !== 'folder-card-activity-live-indexed-state');
 if (block.id === 'folder-card-activity-counts') block.children?.push(activityText('unavailable-help', 'p',
  'Originals waiting for Photos retry automatically when your transfer settings allow. Available originals continue backing up.', activityMuted));
 if (block.id === 'folder-card-activity-download-label') block.text = '{folder.activity.downloadLabel}';
 if (['folder-card-activity-reason', 'folder-card-activity-indexing-count', 'folder-card-activity-live-indexed', 'folder-card-activity-latest-found', 'folder-card-activity-download-label'].includes(block.id)) block.css = { ...block.css, 'min-height': '2.8em' };
 if (block.id === 'folder-card-activity') block.children = block.children?.map(child => child.id === 'folder-card-activity-history' ? {
  id: 'folder-card-activity-history-viewport', type: 'element', tag: 'div', css: { height: '160px', overflow: 'auto' }, children: [child]
 } : child);
 for (const child of block.children ?? []) reserveActivity(child);
}
for (const block of syncFolderQuickBlocks) reserveActivity(block);

/** Only exact stock branches migrate. A customized branch keeps all of its edits. */
export function withSyncFolderQuickBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
 const migrated = blocks.map(block => {
  const legacy = legacyQuickBlocks.find(stock => stock.id === block.id);
  return legacy && JSON.stringify(legacy) === JSON.stringify(block)
   ? syncFolderQuickBlocks.find(stock => stock.id === block.id)! : block;
 });
 const existing = JSON.stringify(migrated);
 return [...migrated, ...syncFolderQuickBlocks.filter(block => !existing.includes(`"id":"${block.id}"`))];
}
