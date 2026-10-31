import type { WebpageBlock } from '../Builder/webpageBlocks';

/** Editable presentation only; live connection state is transient. */
export const NATIVE_PASSWORD_CONNECTION_BLOCKS: WebpageBlock[] = [{
  id: 'password-native-connection', type: 'element', tag: 'section', props: { 'aria-label': 'Password AutoFill' },
  css: { 'min-width': '0', padding: '16px', border: '1px solid var(--tt-border, #e6e6eb)', 'border-radius': '12px', background: 'var(--tt-card, white)' },
  children: [
    { id: 'password-native-title', type: 'element', tag: 'h2', text: 'Password AutoFill', css: { margin: '0', 'font-size': '18px', 'font-weight': '600' } },
    { id: 'password-native-status', type: 'element', tag: 'p', text: '{result.status}', props: { role: 'status' }, css: { 'line-height': '1.6', 'overflow-wrap': 'anywhere' } },
    { id: 'password-native-action', type: 'element', tag: 'button', text: '{result.label}', props: { type: 'button', disabled: '{result.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'autofill.activate' } }, css: { padding: '10px 14px', 'min-height': '44px', 'max-width': '100%', 'white-space': 'normal', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', color: 'inherit', background: 'var(--tt-card, white)' } },
    { id: 'password-native-notice', type: 'condition', condition: { arg: 'result.hasNotice', equals: true }, children: [{ id: 'password-native-notice-text', type: 'element', tag: 'p', text: '{result.notice}', props: { role: 'status' }, css: { 'line-height': '1.6', 'overflow-wrap': 'anywhere' } }] },
  ],
}] as unknown as WebpageBlock[];
