import type { WebpageBlock } from '../Builder/webpageBlocks';
const fieldCss = { padding: '8px 10px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', color: 'inherit', background: 'var(--tt-surface, white)', 'min-width': '0', 'box-sizing': 'border-box', font: 'inherit' };
const el = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock => ({ id, type: 'element', tag, ...(text ? { text } : {}), props, ...(children ? { children } : {}), ...(css ? { css } : {}) });
const text = (id: string, label: string) => el(id, 'span', label);
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const button = (id: string, label: string, operation: string, disabled = '{icon.busy}') => el(id, 'button', '', { type: 'button', disabled, ...action(operation) }, [text(`${id}-label`, label)], { ...fieldCss, cursor: 'pointer', 'min-height': '44px' });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg }, children });
/** Layout only: icon URLs and file contents never enter a saved document. */
export const passwordIconBlocks: WebpageBlock[] = [el('icon-fields', 'fieldset', '', {}, [
 el('icon-heading', 'legend', 'Entry icon'),
 el('icon-help', 'p', 'Upload an image, or choose an HTTPS URL. URL icons contact that website anonymously when displayed. Some sites block private loading; upload the image if that happens.'),
 el('icon-upload-label', 'label', '', {}, [text('icon-upload-text', 'Upload icon'), el('icon-upload', 'input', '', { type: 'file', name: 'icon-file', accept: '.png,.jpg,.jpeg,.webp,.gif,.ico', disabled: '{icon.cannotUpload}', 'aria-label': 'Upload entry icon', ...action('icon.upload') })], { display: 'grid', gap: '6px' }),
 when('icon-save-first', 'icon.unsaved', [el('icon-save-note', 'p', 'Save this entry once before uploading an encrypted icon.')]),
 button('icon-url-toggle', 'Use URL instead', 'icon.show-url'),
 when('icon-url-panel', 'icon.showUrl', [el('icon-url-label', 'label', '', {}, [text('icon-url-label-text', 'HTTPS icon URL'), el('icon-url', 'input', '', { type: 'url', name: 'icon-url', 'aria-label': 'HTTPS icon URL', autoComplete: 'off', spellCheck: false, disabled: '{icon.busy}', ...action('icon.type-url') }, undefined, { ...fieldCss, width: '100%' })], { display: 'grid', gap: '6px' }), button('icon-use-url', 'Use this icon URL', 'icon.use-url')]),
 button('icon-website', 'Use website favicon', 'icon.website', '{icon.cannotWebsite}'),
 button('icon-remove', 'Remove icon', 'icon.remove', '{icon.cannotRemove}'),
 when('icon-error', 'icon.error', [el('icon-error-message', 'p', '{icon.error}', { role: 'alert' })])
], { display: 'grid', gap: '10px', 'min-width': '0', margin: '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '10px' })];
