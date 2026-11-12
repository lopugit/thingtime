import { VERIFICATION_WINDOWS } from '~/passwords/verificationPolicy';
import { passwordBrandingMigration } from './passwordBrandingBlocks';
import type { WebpageBlock } from '../Builder/webpageBlocks';
const e = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[]): WebpageBlock => ({
  id: `bp-${id}`, type: 'element', tag, text, props, children,
  css: { 'min-width': '0', 'overflow-wrap': 'anywhere', 'line-height': '1.5', ...(tag === 'h1' ? { 'font-size': '28px', 'font-weight': '600', 'line-height': '1.2' } : {}), ...(tag === 'section' ? { display: 'flex', 'flex-direction': 'column', gap: '12px' } : {}), ...(tag === 'button' || tag === 'input' || tag === 'select' ? { padding: '12px', 'min-height': '44px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', background: id === 'approve' ? '#18181b' : 'var(--tt-card, white)', color: id === 'approve' ? '#fff' : 'inherit', font: 'inherit' } : {}) },
} as WebpageBlock);
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id: `bp-${id}`, type: 'condition', condition: { arg, equals: true }, children } as WebpageBlock);
const button = (id: string, text: string, operation: string, disabled: string | boolean = '{result.busy}') => e(id, 'button', text, { type: 'button', disabled, 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
/** Every visible field is an editable block; secrets stay solely in transient DOM fields. */
const migrateBranding = passwordBrandingMigration('bp-heading');
/** Add terminal-state policy around existing controls without restoring deleted
 * controls or replacing authored text/styles/inputs. Repeated migration is inert. */
export function migrateBrowserProviderRecoveryControls(blocks: WebpageBlock[]): WebpageBlock[] {
  const used = new Set<string>();
  const collect = (items: WebpageBlock[]) => { for (const block of items) { used.add(block.id); if (block.children) collect(block.children); } };
  collect(blocks);
  const wrapperID = (base: string) => { let id = base, n = 1; while (used.has(id)) id = `${base}-${++n}`; used.add(id); return id; };
  const visit = (items: WebpageBlock[], guarded: Set<string>): WebpageBlock[] => items.map(original => {
    const active = new Set(guarded);
    const condition = original.type === 'condition' ? original.condition : undefined;
    if (condition?.equals === true && typeof condition.arg === 'string') active.add(condition.arg);
    let block = original.children ? { ...original, children: visit(original.children, active) } : original;
    if (block.id === 'bp-cancel' && block.type === 'element' && block.tag === 'button') {
      if (block.text === 'Cancel') block = { ...block, text: '{result.cancelLabel}' };
      const inputs = block.props?.['data-tt-action-inputs'];
      if (block.props?.disabled === '{result.busy}' && block.props['data-tt-action'] === '$transient' &&
        inputs && typeof inputs === 'object' && 'operation' in inputs && inputs.operation === 'provider.cancel')
        block = { ...block, props: { ...block.props, disabled: false } };
    }
    const arg = block.id === 'bp-retry' ? 'result.canRefresh' : block.id === 'bp-fallback' ? 'result.canChooseProvider' : null;
    return arg && !active.has(arg)
      ? { id: wrapperID(block.id + '-registration-policy'), type: 'condition', condition: { arg, equals: true }, children: [block] } as WebpageBlock
      : block;
  });
  return visit(blocks, new Set());
}
export function migrateBrowserProviderVerification(blocks:WebpageBlock[]):WebpageBlock[] {
  const exists = (items:WebpageBlock[]):boolean=>items.some(block=>block.id==='bp-verification-policy'||(block.children&&exists(block.children)));
  if(exists(blocks))return blocks;
  const visit=(items:WebpageBlock[]):WebpageBlock[]=>items.flatMap(block=>{
    let current=block.children?{...block,children:visit(block.children)}:block;
    if(['bp-password-label','bp-password'].includes(block.id))current=when(block.id+'-required','result.needsPassword',[current]);
    return block.id==='bp-approve'?[e('verification-policy','section','',{},[
      e('verification-label','label','Don’t ask for my Thingtime password for',{htmlFor:'browser-passkey-window'}),
      e('verification-window','select','',{id:'browser-passkey-window',name:'verificationWindow',value:'{result.window}','data-tt-action':'$transient','data-tt-action-inputs':{operation:'provider.window'},disabled:'{result.busy}','aria-label':'Password confirmation interval'},VERIFICATION_WINDOWS.map(([id,label])=>e('window-'+id,'option',label,{value:id}))),
      e('verification-help','p','{result.verificationHelp}'),
    ]),current]:[current];
  });
  return visit(blocks);
}
export const migrateBrowserProviderBranding = (blocks: WebpageBlock[]) => migrateBrowserProviderVerification(migrateBrowserProviderRecoveryControls(migrateBranding(blocks)));
const BROWSER_PROVIDER_BLOCKS_DEFAULTS: WebpageBlock[] = [e('main', 'section', '', { 'aria-label': 'Passkey approval' }, [
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
  when('can-refresh', 'result.canRefresh', [button('retry', 'Refresh saved passkeys', 'provider.refresh', '{result.refreshDisabled}')]),
  when('other-provider', 'result.canChooseProvider', [button('fallback', 'Use another passkey provider', 'provider.fallback')]),
  button('cancel', '{result.cancelLabel}', 'provider.cancel', false),
])];
export const BROWSER_PROVIDER_BLOCKS = migrateBrowserProviderBranding(BROWSER_PROVIDER_BLOCKS_DEFAULTS);
