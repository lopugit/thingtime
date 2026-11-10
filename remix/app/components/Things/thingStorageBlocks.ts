import type { WebpageBlock } from '../Builder/webpageBlocks';
import { storagePlacements } from './thingStorageClient';

const muted = 'var(--tt-muted, #5a5a66)';
const border = '1px solid var(--tt-border, #ececef)';
const buttonStyle = {
  'min-height': '44px', padding: '0 12px', border, 'border-radius': '10px',
  cursor: 'pointer', 'font-size': '0.875rem', 'font-weight': '650',
};
const element = (id: string, tag: string, options: Omit<WebpageBlock, 'id' | 'tag' | 'type'> = {}): WebpageBlock =>
  ({ id: `storage-${id}`, type: 'element', tag, ...options });
const show = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock =>
  ({ id: `storage-${id}`, type: 'condition', condition: { arg }, children });
const text = (id: string, value: string, css = {}): WebpageBlock => element(id, 'p', { text: value, css });
const hint = { color: muted, 'font-size': '0.875rem', 'overflow-wrap': 'anywhere' };
const action = (operation: string, inputs: Record<string, string> = {}) => ({
  'data-tt-action': '$transient',
  'data-tt-action-inputs': { operation, ...inputs },
});
const button = (id: string, label: string, operation: string, disabled: string, opacity?: string) =>
  element(id, 'button', {
    text: label, props: { type: 'button', 'aria-disabled': disabled, ...(opacity ? { style: { opacity } } : {}), ...action(operation) }, css: buttonStyle,
  });

const choices = storagePlacements.map(({ id, label, description }) => element(`choice-${id}`, 'button', {
  props: {
    type: 'button', 'aria-pressed': `{choices.${id}.selected}`, 'aria-disabled': `{choices.${id}.disabled}`,
    style: { borderColor: `{choices.${id}.border}`, background: `{choices.${id}.background}` },
    ...action('choose', { choice: id }),
  },
  css: {
    'min-height': '76px', 'min-width': '0', 'border-width': '1px', 'border-style': 'solid',
    'border-radius': '10px', 'text-align': 'start', display: 'grid', gap: '4px', 'align-content': 'start', padding: '12px',
    cursor: 'pointer', 'overflow-wrap': 'anywhere',
  },
  children: [
    element(`choice-${id}-label`, 'span', { text: label, css: { 'font-size': '0.9375rem', 'font-weight': '650' } }),
    element(`choice-${id}-description`, 'span', { text: description, css: hint }),
    show(`choice-${id}-notice-visible`, `choices.${id}.notice`, [
      element(`choice-${id}-notice`, 'span', { text: `{choices.${id}.notice}`, css: hint }),
    ]),
  ],
}));

const statusRow = (id: string, label: string, value: string) => element(`status-${id}`, 'div', {
  css: { 'min-width': '0' }, children: [
    element(`status-${id}-label`, 'dt', { text: label, css: { ...hint, 'font-weight': '650' } }),
    element(`status-${id}-value`, 'dd', { text: value, css: { margin: '0', 'overflow-wrap': 'anywhere' } }),
  ],
});

export const thingStorageBlocks: WebpageBlock[] = [element('panel', 'details', {
  props: { id: 'thing-storage', open: '{open}' },
  css: {
    background: 'var(--tt-card, #fff)', border, 'border-radius': 'var(--tt-radius-lg, 16px)',
    'box-shadow': 'var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))', 'min-width': '0',
    'scroll-margin-top': 'calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 12px)',
  },
  children: [
    element('summary', 'summary', {
      props: { 'aria-busy': '{busy}' },
      css: { 'min-height': '44px', padding: '12px 16px', cursor: 'pointer', 'font-weight': '700' },
      children: [
        element('title', 'span', { text: 'Storage' }),
        show('progress-visible', 'busy', [element('progress', 'progress', {
          props: { 'aria-label': 'Updating storage settings' },
          css: { width: '30px', height: '6px', 'margin-inline-start': '10px', 'accent-color': 'var(--tt-accent, #e24697)' },
        })]),
      ],
    }),
    element('body', 'div', {
      css: { display: 'grid', gap: '14px', padding: '0 16px 16px', 'min-width': '0' },
      children: [
        show('unavailable-visible', 'unavailable', [text('unavailable', '{unavailable}', hint)]),
        show('error-visible', 'error', [element('error', 'p', { text: '{error}', props: { role: 'alert' }, css: hint })]),
        show('retry-visible', 'canRetry', [element('retry-row', 'div', {
          children: [button('retry', 'Refresh storage status', 'refresh', '{busy}')],
        })]),
        show('ready', 'ready', [
          element('status', 'dl', {
            css: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px 24px', margin: '0' },
            children: [
              statusRow('policy', 'Saved preference', '{policyLabel}'),
              statusRow('device', '{deviceLabel}', '{replicaLabel}'),
            ],
          }),
          show('detail-visible', 'replicaDetail', [text('detail', '{replicaDetail}', hint)]),
          show('open-visible', 'canOpen', [element('open-row', 'div', {
            children: [button('open-copy', '{openLabel}', 'open-copy', '{busy}')],
          })]),
        ]),
        show('editable', 'editable', [
          element('choices', 'fieldset', {
            css: {
              border: '0', margin: '0', padding: '0', 'min-width': '0', display: 'grid',
              'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '8px',
            },
            children: [
              element('choices-legend', 'legend', {
                text: 'Where should this Thing be kept?',
                css: { 'font-size': '0.875rem', 'font-weight': '650', 'margin-bottom': '8px' },
              }),
              ...choices,
            ],
          }),
          show('browser-registration-visible', 'registeringBrowser', [
            text('browser-registration', 'Saving registers this browser so Thingtime can manage its copy.', hint),
          ]),
          element('actions', 'div', { css: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px' }, children: [
            button('save', 'Save storage settings', 'save', '{saveDisabled}', '{saveOpacity}'),
            show('apply-visible', 'canApply', [button('apply', 'Apply on this device', 'apply', '{busy}')]),
            show('cancel-visible', 'workingLocally', [button('cancel', 'Stop local copy operation', 'cancel', '')]),
          ] }),
        ]),
      ],
    }),
  ],
})];
