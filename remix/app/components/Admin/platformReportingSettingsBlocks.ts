import type { WebpageBlock } from '../Builder/webpageBlocks';
const element = (id: string, tag: string, text?: string, props: Record<string, unknown> = {}, children?: WebpageBlock[], css: Record<string, string> = {}): WebpageBlock => ({ id: `platform-log-${id.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, type: 'element', tag, ...(text === undefined ? {} : { text }), props, ...(children ? { children } : {}), css });
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id: `platform-log-${id.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, type: 'condition', condition: { arg: `reporting.${arg}`, equals: true }, children });
const text = (id: string, value: string) => element(id, 'p', value, {}, undefined, { margin: '0', 'font-size': '13px', 'line-height': '1.6', color: 'var(--tt-text, #5a5a66)', 'overflow-wrap': 'anywhere' });
const controlCss = { 'min-height': '44px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': 'var(--tt-radius-sm, 9px)', background: 'var(--tt-card, #fff)', color: 'var(--tt-ink, #16161a)', 'max-width': '100%', 'min-width': '0', 'box-sizing': 'border-box' };
const field = (id: string, label: string, placeholder: string, help: string, operation: string): WebpageBlock => element(`${id}-field`, 'div', undefined, {}, [
  element(`${id}-label`, 'label', label, { htmlFor: `{reporting.ids.${id}}` }, undefined, { display: 'block', 'font-size': '14px', 'margin-bottom': '6px' }),
  element(`${id}-input`, 'input', undefined, { id: `{reporting.ids.${id}}`, name: id, value: `{reporting.${id}}`, placeholder, disabled: '{reporting.disabled}', 'aria-describedby': `{reporting.ids.${id}Help}`, ...action(operation) }, undefined, { ...controlCss, width: '100%' }),
  element(`${id}-help`, 'p', help, { id: `{reporting.ids.${id}Help}` }, undefined, { margin: '6px 0 0', 'font-size': '13px', 'line-height': '1.6', color: 'var(--tt-text, #5a5a66)' })
]);
const button = (id: string, label: string, operation: string, disabled: string) => element(id, 'button', label, { type: 'button', disabled: `{reporting.${disabled}}`, ...action(operation) }, undefined, { ...controlCss, cursor: 'pointer', 'font-weight': '600' });
/** Labels, controls, helper copy, options and repeated rows remain individually editable. */
export const PLATFORM_REPORTING_SETTINGS_BLOCKS: WebpageBlock[] = [element('section', 'section', undefined, { 'aria-label': 'Private scheduled run logs', 'aria-busy': '{reporting.busy}' }, [
  element('heading', 'h2', 'Private scheduled run logs', {}, undefined, { margin: '0', 'font-size': '16px', 'font-weight': '600' }),
  text('description', 'Publish scheduled run status and completion posts as a dedicated Character, shared with your private audience group.'),
  text('summary', '{reporting.summary}'),
  when('loading', 'loading', [element('progress', 'progress', undefined, { 'aria-label': 'Loading platform reporting settings' }, undefined, { height: '3px', width: '120px', 'max-width': '100%', 'accent-color': 'var(--tt-accent, #805ad5)' })]),
  when('ready', 'ready', [element('fields', 'div', undefined, {}, [
    element('toggle', 'label', undefined, { htmlFor: '{reporting.ids.enabled}' }, [
      element('toggle-input', 'input', undefined, { id: '{reporting.ids.enabled}', name: 'enabled', type: 'checkbox', checked: '{reporting.enabled}', disabled: '{reporting.disabled}', ...action('reporting.enabled') }, undefined, { width: '22px', height: '22px', margin: '0', 'accent-color': 'var(--tt-accent, #805ad5)' }),
      element('toggle-label', 'span', 'Enable private run logs')
    ], { display: 'flex', gap: '12px', 'align-items': 'center', 'min-height': '44px', cursor: 'pointer' }),
    field('ownerUsername', 'Owning account username', 'thingtime', 'Account that owns the reporting Character.', 'reporting.owner'),
    field('characterUsername', 'Reporting Character username', 'thingtime-platform', 'Posts will appear under this Character.', 'reporting.character'),
    element('group-field', 'div', undefined, {}, [
      element('group-label', 'label', 'Private audience group', { htmlFor: '{reporting.ids.groupId}' }, undefined, { display: 'block', 'font-size': '14px', 'margin-bottom': '6px' }),
      element('group-select', 'select', undefined, { id: '{reporting.ids.groupId}', name: 'groupId', value: '{reporting.groupId}', disabled: '{reporting.disabled}', ...action('reporting.group') }, [
        element('group-empty', 'option', 'Choose a private group', { value: '' }),
        { id: 'platform-log-group-options', type: 'collection', props: { itemsPath: 'reporting.groups', size: 'all', transparent: true }, children: [element('group-option', 'option', '{item.name}', { value: '{item.id}' })] }
      ], { ...controlCss, width: '100%' }),
      text('group-help', 'Choose one of your audience groups. The group owner is included automatically. Manage its other members through normal audience controls.')
    ]),
    field('groupName', 'New private group name', 'Thingtime admin', 'Create a group you own, or select an existing group above. Creation does not add other people.', 'reporting.group-name'),
    button('create-group', 'Create private group', 'reporting.create-group', 'createDisabled'),
    when('group-notice', 'hasGroupNotice', [text('group-notice-copy', '{reporting.groupNotice}')])
  ], { display: 'grid', gap: '16px', 'min-width': '0' })]),
  when('error', 'hasError', [element('error-text', 'p', '{reporting.error}', { role: 'alert' }, undefined, { color: 'var(--tt-error, #b83232)', 'font-size': '14px', margin: '0', 'overflow-wrap': 'anywhere' })]),
  when('notice', 'hasNotice', [element('notice-text', 'p', '{reporting.notice}', { role: 'status' }, undefined, { margin: '0', 'font-size': '13px', 'line-height': '1.6', 'overflow-wrap': 'anywhere' })]),
  element('actions', 'div', undefined, {}, [
    when('save-ready', 'ready', [button('save', '{reporting.saveLabel}', 'reporting.save', 'saveDisabled')]),
    button('reload', 'Reload saved settings', 'reporting.reload', 'reloadDisabled'),
    when('conflict', 'conflict', [button('reset', 'Use saved configuration', 'reporting.reset', 'disabled')]),
    when('dirty', 'dirty', [text('dirty-text', 'Unsaved changes')])
  ], { display: 'flex', gap: '12px', 'flex-wrap': 'wrap', 'align-items': 'center', 'min-width': '0' })
], { display: 'grid', gap: '16px', 'min-width': '0', border: '1px solid var(--tt-border, #ececef)', 'border-radius': 'var(--tt-radius-lg, 16px)', background: 'var(--tt-card, #fff)', padding: '20px' })];
