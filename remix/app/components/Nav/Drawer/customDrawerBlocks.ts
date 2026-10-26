import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
const fieldCss = { width: '100%', 'min-width': '0', 'box-sizing': 'border-box', padding: '9px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', background: 'var(--tt-surface, white)', color: 'inherit', font: 'inherit' };
const rowCss = { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center', 'min-width': '0', 'max-width': '100%', 'box-sizing': 'border-box' };
const stackCss = { display: 'flex', 'flex-direction': 'column', gap: '12px', 'min-width': '0' };
const el = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock => ({ id, type: 'element', tag, text, props, ...(children ? { children } : {}), ...(css ? { css } : {}) });
const action = (operation: string, inputs: Record<string, unknown> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const button = (id: string, title: string, operation: string, inputs = {}) => el(id, 'button', '', { type: 'button', disabled: '{drawer.saving}', ...action(operation, inputs) }, [el(`${id}-label`, 'span', title)], { ...fieldCss, width: 'auto', 'max-width': '100%', 'overflow-wrap': 'anywhere', 'white-space': 'normal', cursor: 'pointer', 'min-height': '44px' });
const repeat = (id: string, path: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'collection', props: { itemsPath: path, size: 'all', transparent: true }, children });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg }, children });
const field = (name: string, title: string, props = {}) => el(`${name}-field`, 'label', '', {}, [el(`${name}-label`, 'span', title), el(name, 'input', '', { name, 'aria-label': title, disabled: '{drawer.saving}', autoComplete: 'off', ...props }, undefined, fieldCss)], stackCss);
const row = (id: string, children: WebpageBlock[]) => el(id, 'div', '', {}, children, rowCss);

/** Editable templates: nested labels, controls, result fields and repeated rows remain ordinary blocks. */
export const customDrawerBlocks = (settings: boolean): WebpageBlock[] => [el('custom-drawer-root', 'section', '', { 'aria-label': 'Custom drawer items' }, [
 ...(settings ? [el('custom-drawer-heading', 'h3', 'Custom drawer items'), el('custom-drawer-description', 'p', 'Add links or attach Things. Items are saved for this account on this device. Signed-in menu templates save privately to the account; otherwise layouts stay on this device.')] : []),
 repeat('custom-drawer-items', 'drawer.items', [row('custom-drawer-row', [
  el('custom-drawer-link', 'a', '', { className: 'tt-drawer-row', href: '{item.url}', title: '{item.tooltip}', ...action('drawer.navigate', { id: '{item.id}' }) }, [el('custom-drawer-icon', 'span', '{item.emoji}', { 'aria-hidden': true, className: 'tt-drawer-row-icon' }, undefined, { 'flex-shrink': '0' }), el('custom-drawer-title', 'span', '{item.title}', { className: 'tt-drawer-row-label' }, undefined, { 'min-width': '0', 'max-width': '100%', 'overflow-wrap': 'anywhere', 'word-break': 'break-word' })], undefined),
  ...(settings ? [button('custom-drawer-edit', 'Edit', 'drawer.edit', { id: '{item.id}' }), button('custom-drawer-remove', 'Remove', 'drawer.remove', { id: '{item.id}' }),
   el('custom-close-label', 'label', '', {}, [el('custom-close', 'input', '', { type: 'checkbox', 'aria-label': 'Close drawer after click', disabled: '{drawer.saving}', checked: '{item.closes}', ...action('drawer.close-setting', { id: '{item.id}' }) }), el('custom-close-text', 'span', 'Close after click')])] : [])
 ])]),
 el('custom-drawer-add', 'button', '', { type: 'button', className: 'tt-drawer-row', disabled: '{drawer.saving}', ...action('drawer.add') }, [el('custom-drawer-add-icon', 'span', '➕', { className: 'tt-drawer-row-icon', 'aria-hidden': true }), el('custom-drawer-add-label', 'span', 'Add +', { className: 'tt-drawer-row-label' })]),
 when('drawer-saving', 'drawer.saving', [el('drawer-saving-status', 'p', 'Saving drawer items…', { role: 'status' })]),
 when('drawer-management-error', 'drawer.managementError', [el('drawer-management-error-text', 'p', '{drawer.managementError}', { role: 'alert' })]),
 el('custom-drawer-dialog', 'dialog', '', { 'aria-label': 'Custom drawer item', ...action('drawer.cancel', { open: '{drawer.open}' }) }, [
 el('custom-drawer-form', 'fieldset', '', {}, [
  el('custom-drawer-dialog-title', 'legend', '{drawer.heading}'),
  field('drawer-emoji', 'Emoji', { value: '{drawer.draft.emoji}' }),
  field('drawer-title', 'Title', { value: '{drawer.draft.title}' }),
  field('drawer-tooltip', 'Hover tooltip', { value: '{drawer.draft.tooltip}' }),
  field('drawer-url', 'URL (relative or https://)', { value: '{drawer.draft.url}' }),
  el('drawer-attached', 'p', '{drawer.attached}', { role: 'status' }),
  field('drawer-query', 'Commander: search Things', { value: '{drawer.query}', ...action('drawer.search') }),
  when('drawer-search-status-present', 'drawer.searchMessage', [el('drawer-search-status', 'p', '{drawer.searchMessage}', { role: 'status' })]),
  repeat('drawer-results', 'drawer.results', [button('drawer-result', '{item.icon} {item.title}', 'drawer.attach', { id: '{item.id}' })]),
  when('drawer-more-present', 'drawer.hasMore', [button('drawer-more', 'More Things', 'drawer.more')]),
  when('drawer-error-present', 'drawer.error', [el('drawer-error', 'p', '{drawer.error}', { role: 'alert' })]),
  when('drawer-dialog-saving', 'drawer.saving', [el('drawer-dialog-saving-status', 'p', 'Saving item…', { role: 'status' })]),
  row('drawer-dialog-actions', [button('drawer-save', 'Save item', 'drawer.save'), button('drawer-cancel', 'Cancel', 'drawer.cancel')])
 ], { ...stackCss, border: '0', margin: '0', padding: '0' })
 ], { width: 'min(460px, calc(100vw - 32px))', 'max-height': 'calc(100dvh - 32px)', 'overflow-y': 'auto', 'box-sizing': 'border-box', margin: 'auto', padding: '20px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', background: 'var(--tt-surface, white)', color: 'var(--tt-ink, #222)' })
], settings ? stackCss : { ...stackCss, gap: '0', 'box-sizing': 'border-box' })];
