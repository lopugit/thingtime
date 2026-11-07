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


/** Cached progress is historical evidence; it cannot establish runnable access. */
export function syncFolderActivityLabel(state: {
 paused: boolean; rootsReady: boolean; hasRoot: boolean; taskPaused: boolean; running: boolean;
 progress?: (ForegroundSyncProgress & { message?: string }) | null; waiting?: boolean; failed?: boolean; stopping?: boolean; photos?: boolean;
}): string {
 if (state.paused) return 'Paused';
 if (!state.rootsReady) return 'Checking folder access';
 if (!state.hasRoot) return 'Folder access missing';
 if (state.stopping) return 'Pausing…';
 const { progress } = state;
 if (state.waiting) return progress?.message || 'Waiting to continue sync.';
 if (state.failed) return 'Needs attention';
 if (state.taskPaused) return progress?.message || 'Paused';
 if (state.running) {
  switch (progress?.stage) {
   case 'checking': return 'Checking access and sync conditions…';
   case 'scanning': return state.photos ? 'Preparing Photos backup…' : 'Checking both folders…';
   case 'reviewing': return 'Waiting for your conflict choices.';
   case 'verifying': return 'Verifying completed work…';
   default: return progress?.total || progress?.totalFinal
    ? `Transfer in progress · ${progress.confirmed} of ${progress.total} operations confirmed`
    : 'Transfer in progress';
  }
 }
 if (progress?.stage === 'complete') {
  if (progress.coverage === 'partial') {
   const count = progress.skipped?.toLocaleString();
   return `Partial backup · ${count ? `${count} ${progress.skipped === 1 ? 'item needs' : 'items need'}` : 'Some items need'} review.`;
  }
  return 'Last transfer finished.';
 }
 if (progress?.stage === 'retained') return 'Both versions are saved in Timeline. This conflict remains unresolved.';
 return 'No active transfer';
}

/** Shared quick controls remain outside the optional settings disclosure. */
export const syncFolderQuickBlocks: WebpageBlock[] = [
 { id: 'folder-card-destination-state', type: 'condition', condition: { arg: 'folder.hasDestination', equals: true }, children: [{ id: 'folder-card-destination', type: 'element', tag: 'p', text: '{folder.destination}', css: { 'font-size': '12px', 'overflow-wrap': 'anywhere' } }] },
 { id: 'folder-card-error-state', type: 'condition', condition: { arg: 'folder.hasError', equals: true }, children: [{ id: 'folder-card-error', type: 'element', tag: 'p', text: '{folder.error}', props: { role: 'alert' }, css: { 'font-size': '12px', 'overflow-wrap': 'anywhere' } }] },
 { id: 'folder-card-action-state', type: 'condition', condition: { arg: 'folder.hasAction', equals: true }, children: [{ id: 'folder-card-quick-action', type: 'element', tag: 'button', text: '{folder.actionLabel}', props: { type: 'button', disabled: '{folder.actionDisabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'quick' } }, css: { 'min-height': '44px', padding: '8px 12px', 'justify-self': 'start', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', background: 'var(--tt-card, #fff)' } }] }
];
export function withSyncFolderQuickBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
 const existing = JSON.stringify(blocks);
 return [...blocks, ...syncFolderQuickBlocks.filter(block => !existing.includes(`"id":"${block.id}"`))];
}
