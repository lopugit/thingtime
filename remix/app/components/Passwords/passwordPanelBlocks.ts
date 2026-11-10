import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { SavedPasswordFile } from '~/passwords/files.client';

const stack = { display: 'grid', gap: '12px', 'min-width': '0' };
const row = { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center', 'min-width': '0' };
const control = { padding: '8px 12px', 'min-height': '44px', 'min-width': '0', 'max-width': '100%', 'box-sizing': 'border-box', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', background: 'var(--tt-surface, white)', color: 'inherit', font: 'inherit' };
const el = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock => ({ id, type: 'element', tag, text, props, ...(children ? { children } : {}), ...(css ? { css } : {}) });
const text = (id: string, value: string, tag = 'p') => el(id, tag, value, {}, undefined, { margin: '0', 'overflow-wrap': 'anywhere', ...(['h1', 'h2', 'h3'].includes(tag) ? { 'font-size': tag === 'h1' ? '30px' : tag === 'h2' ? '22px' : '17px', 'font-weight': '650', 'line-height': '1.25' } : {}) });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg }, children });
const repeat = (id: string, itemsPath: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'collection', props: { itemsPath, size: 'all', transparent: true }, children });
const action = (operation: string, inputs: Record<string, unknown> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const button = (id: string, label: string, operation: string, inputs: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => el(id, 'button', '', { type: 'button', ...action(operation, inputs), ...props }, [text(`${id}-label`, label, 'span')], control);
const privateField = (id: string, label: string, name: string, props: Record<string, unknown> = {}, multiline = false) => el(`${id}-field`, 'label', '', {}, [
  text(`${id}-label`, label, 'span'), el(id, multiline ? 'textarea' : 'input', '', { name, readOnly: true, 'data-tt-private-control': '', ...(multiline ? { rows: 8 } : { type: 'text' }), ...props }, undefined, { ...control, width: '100%', ...(multiline ? { resize: 'vertical' } : {}) })
], stack);

export const passwordAttachmentBlocks: WebpageBlock[] = [el('password-attachments', 'section', '', {}, [
  text('attachment-heading', '{files.heading}', 'h3'),
  when('attachment-upload-visible', 'files.writable', [el('attachment-picker-label', 'label', '', {}, [
    text('attachment-picker-text', 'Add attachment', 'span'), el('attachment-picker', 'input', '', { type: 'file', name: 'attachment', disabled: '{files.busy}', 'aria-label': 'Add password attachment', ...action('files.choose') }, undefined, { ...control, width: '100%' })
  ], stack)]),
  when('attachment-busy-visible', 'files.busy', [text('attachment-progress', 'Working with encrypted attachment…')]),
  repeat('attachment-list', 'files.items', [el('attachment-card', 'div', '', {}, [
    text('attachment-name', '{item.name}', 'span'), text('attachment-size', '{item.size} bytes', 'span'),
    button('attachment-download', 'Download', 'files.download', { id: '{item.id}' }, { disabled: '{files.busy}' }),
    when('attachment-remove-visible', 'files.writable', [button('attachment-remove', 'Remove', 'files.remove', { id: '{item.id}' }, { disabled: '{files.busy}' })])
  ], { ...row, 'padding-block': '4px', 'overflow-wrap': 'anywhere' })]),
  when('attachment-all-visible', 'files.canToggle', [button('attachment-show-all', '{files.toggleLabel}', 'files.toggle', {}, { disabled: '{files.busy}' })]),
  when('attachment-error-visible', 'files.error', [el('attachment-error', 'p', '{files.error}', { role: 'alert' }, undefined, { color: 'var(--tt-danger, #b42318)', margin: '0' })]),
  when('attachment-retry-visible', 'files.canRetry', [button('attachment-retry', 'Retry attachment', 'files.retry', {}, { disabled: '{files.busy}' })])
], { ...stack, 'max-width': '1100px', margin: '20px auto 0', padding: '0 16px', 'box-sizing': 'border-box' })];

/** Never expose the encrypted-file key/nonce or arbitrary future API fields. */
export const passwordAttachmentItems = (files: SavedPasswordFile[]) => files.map(file => ({ id: file.id, name: file.metadata.archivePath || file.metadata.name, size: file.metadata.size.toLocaleString() }));

export const passwordSourceBlocks: WebpageBlock[] = [el('password-source', 'section', '', {}, [
  when('source-account-visible', 'source.hasAccount', [privateField('source-account', 'Source account', 'sourceAccount')]),
  when('source-vault-visible', 'source.hasVault', [privateField('source-vault', 'Source vault', 'sourceVault')]),
  when('source-history-visible', 'source.hasHistory', [el('source-history', 'details', '', {}, [
    el('source-history-summary', 'summary', '', {}, [text('source-history-heading', 'Password history ({source.historyCount})', 'span')], { 'min-height': '44px' }),
    repeat('source-history-items', 'source.history', [el('source-history-card', 'div', '', {}, [
      privateField('source-history-time', 'Saved at', '{item.labelName}'),
      privateField('source-history-value', 'Previous password', '{item.valueName}', { type: '{item.inputType}' }),
      button('source-history-reveal', '{item.revealLabel}', 'source.history', { index: '{item.index}' })
    ], stack)])
  ])]),
  el('source-original', 'details', '', {}, [
    el('source-original-summary', 'summary', '', {}, [text('source-original-heading', 'Original item data', 'span')], { 'min-height': '44px' }),
    text('source-original-about', 'Original properties, field definitions, relationships, dates, and unknown data are retained encrypted.'),
    button('source-item-reveal', '{source.itemRevealLabel}', 'source.item'),
    when('source-item-visible', 'source.showItem', [privateField('source-item-value', 'Original 1Password item', 'sourceItem', {}, true)]),
    button('source-context-reveal', '{source.contextRevealLabel}', 'source.context'),
    when('source-context-visible', 'source.showContext', [privateField('source-context-value', 'Original account and vault', 'sourceContext', {}, true)])
  ], stack)
], { ...stack, 'max-width': '1100px', margin: '20px auto 0', padding: '0 16px', 'box-sizing': 'border-box' })];
