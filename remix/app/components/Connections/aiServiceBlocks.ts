import type { WebpageBlock } from '../Builder/webpageBlocks';
import { serviceBlockHelpers, serviceBlockStyles } from './serviceCatalogBlocks';
const { el, text, repeat, when, action, button } = serviceBlockHelpers;
const { stack, row, card, field } = serviceBlockStyles;

/** Secret fields deliberately have no value binding. Only the transient adapter
 * reads them on submission; layout saves contain this blank field template. */
export const aiServiceBlocks: WebpageBlock[] = [el('ai-services', 'div', '', {}, [
  repeat('ai-service-list', 'ai.services', [el('ai-service', 'section', '', { 'aria-label': '{item.name}' }, [
    el('ai-service-heading', 'h2', '', {}, [text('ai-service-icon', '{item.icon}', 'span'), text('ai-service-name', '{item.name}', 'span')], { ...row, margin: '0', 'font-size': '20px', 'font-weight': '600' }),
    el('ai-service-card', 'fieldset', '', {}, [
      text('ai-card-title', '{item.cardTitle}', 'h3'), text('ai-card-about', '{item.about}'),
      repeat('ai-accounts', 'item.entries', [el('ai-account', 'div', '', {}, [
        text('ai-account-name', '{item.name}', 'strong'), text('ai-account-private', 'Saved privately', 'span'),
        el('ai-account-manage', 'a', 'Manage', { href: '/settings#secure-vault' }),
        button('ai-account-remove', 'Remove', 'ai.remove', '{ai.busy}')
      ], { ...row, 'border-top': '1px solid var(--tt-border)', 'padding-top': '12px' })]),
      button('ai-account-add', '+ Add account', 'ai.add', '{item.cannotAdd}'),
      when('ai-setup-visible', 'item.needsSetup', [text('ai-setup', 'Secure storage must be available before adding an API account.')]),
      when('ai-form-visible', 'item.selected', [el('ai-form', 'div', '', { 'data-tt-credential-form': '' }, [
        el('ai-name-field', 'label', '', {}, [text('ai-name-label', 'Account name', 'span'), el('ai-name-input', 'input', '', { name: 'accountName', 'data-tt-private-control': '', placeholder: 'Personal, Work…', required: true, disabled: '{ai.busy}' }, undefined, field)], stack),
        el('ai-token-field', 'label', '', {}, [text('ai-token-label', '{item.credentialLabel}', 'span'), el('ai-token-input', 'input', '', { name: 'accountToken', 'data-tt-private-control': '', type: 'password', autoComplete: 'new-password', required: true, disabled: '{ai.busy}' }, undefined, field)], stack),
        el('ai-setup-guide', 'a', '{item.guide}', { href: '{item.dashboard}', target: '_blank', rel: 'noopener noreferrer' }),
        el('ai-form-actions', 'div', '', {}, [el('ai-save', 'button', '', { type: 'button', disabled: '{ai.busy}', 'data-tt-submit': 'true', ...action('ai.save') }, [text('ai-save-label', 'Save account', 'span')], { ...field, 'min-height': '44px' }), button('ai-cancel', 'Cancel', 'ai.cancel', '{ai.busy}')], row)
      ], stack)])
    ], { ...card, margin: '0' })
  ], stack)])
], { ...stack, gap: '24px' })];
