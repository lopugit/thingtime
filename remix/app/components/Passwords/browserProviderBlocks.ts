import type { WebpageBlock } from '../Builder/webpageBlocks';
const e = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[]): WebpageBlock => ({
  id: `bp-${id}`, type: 'element', tag, text, props, children,
  css: { 'min-width': '0', 'overflow-wrap': 'anywhere', 'line-height': '1.5', ...(tag === 'h1' ? { 'font-size': '28px', 'font-weight': '600', 'line-height': '1.2' } : {}), ...(tag === 'section' ? { display: 'flex', 'flex-direction': 'column', gap: '12px' } : {}), ...(tag === 'button' || tag === 'input' || tag === 'select' ? { padding: '12px', 'min-height': '44px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', background: id === 'approve' ? '#18181b' : 'var(--tt-card, white)', color: id === 'approve' ? '#fff' : 'inherit', font: 'inherit' } : {}) },
} as WebpageBlock);
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id: `bp-${id}`, type: 'condition', condition: { arg, equals: true }, children } as WebpageBlock);
const button = (id: string, text: string, operation: string) => e(id, 'button', text, { type: 'button', disabled: '{result.busy}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
/** Every visible field is an editable block; secrets stay solely in transient DOM fields. */
export const BROWSER_PROVIDER_BLOCKS: WebpageBlock[] = [e('main', 'section', '', { 'aria-label': 'Passkey approval' }, [
  e('heading', 'h1', '{result.title}'),
  e('intro', 'p', 'Review the website and account before continuing.'),
  e('site-label', 'strong', 'Requesting website'), e('site', 'p', '{result.origin}'),
  e('rp-label', 'strong', 'Passkey domain'), e('rp', 'p', '{result.rp}'),
  when('create', 'result.creating', [e('account-label', 'strong', 'Website account'), e('account', 'p', '{result.account}')]),
  when('choose', 'result.choosing', [e('select-label', 'label', 'Saved passkey', { htmlFor: 'browser-passkey-choice' }),
    e('select', 'select', '', { id: 'browser-passkey-choice', name: 'credential', 'aria-label': 'Saved passkey', disabled: '{result.busy}' }, [
      { id: 'bp-choices', type: 'collection', props: { itemsPath: 'result.choices', size: 'all', transparent: true }, children: [e('option', 'option', '{item.title} · {item.username}', { value: '{item.id}' })] } as unknown as WebpageBlock,
    ])]),
  when('empty', 'result.empty', [e('empty-text', 'p', 'No matching passkey is saved in this Thingtime account. You can use another provider below.')]),
  when('ready', 'result.canApprove', [
    e('password-label', 'label', 'Verify with your Thingtime account password', { htmlFor: 'browser-passkey-password' }),
    e('password', 'input', '', { id: 'browser-passkey-password', name: 'password', type: 'password', autoComplete: 'current-password', disabled: '{result.busy}', 'aria-label': 'Thingtime account password' }),
    e('privacy', 'p', 'Your password stays with Thingtime. Only the completed passkey response returns to the requesting website.'),
    button('approve', '{result.approveLabel}', 'provider.approve'),
  ]),
  when('busy', 'result.busy', [e('busy-text', 'p', 'Verifying and completing your request…', { role: 'status' })]),
  when('error', 'result.hasError', [e('error-text', 'p', '{result.error}', { role: 'alert' })]),
  button('retry', 'Refresh saved passkeys', 'provider.refresh'),
  button('fallback', 'Use another passkey provider', 'provider.fallback'),
  button('cancel', 'Cancel', 'provider.cancel'),
])];
