import type { WebpageBlock } from '../Builder/webpageBlocks';

const stack = { display: 'grid', gap: '12px', 'min-width': '0' };
const row = { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '8px', 'min-width': '0' };
const card = { ...stack, 'align-content': 'start', padding: '16px', border: '1px solid var(--tt-border, #ececef)', 'border-radius': 'var(--tt-radius-lg, 16px)', background: 'var(--tt-card, white)' };
const field = { padding: '8px 10px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'min-width': '0', 'box-sizing': 'border-box', background: 'var(--tt-surface, white)', color: 'inherit', font: 'inherit' };
const el = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock => ({ id, type: 'element', tag, text, props, ...(children ? { children } : {}), ...(css ? { css } : {}) });
const text = (id: string, value: string, tag = 'p') => el(id, tag, value, {}, undefined, {
  margin: '0', 'overflow-wrap': 'anywhere',
  ...(/^h[1-3]$/.test(tag) ? { 'font-size': tag === 'h1' ? '28px' : tag === 'h2' ? '20px' : '18px', 'font-weight': tag === 'h1' ? '700' : '600', 'line-height': '1.3' } : {})
});
const repeat = (id: string, path: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'collection', props: { itemsPath: path, size: 'all', transparent: true }, children });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id, type: 'condition', condition: { arg }, children });
const action = (operation: string, id = '{item.id}') => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, id } });
const button = (id: string, label: string, operation: string, disabled = '{catalog.busy}', target = '{item.id}') => el(id, 'button', '', { type: 'button', disabled, ...action(operation, target) }, [text(`${id}-label`, label, 'span')], { ...field, cursor: 'pointer', 'min-height': '44px' });

/** One editable template per repeated card. Live records and form values are
 * never stamped into this document or saved by the Builder. */
export const serviceCatalogBlocks: WebpageBlock[] = [el('catalog', 'div', '', {}, [
  repeat('service-groups', 'catalog.groups', [el('service-group', 'section', '', { id: 'service-{item.id}', 'aria-label': '{item.name}' }, [
    el('service-heading-row', 'div', '', {}, [
      el('service-heading', 'h2', '', {}, [text('service-icon', '{item.icon}', 'span'), text('service-name', '{item.name}', 'span'), text('service-count', '{item.count} connected', 'span')], { ...row, margin: '0', 'font-size': '20px', 'font-weight': '600' }),
      when('service-add-visible', 'item.multiple', [button('service-add', '+ Add account', 'service.connect', '{item.cannotConnect}', '{item.primaryId}')])
    ], { ...row, 'justify-content': 'space-between' }),
    when('service-about-visible', 'item.about', [text('service-about', '{item.about}')]),
    el('provider-grid', 'div', '', {}, [repeat('service-providers', 'item.providers', [el('provider-card', 'fieldset', '', { 'aria-label': '{item.name}' }, [
      el('provider-heading', 'h3', '', {}, [text('provider-icon', '{item.icon}', 'span'), text('provider-name', '{item.name}', 'span')], { ...row, margin: '0', 'font-size': '18px', 'font-weight': '600' }),
      text('provider-about', '{item.about}'), text('provider-authentication', '{item.authentication}'),
      repeat('provider-accounts', 'item.accounts', [el('account-card', 'div', '', {}, [
        el('account-heading', 'div', '', {}, [when('account-avatar-visible', 'item.avatarUrl', [el('account-avatar', 'img', '', { src: '{item.avatarUrl}', alt: '', referrerPolicy: 'no-referrer' }, undefined, { width: '30px', height: '30px', 'border-radius': '50%' })]),
          el('account-identity', 'div', '', {}, [text('account-name', '{item.displayName}', 'strong'), text('account-handle', '{item.handle}')], stack)
        ], row), text('account-authorization', '{item.authorization}'),
        el('account-actions', 'div', '', {}, [
          when('account-oauth-actions', 'item.oauth', [button('account-check', 'Check connection', 'service.verify', '{item.cannotVerify}'), button('account-reconnect', 'Reconnect', 'service.connect', '{item.cannotReconnect}', '{item.providerId}')]),
          when('account-feed-visible', 'item.canOpenFeed', [el('account-feed', 'a', 'Feed', { href: '{item.feedHref}' })]),
          button('account-disconnect', 'Disconnect', 'service.unlink')
        ], row),
        when('account-error-visible', 'item.lastSyncError', [text('account-error', '{item.lastSyncError}')]),
        when('account-permissions-visible', 'item.permissions', [el('account-permissions', 'details', '', {}, [el('account-permissions-summary', 'summary', '', {}, [text('account-permissions-label', 'Granted permissions', 'span')]), text('account-permissions-value', '{item.permissions}')])])
      ], { ...stack, 'border-top': '1px solid var(--tt-border)', 'padding-top': '12px' })]),
      when('provider-setup-visible', 'item.setupMessage', [text('provider-setup', '{item.setupMessage}')]),
      button('provider-add', '{item.connectLabel}', 'service.connect', '{item.cannotConnect}'),
      when('provider-form-visible', 'item.connecting', [el('provider-form', 'div', '', { 'data-tt-credential-form': '' }, [
        text('provider-form-title', 'Connect {item.name}', 'strong'),
        repeat('provider-fields', 'item.fields', [el('provider-field', 'label', '', {}, [
          text('provider-field-label', '{item.label}', 'span'),
          el('provider-field-input', 'input', '', { name: '{item.key}', type: '{item.type}', 'data-tt-private-control': '', placeholder: '{item.placeholder}', required: '{item.required}', disabled: '{catalog.busy}', autoComplete: 'off' }, undefined, { ...field, width: '100%' }),
          when('provider-field-help-visible', 'item.help', [text('provider-field-help', '{item.help}')])
        ], stack)]),
        el('provider-form-actions', 'div', '', {}, [el('provider-submit', 'button', '', { type: 'button', disabled: '{catalog.busy}', 'data-tt-submit': 'true', ...action('service.submit') }, [text('provider-submit-label', 'Link account', 'span')], { ...field, 'min-height': '44px' }), button('provider-cancel', 'Cancel', 'service.cancel')], row)
      ], stack)])
    ], { ...card, margin: '0' })])], { ...stack, 'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' })
  ], stack)])
], { ...stack, gap: '24px' })];

export const serviceBlockHelpers = { el, text, repeat, when, action, button };
export const serviceBlockStyles = { stack, row, card, field };
