import type { WebpageBlock } from '../Builder/webpageBlocks';

const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock =>
  ({ id: `password-passkey-${id}`, type: 'element', tag, text, props, ...(children ? { children } : {}), ...(css ? { css } : {}) } as unknown as WebpageBlock);
const paragraph = (id: string, text: string, props: Record<string, unknown> = {}) => element(id, 'p', text, props, undefined,
  { margin: '8px 0', 'line-height': '1.6', 'overflow-wrap': 'anywhere' });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock =>
  ({ id: `password-passkey-${id}`, type: 'condition', condition: { arg, equals: true }, children } as unknown as WebpageBlock);
const button = (id: string, text: string, operation: string, props: Record<string, unknown> = {}) => element(id, 'button', text,
  { type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation }, ...props }, undefined,
  { padding: '10px 14px', 'min-height': '44px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', background: 'var(--tt-card, white)', color: 'inherit', cursor: 'pointer', 'white-space': 'normal' });

/** Editable presentation only. Provider authority and connection state never persist in these blocks. */
export const PASSWORD_PASSKEY_BLOCKS: WebpageBlock[] = [
  element('section', 'section', '', { 'aria-label': 'Create a passkey' }, [
    element('title', 'h2', 'Passkeys', {}, undefined, { margin: '0', 'font-size': '18px', 'font-weight': '600' }),
    paragraph('summary', 'Create and save passkeys with Thingtime when a website or app asks you to register one.'),
    button('open', 'Create a passkey', 'passkey.open', { 'aria-expanded': '{result.open}', 'aria-controls': 'password-passkey-instructions' }),
    when('expanded', 'result.open', [
      element('instructions', 'div', '', { id: 'password-passkey-instructions' }, [
        paragraph('ceremony', 'Passkeys are created for a specific account during the website’s registration request. Opening this guide does not create a passkey.'),
        when('native', 'result.nativeAvailable', [
          paragraph('native-instructions', 'Connect your Thingtime account to Password AutoFill, then enable Thingtime in your device’s AutoFill & Passwords settings.'),
          button('connect', 'Connect Password AutoFill', 'passkey.connect', { disabled: '{result.busy}' }),
        ]),
        when('web', 'result.webOnly', [
          paragraph('web-instructions', 'To save passkeys in Thingtime, open Passwords in the native Thingtime app, connect Password AutoFill, and enable the Thingtime provider in your device settings. This browser page cannot register Thingtime as your system provider.'),
        ]),
        element('steps', 'ol', '', {}, [
          element('step-site', 'li', 'Open the account’s security settings on the website or app where you want a passkey.'),
          element('step-create', 'li', 'Choose its Create passkey or Add passkey option, then select Thingtime as the credential provider when offered.'),
          element('step-verify', 'li', 'Verify with your device and finish the website’s registration. Return to Passwords and refresh to see the saved entry.'),
        ], { 'padding-left': '24px', 'line-height': '1.7', 'overflow-wrap': 'anywhere' }),
        paragraph('availability', 'If Thingtime is not offered, check that the signed native provider is installed, connected and enabled. Provider availability depends on your device and browser.'),
        when('pending', 'result.busy', [paragraph('pending-message', 'Connecting Password AutoFill…', { role: 'status' })]),
        when('notice', 'result.hasNotice', [paragraph('notice-message', '{result.notice}', { role: 'status' })]),
        button('close', 'Close passkey guide', 'passkey.close', { disabled: '{result.busy}' }),
      ]),
    ]),
  ], { border: '1px solid var(--tt-border, #e6e6eb)', 'border-radius': '12px', padding: '16px', 'font-size': '14px', background: 'var(--tt-card, white)', 'min-width': '0' }),
];
