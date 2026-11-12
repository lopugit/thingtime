import { blockLabel, findBlock, findParentId, type WebpageBlock } from './webpageBlocks';

export type BlockStructureScope = 'page' | 'parent' | 'block';
export type BlockStructureRow = {
 id: string; label: string; detail: string; type: string; depth: number; indent: string;
 selected: boolean; selection: string; background: string; border: string; childCount: number;
};

/** A projection, never a second editable copy of the page. Scope remains tied
 * to the block that opened the dialog; selecting a node cannot move the tree. */
export function blockStructureData(blocks: WebpageBlock[], anchorId: string, requestedScope: BlockStructureScope, selectedId: string | null) {
 const anchor = findBlock(blocks, anchorId);
 const parentId = anchor ? findParentId(blocks, anchorId) : undefined;
 const scope = anchor ? requestedScope : 'page';
 const rootId = scope === 'block' ? anchorId : scope === 'parent' ? parentId ?? null : null;
 const root = rootId ? findBlock(blocks, rootId) : null;
 const roots = root ? [root] : blocks;
 const rows: BlockStructureRow[] = [];
 const pending = roots.map(block => ({ block, depth: 0 })).reverse();
 while (pending.length) {
  const { block, depth } = pending.pop()!;
  const selected = block.id === selectedId;
  const detail = block.type === 'text' ? block.text || '' : block.type === 'media' ? block.alt || block.src || '' : block.id;
  rows.push({ id: block.id, label: blockLabel(block), detail, type: block.type, depth,
   indent: `min(${depth * 14}px, 30%)`, selected, selection: selected ? 'Selected' : '', childCount: block.children?.length || 0,
   background: selected ? 'var(--tt-accent-tint, #fff5fa)' : 'var(--tt-card, #fff)',
   border: selected ? 'var(--tt-accent, #e84c9e)' : 'var(--tt-border, #ececef)' });
  for (let index = (block.children?.length || 0) - 1; index >= 0; index--) pending.push({ block: block.children![index], depth: depth + 1 });
 }
 return { rows, scope, rootId, heading: scope === 'page' ? 'Page structure' : scope === 'parent' ? 'Parent block structure' : 'Block structure',
  description: !anchor ? 'The original block was removed. Showing the current page.' : scope === 'parent' && !parentId
   ? 'This block is at the page root. Showing the page and its descendants.' : 'Select any block to open it in the current inspector.',
  context: root ? `${blockLabel(root)} · ${root.id}` : 'Page root', count: rows.length,
  pageSelected: scope === 'page', parentSelected: scope === 'parent', blockSelected: scope === 'block' };
}

const action = (operation: string, inputs: Record<string, unknown> = {}) => ({
 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs }
});
const scopeButton = (scope: BlockStructureScope, text: string): WebpageBlock => ({
 id: `structure-scope-${scope}`, type: 'element', tag: 'button', text,
 props: { type: 'button', 'aria-pressed': `{structure.${scope}Selected}`, ...action('scope', { scope }) },
 css: { padding: '10px 14px', 'min-height': '44px', border: '1px solid var(--tt-border, #ececef)',
  'border-radius': 'var(--tt-radius-sm, 9px)', background: 'var(--tt-card, #fff)', cursor: 'pointer' }
});

/** The dialog content and repeated row template are ordinary editable Builder
 * blocks. SettingsDocumentHost persists a personal saved Thing; only the live
 * tree projection and narrow selection/scope adapters come from native code. */
export const blockStructureBlocks: WebpageBlock[] = [{
 id: 'block-structure-component', type: 'element', tag: 'section', props: { id: 'block-structure-component', 'aria-label': 'Block structure' },
 css: { display: 'grid', gap: '16px', 'min-width': '0' }, children: [
  { id: 'structure-heading', type: 'element', tag: 'h2', text: '{structure.heading}', css: { 'font-size': '22px', 'font-weight': '700', margin: '0' } },
  { id: 'structure-description', type: 'element', tag: 'p', text: '{structure.description}', css: { color: 'var(--tt-muted, #656574)', margin: '0', 'line-height': '1.5' } },
  { id: 'structure-scopes', type: 'element', tag: 'nav', props: { 'aria-label': 'Structure scope' }, css: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }, children: [
   scopeButton('page', 'Whole page'), scopeButton('parent', 'Up to parent'), scopeButton('block', 'This block')
  ] },
  { id: 'structure-context', type: 'element', tag: 'p', text: '{structure.context} · {structure.count} blocks', props: { role: 'status' }, css: { 'font-size': '13px', color: 'var(--tt-muted, #656574)', 'overflow-wrap': 'anywhere', margin: '0' } },
  { id: 'structure-tree', type: 'collection', props: { itemsPath: 'structure.rows', label: 'Blocks', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: 'This page has no blocks yet.' }, children: [
   { id: 'structure-node', type: 'element', tag: 'button',
    props: { id: 'structure-node-{item.id}', type: 'button', 'aria-label': 'Inspect {item.label} {item.id}', 'aria-pressed': '{item.selected}',
     style: { marginLeft: '{item.indent}', background: '{item.background}', borderColor: '{item.border}' }, ...action('select', { blockId: '{item.id}' }) },
    css: { display: 'grid', 'grid-template-columns': 'minmax(0, 1fr) auto', gap: '4px 12px', 'text-align': 'left', 'min-height': '52px', padding: '10px 12px',
     'margin-bottom': '6px', 'max-width': '100%', 'min-width': '0', border: '1px solid', 'border-radius': 'var(--tt-radius-sm, 9px)', cursor: 'pointer', color: 'inherit' },
    children: [
     { id: 'structure-node-label', type: 'element', tag: 'strong', text: '{item.label}', css: { 'overflow-wrap': 'anywhere', 'min-width': '0', 'font-size': '14px' } },
     { id: 'structure-node-selection', type: 'element', tag: 'span', text: '{item.selection}', css: { 'font-size': '12px', color: 'var(--tt-accent, #b5216e)' } },
     { id: 'structure-node-detail', type: 'element', tag: 'span', text: '{item.detail}', css: { 'grid-column': '1 / -1', 'font-size': '12px', color: 'var(--tt-muted, #656574)', 'overflow-wrap': 'anywhere', 'min-width': '0' } }
    ] }
  ] },
  { id: 'structure-close', type: 'element', tag: 'button', text: 'Close structure', props: { type: 'button', ...action('close') }, css: { 'justify-self': 'end', padding: '10px 14px', 'min-height': '44px', 'border-radius': 'var(--tt-radius-sm, 9px)', background: 'var(--tt-surface-alt, #f5f5f7)', cursor: 'pointer' } }
 ]
}];
