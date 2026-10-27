import type { WebpageBlock } from '../Builder/webpageBlocks';
import { serviceBlockHelpers, serviceBlockStyles } from './serviceCatalogBlocks';
const { el, text, repeat, when, action, button } = serviceBlockHelpers;
const { stack, row, card, field } = serviceBlockStyles;
const control = (id: string, label: string, tag: string, props: Record<string, unknown>, operation: string, children?: WebpageBlock[]) =>
  el(`${id}-field`, 'label', '', {}, [text(`${id}-label`, label, 'span'), el(id, tag, '', { ...props, ...action(operation) }, children, { ...field, width: '100%' })], stack);
const submit = (id: string, label: string, operation: string, disabled: string) => el(id, 'button', '', { type: 'button', 'data-tt-submit': 'true', disabled, ...action(operation) }, [text(`${id}-label`, label, 'span')], { ...field, 'min-height': '44px' });

export const connectionsOverviewBlocks: WebpageBlock[] = [el('connections-overview', 'section', '', {}, [
  el('connections-heading-row', 'div', '', {}, [
    el('connections-heading-copy', 'div', '', {}, [text('connections-title', 'Third-party services', 'h1'), text('connections-description', 'Your account library for connected services. Add multiple accounts, choose permissions, and reuse saved authorizations in Thingtime actions.')], stack),
    el('connections-feed-link', 'a', 'Open connected feed', { href: '/connections/feed' })
  ], { ...row, 'justify-content': 'space-between' }),
  when('connections-signed-out', 'page.signedOut', [el('connections-sign-in-card', 'div', '', {}, [
    text('connections-sign-in-title', 'Sign in to link your apps', 'h2'),
    text('connections-sign-in-help', 'Connections belong to your account — log in or register to start linking.'),
    el('connections-sign-in-links', 'div', '', {}, [el('connections-login', 'a', 'Log in', { href: '/login' }), el('connections-register', 'a', 'Register', { href: '/register' })], row)
  ], card)])
], stack)];

export const connectionToolsBlocks: WebpageBlock[] = [el('connection-tools', 'div', '', {}, [
  when('channels-visible', 'page.signedIn', [el('channels-section', 'section', '', {}, [
    text('channels-title', 'YouTube channels', 'h2'), text('channels-description', 'Your Thingtime-managed subscription list — every channel you add merges into one uploads feed.'),
    when('channels-search-guidance', 'channels.needsSetup', [text('channels-search-help', 'Name search needs a YouTube API key; channel IDs, URLs, and @handles work now.')]),
    repeat('channels-saved', 'channels.saved', [el('channel-card', 'div', '', {}, [
      when('channel-thumbnail-visible', 'item.thumbnail', [el('channel-thumbnail', 'img', '', { src: '{item.thumbnail}', alt: '' }, undefined, { width: '28px', height: '28px' })]),
      text('channel-title', '{item.title}', 'strong'), button('channel-unsubscribe', 'Unsubscribe', 'channels.unsubscribe', '{channels.busy}')
    ], { ...card, ...row })]),
    el('channel-search', 'fieldset', '', {}, [
      control('channel-query', 'Search channels', 'input', { name: 'query', value: '{channels.query}', required: true, placeholder: 'Channel ID, URL, @handle, or name', disabled: '{channels.busy}' }, 'channels.query'),
      submit('channel-search-button', 'Search', 'channels.search', '{channels.busy}')
    ], { ...card, margin: '0' }),
    repeat('channel-results', 'channels.results', [el('channel-result', 'div', '', {}, [
      when('channel-result-thumbnail-visible', 'item.thumbnail', [el('channel-result-thumbnail', 'img', '', { src: '{item.thumbnail}', alt: '' }, undefined, { width: '28px', height: '28px' })]),
      text('channel-result-title', '{item.title}'), button('channel-subscribe', 'Subscribe', 'channels.subscribe', '{channels.busy}')
    ], { ...card, ...row })])
  ], stack)]),
  el('filters-section', 'section', '', {}, [
    text('filters-title', 'AI feed filters', 'h2'), text('filters-description', 'Describe what to catch in plain language — “warn” veils matched posts behind a Show button, “hide” drops them.'),
    repeat('filters-list', 'filters.items', [el('filter-card', 'div', '', {}, [
      el('filter-toggle-field', 'label', '', {}, [el('filter-toggle', 'input', '', { type: 'checkbox', checked: '{item.enabled}', disabled: '{page.signedOut}', ...action('filters.toggle') }), text('filter-toggle-label', 'Enabled', 'span')], row),
      text('filter-name', '{item.name}', 'strong'), text('filter-action', '{item.actionLabel}', 'span'), text('filter-prompt', '{item.prompt}'),
      button('filter-remove', 'Remove', 'filters.remove', '{page.signedOut}')
    ], { ...card, ...row })]),
    when('filters-create-visible', 'page.signedIn', [el('filter-create', 'fieldset', '', {}, [
      control('filter-name-input', 'Filter name', 'input', { name: 'filterName', value: '{filters.name}', required: true, placeholder: 'Sad news' }, 'filters.name'),
      control('filter-action-input', 'Matching posts', 'select', { name: 'filterAction', value: '{filters.action}' }, 'filters.action', [el('filter-warn', 'option', 'Warn (Show button)', { value: 'warn' }), el('filter-hide', 'option', 'Hide', { value: 'hide' })]),
      control('filter-prompt-input', 'What should this filter catch?', 'textarea', { name: 'filterPrompt', value: '{filters.prompt}', required: true, rows: 2, placeholder: 'Warn for sad news' }, 'filters.prompt'),
      submit('filter-create-button', 'Add filter', 'filters.create', '{page.signedOut}')
    ], { ...card, margin: '0' })])
  ], stack)
], { ...stack, gap: '24px' })];
