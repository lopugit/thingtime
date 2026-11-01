import type { WebpageBlock } from '../Builder/webpageBlocks';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, css: Record<string, string> = {}): WebpageBlock =>
  ({ id: `password-settings-${id}`, type: 'element', tag, text, props, css } as unknown as WebpageBlock);

const action = (id: string, text: string, operation: string) => element(id, 'button', text,
  { type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } },
  { padding: '10px 14px', 'min-height': '44px', 'border-radius': '8px', border: '1px solid var(--tt-border, #ddd)', background: 'var(--tt-surface-alt, #f5f5f7)', color: 'inherit', cursor: 'pointer', 'white-space': 'normal', 'max-width': '100%' });

/** Editable presentation. Credential values and provider authority never enter layout data. */
export const PASSWORD_MANAGER_SETTINGS_BLOCKS: WebpageBlock[] = [
  element('title', 'h2', 'Password manager', {}, { margin: '0', 'font-size': '20px', 'font-weight': '600' }),
  element('description', 'p', 'Manage saved website and app credentials, import or export your vault, and set up passkey saving.', {}, { 'line-height': '1.6', 'overflow-wrap': 'anywhere' }),
  action('open', 'Open password manager', 'passwords.open'),
  element('account-title', 'h3', 'Signing in to Thingtime', {}, { 'margin-top': '24px', 'font-size': '16px', 'font-weight': '600' }),
  element('account-description', 'p', 'Passkeys used to sign in to your Thingtime account are managed separately in Security settings.', {}, { 'line-height': '1.6', 'overflow-wrap': 'anywhere' }),
  action('security', 'Manage Thingtime sign-in passkeys', 'passwords.security'),
];
