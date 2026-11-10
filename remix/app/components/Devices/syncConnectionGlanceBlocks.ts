import type { WebpageBlock } from '../Builder/webpageBlocks';
/** Shared per-connection template. Every metric, label and bar is editable. */
export function syncConnectionGlanceBlocks(scope = 'connectionStats', prefix = 'connection-glance'): WebpageBlock[] {
 return [{ id: prefix, type: 'element', tag: 'section', props: { 'aria-label': 'Directional folder sync progress' }, css: { display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '12px', 'min-width': '0', 'margin-top': '8px' }, children: (['download', 'upload'] as const).map(direction => ({
  id: `${prefix}-${direction}`, type: 'element', tag: 'div', css: { display: 'grid', gap: '4px', padding: '10px', background: 'var(--tt-surface, #fafafb)', 'border-radius': '10px', 'min-width': '0', 'overflow-wrap': 'anywhere' }, children: [
   { id: `${prefix}-${direction}-title`, type: 'element', tag: 'h5', text: `{${scope}.${direction}.title}`, css: { 'font-size': '12px', 'font-weight': '600' } },
   { id: `${prefix}-${direction}-headline`, type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'baseline', 'justify-content': 'space-between', gap: '4px 10px' }, children: [
    { id: `${prefix}-${direction}-rate`, type: 'element', tag: 'strong', text: `{${scope}.${direction}.rate}`, css: { 'font-size': '14px' } },
    { id: `${prefix}-${direction}-progress`, type: 'element', tag: 'span', text: `{${scope}.${direction}.progress}`, css: { 'font-size': '12px', color: 'var(--tt-muted, #71717a)' } }
   ] },
   { id: `${prefix}-${direction}-amounts`, type: 'element', tag: 'div', css: { display: 'flex', 'flex-wrap': 'wrap', gap: '2px 12px', 'font-size': '12px' }, children: [
    { id: `${prefix}-${direction}-bytes`, type: 'element', tag: 'span', text: `{${scope}.${direction}.bytes}` },
    { id: `${prefix}-${direction}-remaining`, type: 'element', tag: 'span', text: `{${scope}.${direction}.remaining}`, css: { color: 'var(--tt-muted, #71717a)' } }
   ] },
   { id: `${prefix}-${direction}-operations`, type: 'element', tag: 'p', text: `{${scope}.${direction}.operations}`, css: { 'font-size': '11px', color: 'var(--tt-muted, #71717a)' } },
   { id: `${prefix}-${direction}-bar`, type: 'element', tag: 'div', props: { role: 'meter', 'aria-label': `{${scope}.${direction}.title}`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': `{${scope}.${direction}.percent}`, hidden: `{${scope}.${direction}.unknown}`, 'aria-hidden': `{${scope}.${direction}.unknown}` }, css: { height: '5px', background: 'var(--tt-border, #dedee5)', 'border-radius': '4px', overflow: 'hidden' }, children: [{ id: `${prefix}-${direction}-fill`, type: 'element', tag: 'div', props: { 'aria-hidden': true, style: { width: `{${scope}.${direction}.percent}%` } }, css: { height: '100%', background: 'var(--tt-accent, #7864d9)' } }] }
  ]
 })) }];
}
