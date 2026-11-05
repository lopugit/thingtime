import type { WebpageBlock } from '../Builder/webpageBlocks';
const action = (operation: string, inputs: Record<string, string> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': JSON.stringify({ operation, ...inputs }) });
// Supporting copy is still readable text, not the faint decorative-label token.
const muted = 'var(--tt-text, #5a5a66)';
const buttonCss = { 'min-height': '44px', padding: '11px 14px', 'border-width': '1px', 'border-style': 'solid', 'border-radius': 'var(--tt-radius-sm, 10px)', cursor: 'pointer', color: 'inherit' };
const text = (id: string, tag: string, value: string, css = {}): WebpageBlock => ({ id, type: 'element', tag, text: value, css: { margin: '0', 'overflow-wrap': 'anywhere', ...css } });
const choices = (kind: 'templates' | 'layouts', label: string): WebpageBlock => ({ id: `share-${kind}-section`, type: 'element', tag: 'section', css: { display: 'grid', gap: '10px' }, children: [
 text(`share-${kind}-label`, 'h3', label, { 'font-size': '14px', 'font-weight': '650' }),
 { id: `share-${kind}`, type: 'collection', props: { itemsPath: `share.${kind}`, label, hideSearch: true, hideSize: true, hideCount: true, size: 'all' }, children: [
  { id: `share-${kind}-choice`, type: 'element', tag: 'button', props: { type: 'button', 'aria-pressed': '{item.selected}', 'aria-label': '{item.label}', style: { borderColor: '{item.border}', background: '{item.background}' }, ...action(kind, { id: '{item.id}' }) }, css: { ...buttonCss, display: 'grid', gap: '4px', width: '100%', 'text-align': 'left', 'margin-bottom': '8px' }, children: [
   ...(kind === 'templates' ? [{ id: 'share-theme-swatch', type: 'element' as const, tag: 'span', props: { 'aria-hidden': true, style: { background: '{item.swatch}' } }, css: { display: 'block', height: '22px', 'border-radius': '5px', 'margin-bottom': '4px', border: '1px solid var(--tt-border, #e8e6ec)' } }] : []),
   text(`share-${kind}-name`, 'strong', '{item.label}', { 'font-size': '14px' }), text(`share-${kind}-description`, 'span', '{item.description}', { 'font-size': '12px', color: muted, 'line-height': '1.45' })
  ] }
 ] }
] });
/** Ordinary editable blocks; the adapter supplies only anonymous metadata and
 * short-lived selection/copy authority. No private content enters the layout. */
export const sharePreviewBlocks: WebpageBlock[] = [{ id: 'share-preview-document', type: 'element', tag: 'section', props: { id: 'share-preview-document' }, css: { display: 'grid', gap: '24px', 'min-width': '0' }, children: [
 { id: 'share-intro', type: 'element', tag: 'header', css: { display: 'grid', gap: '8px', 'padding-right': '20px' }, children: [text('share-eyebrow', 'p', 'MAKE IT YOURS', { color: muted, 'font-size': '11px', 'letter-spacing': '.12em', 'font-weight': '650' }), text('share-heading', 'h2', 'Share link & customise preview', { 'font-size': '24px', 'line-height': '1.2', 'font-weight': '700', 'letter-spacing': '-.035em' }), text('share-intro-copy', 'p', 'Choose the first impression. Your link’s content fills the card automatically.', { color: muted, 'font-size': '14px', 'line-height': '1.6' })] },
 { id: 'share-workspace', type: 'element', tag: 'div', props: { className: 'share-preview-workspace' }, css: { display: 'grid', gap: '24px', 'min-width': '0' }, children: [
  { id: 'share-preview-column', type: 'element', tag: 'section', props: { 'aria-label': 'Link preview' }, css: { display: 'grid', 'align-content': 'start', gap: '14px', 'min-width': '0' }, children: [
   { id: 'share-image-frame', type: 'element', tag: 'div', props: { 'aria-busy': '{share.busy}' }, css: { 'aspect-ratio': '1200 / 630', 'border-radius': '14px', overflow: 'hidden', border: '1px solid var(--tt-border, #e8e6ec)', background: 'var(--tt-surface-alt, #f5f5f7)' }, children: [
    { id: 'share-image', type: 'element', tag: 'img', props: { src: '{share.image}', alt: '{share.alt}', referrerPolicy: 'no-referrer', style: { display: '{share.imageDisplay}' } }, css: { width: '100%', height: '100%', 'object-fit': 'contain' } }
   ] },
   text('share-content-title', 'h3', '{share.title}', { 'font-size': '18px', 'font-weight': '650', 'line-height': '1.35' }),
   text('share-content-description', 'p', '{share.description}', { color: muted, 'font-size': '14px', 'line-height': '1.6' }),
   text('share-privacy', 'p', '{share.privacy}', { color: muted, 'font-size': '12px', 'line-height': '1.5' }),
   { id: 'share-progress', type: 'element', tag: 'div', css: { display: 'flex', 'align-items': 'center', gap: '8px', 'min-height': '22px' }, children: [
    { id: 'share-progress-icon', type: 'element', tag: 'span', props: { className: 'share-preview-spinner', 'aria-hidden': true, style: { display: '{share.spinnerDisplay}' } }, css: { width: '12px', height: '12px', border: '2px solid var(--tt-border, #ddd)', 'border-top-color': 'var(--tt-accent, #ba256b)', 'border-radius': '50%' } },
    { ...text('share-status', 'p', '{share.status}', { color: muted, 'font-size': '12px' }), props: { role: 'status', 'aria-live': 'polite' } },
    { id: 'share-retry', type: 'element', tag: 'button', text: 'Retry', props: { type: 'button', style: { display: '{share.retryDisplay}' }, ...action('retry') }, css: { ...buttonCss, 'min-height': '44px', padding: '6px 12px' } }
   ] }
  ] },
  { id: 'share-design-column', type: 'element', tag: 'section', props: { 'aria-label': 'Preview design' }, css: { display: 'grid', gap: '18px', 'align-content': 'start', 'min-width': '0' }, children: [choices('templates', 'Design theme'), choices('layouts', 'Card layout')] }
 ] },
 { id: 'share-footer', type: 'element', tag: 'footer', css: { display: 'grid', gap: '14px', 'border-top': '1px solid var(--tt-border, #e8e6ec)', 'padding-top': '20px' }, children: [
  { id: 'share-link-label', type: 'element', tag: 'label', text: 'Your customised link', props: { htmlFor: 'share-custom-link' }, css: { 'font-size': '12px', color: muted, 'font-weight': '600' } },
  { id: 'share-custom-link-block', type: 'element', tag: 'input', props: { id: 'share-custom-link', value: '{share.url}', readOnly: true, 'aria-label': 'Your customised link' }, css: { width: '100%', 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #e8e6ec)', 'border-radius': '10px', 'font-size': '13px', background: 'var(--tt-surface-alt, #f5f5f7)' } },
  { id: 'share-actions', type: 'element', tag: 'div', css: { display: 'flex', gap: '10px', 'flex-wrap': 'wrap', 'justify-content': 'flex-end' }, children: [
   { id: 'share-native', type: 'element', tag: 'button', text: 'Share…', props: { type: 'button', style: { display: '{share.nativeDisplay}' }, ...action('native') }, css: buttonCss },
   { id: 'share-copy', type: 'element', tag: 'button', text: 'Copy customised link', props: { type: 'button', ...action('copy') }, css: { ...buttonCss, background: 'var(--tt-ink, #28252f)', color: 'var(--tt-card, #fff)', 'font-weight': '600' } }
  ] }, text('share-crawler-note', 'p', 'Messaging apps may cache previews. Your choices travel with this link.', { color: muted, 'font-size': '12px', 'line-height': '1.5' })
 ] }
]}];
