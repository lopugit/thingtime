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
    button('open', 'Set up passkeys', 'passkey.open', { 'aria-expanded': '{result.open}', 'aria-controls': 'password-passkey-instructions' }),
    when('expanded', 'result.open', [
      element('instructions', 'div', '', { id: 'password-passkey-instructions' }, [
        paragraph('ceremony', 'Start on the website where you want to create a passkey. Thingtime saves it after you review the website and verify your account.'),
        paragraph('native-first', 'On macOS, use Thingtime through system Password AutoFill first. Connect your account in the Mac app and enable Thingtime in AutoFill & Passwords. Chrome can use the native provider without the Thingtime browser extension.'),
        when('extension', 'result.extensionAvailable', [
          paragraph('extension-status', '{result.extensionStatus}'),
          button('extension-settings', 'Browser extension settings', 'passkey.extension'),
        ]),
        when('extension-install', 'result.extensionMissing', [
          paragraph('browser-setup', 'For browser-only use on compatible Chromium browsers, the optional Thingtime extension opens your vault’s approval page. It carries the website’s passkey request and response; it does not connect to the native app.'),
          element('extension-download', 'a', 'Download browser extension', { href: '/downloads/thingtime-passwords-extension.zip', download: 'thingtime-passwords-extension.zip' }),
          paragraph('install-steps', 'Unzip the download. Open your browser’s extensions page, enable Developer mode, choose Load unpacked, and select the extracted folder. Open Thingtime from the extensions menu, check the Thingtime origin, and enable passkeys.'),
          paragraph('browser-limits', 'This is an unpacked extension, not a browser store release. Safari, Firefox and mobile browsers need their supported credential provider; this Chromium extension does not install in those browsers. The password library remains available in the web app.'),
        ]),
        when('native', 'result.nativeAvailable', [
          paragraph('native-instructions', 'Connect your Thingtime account to Password AutoFill, then enable Thingtime in your device’s AutoFill & Passwords settings.'),
        ]),
        when('web', 'result.webOnly', [
          paragraph('web-instructions', 'Browser passkeys do not need the Mac app. The extension opens Thingtime for approval and then returns the result to the requesting tab. Without an extension or system provider, a web page cannot create passkeys for another website.'),
        ]),
        element('steps', 'ol', '', {}, [
          element('step-site', 'li', 'Open the account’s security settings on the website or app where you want a passkey.'),
          element('step-create', 'li', 'Choose its Create passkey or Add passkey option, then choose Thingtime in the system provider flow. The optional browser adapter opens a separate approval tab when explicitly enabled.'),
          element('step-verify', 'li', 'Check the requesting website and account, then verify with your Thingtime account password in the browser or your device through the system provider. Finish registration on the website.'),
        ], { 'padding-left': '24px', 'line-height': '1.7', 'overflow-wrap': 'anywhere' }),
        paragraph('availability', 'For sign-in, Thingtime is offered when it has a passkey matching the website’s relying-party identifier and allowed credentials. An enabled provider alone does not create that passkey. Other password-manager extensions can intercept browser prompts; turn off their passkey offers if you want the native flow. Provider order is controlled by the system and browser.'),
        when('pending', 'result.busy', [paragraph('pending-message', 'Connecting Password AutoFill…', { role: 'status' })]),
        when('notice', 'result.hasNotice', [paragraph('notice-message', '{result.notice}', { role: 'status' })]),
        button('close', 'Close passkey guide', 'passkey.close', { disabled: '{result.busy}' }),
      ]),
    ]),
  ], { border: '1px solid var(--tt-border, #e6e6eb)', 'border-radius': '12px', padding: '16px', 'font-size': '14px', background: 'var(--tt-card, white)', 'min-width': '0' }),
];

const LEGACY_PASSKEY_TEXT: Record<string, { tag: string; text: string }> = {
  'password-passkey-open': { tag: 'button', text: 'Create a passkey' },
  'password-passkey-ceremony': { tag: 'p', text: 'Passkeys are created for a specific account during the website’s registration request. Opening this guide does not create a passkey.' },
  'password-passkey-web-instructions': { tag: 'p', text: 'To save passkeys in Thingtime, open Passwords in the native Thingtime app, connect Password AutoFill, and enable the Thingtime provider in your device settings. This browser page cannot register Thingtime as your system provider.' },
  'password-passkey-step-create': { tag: 'li', text: 'Choose its Create passkey or Add passkey option, then select Thingtime as the credential provider when offered.' },
  'password-passkey-step-verify': { tag: 'li', text: 'Verify with your device and finish the website’s registration. Return to Passwords and refresh to see the saved entry.' },
  'password-passkey-availability': { tag: 'p', text: 'If Thingtime is not offered, check that the signed native provider is installed, connected and enabled. Provider availability depends on your device and browser.' },
};
const PRE_NATIVE_FIRST_TEXT: Record<string, { tag: string; text: string }> = {
  "password-passkey-browser-setup": {
    "tag": "p",
    "text": "On desktop Chrome and compatible Chromium browsers, install the Thingtime Passwords extension and enable it. Your passwords and passkeys stay in your Thingtime vault; the extension carries only the website’s passkey request and response."
  },
  "password-passkey-install-steps": {
    "tag": "p",
    "text": "Unzip the download. Open your browser’s extensions page, enable Developer mode, choose Load unpacked, and select the extracted folder. Open Thingtime Passwords from the extensions menu, check the Thingtime origin, and enable passkeys."
  },
  "password-passkey-step-create": {
    "tag": "li",
    "text": "Choose its Create passkey or Add passkey option. With the browser extension enabled, Thingtime opens an approval tab; with a system provider, choose Thingtime when offered."
  },
  "password-passkey-availability": {
    "tag": "p",
    "text": "You can choose another passkey provider or cancel at approval. Unsupported browser requests use your browser’s normal flow. Accounts without a Thingtime password need to set one before using this browser provider."
  }
};
const passkeyNodes = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block,
  ...passkeyNodes(block.children || []),
]);

/** Upgrade only recognizable old defaults; authored content and layout stay intact.
 * Legacy text is also the one-time marker, so deleting new setup blocks after an
 * upgrade remains an intentional author edit rather than triggering reinsertion. */
export function migratePasswordPasskeyBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
  // The connection control now lives in its own editable shared document. Retire
  // its legacy action wherever moved, while preserving every other authored node.
  const retireConnection = (items: WebpageBlock[]): WebpageBlock[] => items.flatMap(block => {
    const inputs = block.props?.['data-tt-action-inputs'];
    if (inputs && typeof inputs === 'object' && 'operation' in inputs && inputs.operation === 'passkey.connect') return [];
    if (!block.children) return [block];
    const children = retireConnection(block.children);
    return [children.every((child, index) => child === block.children![index]) && children.length === block.children.length ? block : { ...block, children }];
  });
  const cleaned = retireConnection(blocks);
  if (cleaned.some((block, index) => block !== blocks[index]) || cleaned.length !== blocks.length) blocks = cleaned;
  const nodes = passkeyNodes(blocks);
  const matchesLegacy = (block: WebpageBlock) => {
    return [LEGACY_PASSKEY_TEXT[block.id], PRE_NATIVE_FIRST_TEXT[block.id]].some(legacy =>
      legacy && block.type === 'element' && block.tag === legacy.tag && block.text === legacy.text);
  };
  if (!nodes.some(matchesLegacy)) return blocks;
  const defaults = new Map(passkeyNodes(PASSWORD_PASSKEY_BLOCKS).map(block => [block.id, block]));
  const ids = new Set(nodes.map(block => block.id));
  const additions = ['password-passkey-native-first', 'password-passkey-extension', 'password-passkey-extension-install']
    .map(id => defaults.get(id)!)
    .filter(block => !passkeyNodes([block]).some(child => ids.has(child.id)));
  const visit = (items: WebpageBlock[]): WebpageBlock[] => items.map(block => {
    let next = matchesLegacy(block) ? { ...block, text: defaults.get(block.id)!.text } : block;
    if (block.children) next = { ...next, children: visit(block.children) };
    if (block.id === 'password-passkey-instructions' && block.type === 'element' && block.tag === 'div' && block.children && additions.length) {
      const children = [...next.children!];
      const ceremony = children.findIndex(child => child.id === 'password-passkey-ceremony');
      children.splice(ceremony < 0 ? children.length : ceremony + 1, 0, ...structuredClone(additions));
      next = { ...next, children };
    }
    return next;
  });
  return visit(blocks);
}
