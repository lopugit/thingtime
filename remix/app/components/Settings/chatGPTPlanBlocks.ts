import type { WebpageBlock } from '~/components/Builder/webpageBlocks';

const fieldCss = { width: '100%', 'min-width': '0', 'box-sizing': 'border-box', padding: '8px 10px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', background: 'var(--tt-surface, white)', color: 'inherit', font: 'inherit' };
const cardCss = { padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '10px', 'min-width': '0' };
const stackCss = { display: 'flex', 'flex-direction': 'column', gap: '12px', 'min-width': '0' };
const rowCss = { display: 'flex', 'flex-wrap': 'wrap', gap: '8px', 'align-items': 'center' };
const dialogCss = { ...cardCss, width: 'min(440px, calc(100vw - 32px))', 'max-height': 'calc(100dvh - 32px)', 'overflow-y': 'auto', 'box-sizing': 'border-box', margin: 'auto', background: 'var(--tt-surface, white)', color: 'var(--tt-ink, #222)' };
const el = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock => ({ id, type: 'element', tag, ...(text ? { text } : {}), ...(Object.keys(props).length ? { props } : {}), ...(children ? { children } : {}), ...(css ? { css } : {}) });
const text = (id: string, value: string, tag = 'p') => el(id, tag, value, {}, undefined, { margin: '0', 'overflow-wrap': 'anywhere' });
const action = (operation: string, inputs: Record<string, string> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const button = (id: string, label: string, operation: string, disabled: string | boolean = '{plan.busy}', inputs: Record<string, string> = {}) =>
 el(id, 'button', '', { type: 'button', ...action(operation, inputs), disabled }, [text(`${id}-label`, label, 'span')], { ...fieldCss, width: 'auto', cursor: 'pointer' });
const when = (id: string, arg: string, children: WebpageBlock[], negate = false): WebpageBlock => ({ id, type: 'condition', condition: { arg, ...(negate ? { negate: true } : {}) }, children });
const row = (id: string, children: WebpageBlock[]) => el(id, 'div', '', {}, children, rowCss);
const stack = (id: string, children: WebpageBlock[]) => el(id, 'div', '', {}, children, stackCss);
const repeat = (id: string, path: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'collection', props: { itemsPath: path, size: 'all', transparent: true }, children });
const field = (id: string, label: string, control: WebpageBlock) => el(id, 'label', '', {}, [text(`${id}-label`, label, 'span'), control], { display: 'grid', gap: '6px', 'min-width': '0' });

/** The stored document contains layout and binding paths only. No account,
 * OAuth URL, recipient code, file contents or credential is seeded into it. */
export const chatGPTPlanBlocks: WebpageBlock[] = [
 stack('plan-root', [
  row('plan-heading-row', [text('plan-heading', 'ChatGPT plan', 'h3'), el('plan-usage', 'a', 'Manage usage', { href: 'https://chatgpt.com/settings/usage', target: '_blank', rel: 'noopener noreferrer' })]),
  text('plan-description', 'Use your ChatGPT plan for eligible Lopu requests. Credentials stay in protected runtime storage, linked to your Thingtime account.'),
  text('plan-guidance', 'Choose a model below, then select the account in Lopu → Your providers. Plan limits apply; this connection never switches to API credits automatically.'),
  when('plan-signed-out', 'plan.signedIn', [text('plan-sign-in-note', 'Sign in to your personal Thingtime account to connect a ChatGPT plan.')], true),
  when('plan-unavailable', 'plan.unavailable', [text('plan-runtime-note', 'Enable the local API and database in Electron’s Desktop settings, or choose a configured self-hosted API. Complete initial ChatGPT sign-in on the runtime computer.')]),
  when('plan-move-only', 'plan.moveOnly', [text('plan-move-note', 'This runtime accepts moved connections. Sign in through your local Electron runtime, then use “Move between runtimes” below.')]),
  when('plan-loading', 'plan.loading', [el('plan-loading-note', 'p', 'Checking ChatGPT connections…', { role: 'status' })]),
  when('plan-error', 'plan.error', [row('plan-error-row', [el('plan-error-note', 'p', '{plan.error}', { role: 'alert' }), button('plan-retry', 'Retry', 'plan.retry')])]),
  when('plan-authenticated', 'plan.signedIn', [
   row('plan-connect-row', [button('plan-connect', 'Continue with ChatGPT', 'plan.begin', '{plan.cannotBegin}')]),
   when('plan-pending', 'plan.pending', [el('plan-pending-card', 'div', '', {}, [
    el('plan-pending-status', 'p', '{plan.pendingMessage}', { role: 'status' }),
    row('plan-pending-actions', [when('plan-open-ready', 'plan.canOpen', [button('plan-open', 'Continue with ChatGPT', 'plan.open', '{plan.busy}')]), button('plan-cancel', 'Cancel sign-in', 'plan.cancel')])
   ], cardCss)]),
   repeat('plan-accounts', 'plan.accounts', [el('plan-account-card', 'fieldset', '', {}, [
    row('plan-account-heading', [text('plan-account-label', '{item.label}', 'strong'), text('plan-account-status', '{item.connectionStatus}', 'span')]),
    when('plan-email-present', 'item.email', [text('plan-account-email', '{item.email}')]),
    when('plan-account-connected', 'item.connected', [
     field('plan-model-field', 'Model', el('plan-model-select', 'select', '', { name: 'model', 'aria-label': 'ChatGPT model', value: '{item.model}', disabled: '{item.cannotChooseModel}', ...action('plan.select-model', { id: '{item.id}' }) }, [
      el('plan-model-placeholder', 'option', 'Choose an available model', { value: '', disabled: true }),
      repeat('plan-model-options', 'item.models', [el('plan-model-option', 'option', '{item.displayName}', { value: '{item.slug}' })])
     ], fieldCss)),
     text('plan-selected-model', '{item.modelLabel}'),
     when('plan-no-models', 'item.noModels', [text('plan-no-model-note', 'No eligible models are available for this account.')]),
     row('plan-account-actions', [button('plan-refresh-models', 'Refresh available models', 'plan.refresh-models', '{plan.cannotManage}', { id: '{item.id}' }), button('plan-disconnect', 'Sign out', 'plan.disconnect', '{plan.cannotManage}', { id: '{item.id}' })])
    ]),
    when('plan-account-reconnect', 'item.connected', [button('plan-reconnect', 'Continue with ChatGPT', 'plan.begin', '{plan.cannotBegin}', { id: '{item.id}' })], true)
   ], { ...cardCss, ...stackCss })]),
   when('transfer-available', 'plan.available', [el('transfer-disclosure', 'details', '', {}, [
    el('transfer-summary', 'summary', '', {}, [text('transfer-summary-label', 'Move between runtimes', 'span')], { cursor: 'pointer', 'font-weight': '600' }),
    stack('transfer-content', [
     text('transfer-description', 'Connect locally, then move a connection to another runtime you control. Your API runs requests; its configured database stores the encrypted connection. A move stops this source from using or refreshing it.'),
     text('transfer-prepare-heading', '1. Prepare the destination', 'h4'),
     row('transfer-prepare-row', [button('transfer-prepare', 'Create destination code', 'transfer.prepare', '{transfer.disabled}')]),
     when('transfer-code-ready', 'transfer.hasRecipientCode', [el('transfer-code', 'textarea', '', { 'aria-label': 'Destination code', value: '{transfer.recipientCode}', readOnly: true, rows: 4 }, undefined, fieldCss)]),
     text('transfer-code-hint', 'Generate this code while signed in to the destination API, then copy it into the source below. It identifies the receiving account and expires shortly.'),
     text('transfer-move-heading', '2. Move from the source', 'h4'),
     el('transfer-move-form', 'fieldset', '', {}, [
      field('transfer-account-field', 'Connection to move', el('transfer-account', 'select', '', { name: 'transferAccount', 'aria-label': 'Connection to move', disabled: '{transfer.disabled}' }, [
       el('transfer-account-placeholder', 'option', 'Choose a ChatGPT connection', { value: '' }),
       repeat('transfer-account-options', 'transfer.accounts', [el('transfer-account-option', 'option', '{item.label} · {item.shortId}', { value: '{item.id}' })])
      ], fieldCss)),
      field('transfer-destination-field', 'Receiving runtime destination code', el('transfer-destination', 'textarea', '', { name: 'destinationCode', placeholder: 'Paste the destination code', rows: 4, disabled: '{transfer.disabled}' }, undefined, fieldCss)),
      row('transfer-review-row', [button('transfer-review', 'Review move', 'transfer.review', '{transfer.disabled}')])
     ], { border: '0', padding: '0', margin: '0', ...stackCss }),
     when('transfer-download-ready', 'transfer.hasBundle', [row('transfer-download-row', [button('transfer-download', 'Download encrypted transfer', 'transfer.download', '{transfer.busy}')])]),
     text('transfer-import-heading', '3. Import at the destination', 'h4'),
     el('transfer-import-form', 'fieldset', '', {}, [field('transfer-file-field', 'Encrypted transfer file', el('transfer-file', 'input', '', { name: 'transferFile', type: 'file', accept: 'application/json,.json', 'aria-label': 'Encrypted ChatGPT transfer file', disabled: '{transfer.disabled}', ...action('transfer.import') }, undefined, { 'max-width': '100%' }))], { border: '0', padding: '0', margin: '0', 'min-width': '0' }),
     when('transfer-message-ready', 'transfer.message', [el('transfer-message', 'p', '{transfer.message}', { role: 'status' }, undefined, { 'overflow-wrap': 'anywhere' })])
    ])
   ])]),
   el('transfer-confirm-dialog', 'dialog', '', { 'aria-label': 'Move this ChatGPT connection?', ...action('transfer.cancel', { open: '{transfer.reviewOpen}' }) }, [stack('transfer-confirm-content', [
    text('transfer-confirm-heading', 'Move this ChatGPT connection?', 'h3'),
    text('transfer-confirm-explanation', 'This runtime will stop using the connection. Only the runtime that created this destination code can decrypt the transfer.'),
    text('transfer-confirm-account', 'Moving connection: {transfer.selectedAccount}'),
    text('transfer-confirm-origin', '{transfer.targetOrigin}', 'strong'),
    text('transfer-confirm-owner', 'Receiving account: {transfer.targetOwnerId}'),
    text('transfer-confirm-check', 'Confirm that this is your intended API and account. Keep the encrypted package until the import succeeds.'),
    row('transfer-confirm-actions', [button('transfer-dismiss', 'Cancel', 'transfer.cancel', '{transfer.busy}'), button('transfer-commit', 'Move connection', 'transfer.move', '{transfer.disabled}')])
   ])], dialogCss),
   el('plan-welcome-dialog', 'dialog', '', { 'aria-label': 'You’re using your ChatGPT plan', ...action('plan.acknowledge', { open: '{plan.welcome}' }) }, [stack('plan-welcome-content', [
    text('plan-welcome-heading', 'You’re using your ChatGPT plan', 'h3'),
    text('plan-welcome-description', 'Eligible Lopu requests through this account use your ChatGPT plan. Review usage and app limits in ChatGPT settings.'),
    el('plan-welcome-usage', 'a', 'ChatGPT settings', { href: 'https://chatgpt.com/settings/usage', target: '_blank', rel: 'noopener noreferrer' }),
    row('plan-welcome-actions', [button('plan-acknowledge', 'Got it', 'plan.acknowledge', false)])
   ])], dialogCss)
  ])
 ])
];
