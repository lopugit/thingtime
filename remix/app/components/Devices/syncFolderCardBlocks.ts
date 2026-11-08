import type { ForegroundSyncProgress } from '~/fileSync/foregroundSync';
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

export type PhotoQueueProgress = { pending: number; unavailable: number };

export function photoQueueDisplay(queue?: PhotoQueueProgress) {
 if (!queue || !Number.isSafeInteger(queue.pending) || queue.pending < 0 ||
  !Number.isSafeInteger(queue.unavailable) || queue.unavailable < 0) return undefined;
 return {
  order: 'Photos queue · newest first',
  pending: queue.pending > 0 ? `${queue.pending.toLocaleString()} ${queue.pending === 1 ? 'original' : 'originals'} pending` : '',
  unavailable: queue.unavailable > 0 ? `${queue.unavailable.toLocaleString()} ${queue.unavailable === 1 ? 'original' : 'originals'} unavailable` : ''
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
  if (queue?.pending) return 'More Photos originals are queued.';
  if (queue?.unavailable) return 'Partial backup · some originals are unavailable.';
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
 ] }
];
export function withSyncFolderQuickBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
 const existing = JSON.stringify(blocks);
 return [...blocks, ...syncFolderQuickBlocks.filter(block => !existing.includes(`"id":"${block.id}"`))];
}
