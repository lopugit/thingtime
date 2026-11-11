import type { WebpageBlock } from '../Builder/webpageBlocks';

const element = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, css: Record<string, string> = {}): WebpageBlock =>
  ({ id, type: 'element', tag, text, props, css });
const button = (id: string, text: string, operation: string, input: Record<string, unknown> = {}) =>
  element(id, 'button', text, { type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...input } },
    { 'min-height': '44px', 'max-width': '100%', 'white-space': 'normal', 'overflow-wrap': 'anywhere', padding: '6px 12px', 'border-radius': '8px', border: '1px solid var(--tt-border, #ddd)' });
const collection = (id: string, itemsPath: string, children: WebpageBlock[], transparent = false): WebpageBlock =>
  ({ id, type: 'collection', props: { itemsPath, transparent, size: 'all', hideSearch: true, hideSize: true, hideCount: true }, children });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock =>
  ({ id, type: 'condition', condition: { arg, equals: true }, children });


const serviceOperationBlocks = (): WebpageBlock[] => [
  when('named-service-resource', 'item.resourceRequired', [
    element('named-resource-label', 'label', '{item.resourceLabel}', { htmlFor: 'service-resource-{item.id}' }),
    element('named-resource-input', 'input', '', { id: 'service-resource-{item.id}', name: 'service-resource-{item.id}',
      'aria-label': '{item.resourceLabel}', type: 'text', autoComplete: 'off', spellCheck: false, pattern: '[A-Za-z0-9_-]+', required: true },
      { 'min-height': '44px', width: '100%', 'min-width': '0', 'box-sizing': 'border-box', padding: '6px 8px', border: '1px solid var(--tt-border, #ddd)' })
  ]),
  button('named-run-operation', '{item.label}', 'use', { id: '{item.id}' }),
  when('named-service-next', 'item.hasNext', [button('named-next-page', 'Read next page', 'use', { id: '{item.id}', next: true })])
];

export const namedConnectionBlocks: WebpageBlock[] = [
  element('named-heading', 'h2', 'Named auth connections', {}, { 'font-weight': '700' }),
  element('named-about', 'p', 'Save a separate sign-in for each use. Removing a connection here does not revoke access at the provider.'),
  element('named-supported', 'p', 'Google account supports profile and email reads. Google service connections support the read actions you explicitly allow.', {},
    { 'font-size': '14px', color: 'var(--tt-muted, #6b7280)' }),
  collection('named-list', 'named.rows', [{
    id: 'named-card', type: 'element', tag: 'article',
    css: { padding: '12px', 'margin-bottom': '8px', display: 'grid', 'grid-template-columns': 'minmax(0, 1fr)', 'min-width': '0', 'max-width': '100%', 'box-sizing': 'border-box', gap: '5px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', 'overflow-wrap': 'anywhere' },
    children: [
      element('named-card-name', 'h3', '{item.name}', {}, { 'font-weight': '650' }),
      element('named-card-account', 'p', '{item.account}'),
      element('named-card-requested', 'p', 'Requested from provider: {item.requested}'),
      element('named-card-granted', 'p', 'Provider confirmed: {item.granted}'),
      element('named-card-allowed', 'p', 'Allowed in Thingtime: {item.allowed}'),
      button('named-card-reconnect', 'Reconnect', 'reconnect', { id: '{item.id}' }),
      button('named-card-remove', 'Remove local connection', 'remove', { id: '{item.id}' })
    ]
  }]),
  button('named-add', 'Add named connection', 'add'),
  { id: 'named-provider-shortcuts', type: 'element', tag: 'details', children: [
    element('named-provider-shortcuts-title', 'summary', 'Choose a provider for named access'),
    collection('named-provider-shortcut-list', 'named.providers', [button('named-provider-shortcut', 'Add {item.label} connection', 'add', { id: '{item.id}' })], true)
  ] },
  when('named-form', 'named.editing', [{
    id: 'named-form-group', type: 'element', tag: 'fieldset',
    css: { display: 'grid', 'grid-template-columns': 'minmax(0, 1fr)', gap: '8px', padding: '12px', 'min-width': '0', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' },
    children: [
      element('named-form-title', 'legend', '{named.formTitle}'),
      element('named-provider-label', 'label', 'Provider', { htmlFor: 'named-provider-select' }),
      { id: 'named-provider-picker', type: 'element', tag: 'select',
        props: { id: 'named-provider-select', 'aria-label': 'Provider', value: '{named.provider}', disabled: '{named.reconnecting}',
          'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'provider' } },
        css: { 'min-height': '44px', width: '100%', 'min-width': '0', 'max-width': '100%', border: '1px solid var(--tt-border, #ddd)' },
        children: [collection('named-provider-options', 'named.providers', [element('named-provider-option', 'option', '{item.label}', { value: '{item.id}' })], true)] },
      element('named-provider-selected', 'p', '{named.providerLabel}', {}, { 'overflow-wrap': 'anywhere', 'font-size': '14px' }),
      element('named-name-label', 'label', 'Connection name', { htmlFor: 'named-connection-name' }),
      element('named-name-field', 'input', '', { id: 'named-connection-name', name: 'connection-name', 'aria-label': 'Connection name', defaultValue: '{named.name}' },
        { 'min-height': '44px', width: '100%', 'min-width': '0', padding: '6px 8px', border: '1px solid var(--tt-border, #ddd)' }),
      element('named-provider-scope-label', 'p', 'Provider permissions to request', {}, { 'font-weight': '600' }),
      element('named-provider-scope-notice', 'p', '{named.permissionNotice}'),
      when('named-provider-scope-available', 'named.hasPermissions', [
        collection('named-provider-scope-options', 'named.permissionOptions', [{
          id: 'named-provider-scope-row', type: 'element', tag: 'label',
          css: { display: 'flex', gap: '8px', 'align-items': 'center', 'min-height': '44px' },
          children: [
            element('named-provider-scope-choice', 'input', '', { type: 'checkbox', checked: '{item.selected}', disabled: '{item.required}', 'aria-label': '{item.label}',
              'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'permission', id: '{item.id}' } }),
            element('named-provider-scope-copy', 'span', '{item.label}')
          ]
        }], true)
      ]),
      element('named-access-label', 'p', 'Allowed operations in Thingtime', {}, { 'font-weight': '600' }),
      collection('named-access-options', 'named.options', [{
        id: 'named-access-row', type: 'element', tag: 'label', css: { display: 'flex', gap: '8px', 'align-items': 'center', 'min-height': '44px' },
        children: [
          element('named-access-choice', 'input', '', { type: 'checkbox', checked: '{item.selected}', 'aria-label': '{item.label}',
            'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'access', id: '{item.id}' } }),
          element('named-access-copy', 'span', '{item.label}')
        ]
      }], true),
      button('named-form-submit', 'Continue to sign in', 'start'),
      button('named-form-cancel', 'Cancel', 'cancel')
    ]
  }]),
  when('named-consumer', 'named.canUse', [
    element('named-consumer-heading', 'h3', 'Use a saved connection', {}, { 'font-weight': '650' }),
    element('named-consumer-label', 'label', 'Connection', { htmlFor: 'named-use-select' }),
    { id: 'named-consumer-select', type: 'element', tag: 'select', props: { id: 'named-use-select', 'aria-label': 'Connection', value: '{named.active}',
      'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'select' } },
      css: { width: '100%', 'min-width': '0', 'max-width': '100%', 'min-height': '44px' },
      children: [collection('named-consumer-options', 'named.rows', [element('named-consumer-option', 'option', '{item.name}', { value: '{item.id}' })], true)] },
    element('named-consumer-selected-name', 'p', '{named.activeName}', {}, { 'overflow-wrap': 'anywhere', 'font-size': '14px' }),
    collection('named-consumer-operations', 'named.operations', serviceOperationBlocks(), true),
    when('named-operation-busy', 'named.using', [element('named-operation-status', 'span', '◌', { role: 'status', 'aria-label': 'Reading selected connection' })]),
    element('named-result', 'pre', '{named.result}', {}, { 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere', 'word-break': 'break-word', display: 'block', width: '100%', 'max-width': '100%', 'box-sizing': 'border-box', 'min-width': '0', 'max-height': '480px', overflow: 'auto', 'font-size': '13px' })
  ])
];

/** Add controls only to the existing authored operation template; preserve
 * custom layouts, edited buttons and deliberate removal of the whole region. */
export function migrateNamedServiceBlocks(blocks: WebpageBlock[]): WebpageBlock[] {
  return blocks.map(block => {
    if (block.id === 'named-consumer-operations') {
      const children = block.children || [];
      if (children.some(child => child.id === 'named-service-resource')) return block;
      const [resource, , next] = serviceOperationBlocks();
      return { ...block, children: [resource, ...children, next] };
    }
    if (block.id === 'named-consumer' && block.children) {
      const children = migrateNamedServiceBlocks(block.children);
      if (!children.some(child => child.id === 'named-operation-busy')) {
        const index = children.findIndex(child => child.id === 'named-result');
        if (index >= 0) children.splice(index, 0, when('named-operation-busy', 'named.using', [element('named-operation-status', 'span', '◌', { role: 'status', 'aria-label': 'Reading selected connection' })]));
      }
      return { ...block, children };
    }
    if (block.id === 'named-card' && !block.css?.['grid-template-columns']) return { ...block,
      css: { ...block.css, 'grid-template-columns': 'minmax(0, 1fr)', 'min-width': '0', 'max-width': '100%', 'box-sizing': 'border-box' } };
    if (block.id === 'named-result') {
      const props = { ...block.props }; delete props.role;
      return { ...block, tag: 'pre', props, css: { 'white-space': 'pre-wrap', 'word-break': 'break-word', display: 'block', width: '100%', 'max-width': '100%', 'box-sizing': 'border-box', 'min-width': '0', 'max-height': '480px', overflow: 'auto', ...block.css } };
    }
    return block.children ? { ...block, children: migrateNamedServiceBlocks(block.children) } : block;
  });
}
