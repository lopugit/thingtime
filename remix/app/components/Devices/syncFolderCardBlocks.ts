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
export function syncFolderActivityLabel(state: { paused: boolean; rootsReady: boolean; hasRoot: boolean; taskPaused: boolean; running: boolean }): string {
 if (state.paused) return 'Paused';
 if (!state.rootsReady) return 'Checking folder access';
 if (!state.hasRoot) return 'Folder access missing';
 if (state.taskPaused) return 'Paused';
 return state.running ? 'Transfer in progress' : 'No active transfer';
}
