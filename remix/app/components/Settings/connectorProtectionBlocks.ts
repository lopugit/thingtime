import { CONNECTOR_CONFIRMATION_ACTIONS, type ConnectorConfirmationAction } from '~/api/utils/chatgpt/connectorProtections';
import type { WebpageBlock } from '../Builder/webpageBlocks';

const labels: Record<ConnectorConfirmationAction, string> = {
  create: 'Create Things',
  update: 'Update Things',
  delete: 'Delete Things',
  share: 'Share Things',
  comment: 'Comment on Things',
  reaction: 'Change reactions',
  save: 'Save or unsave Things',
  disconnect: 'Disconnect an account',
  workflow: 'Apply or cancel workflows',
  undo: 'Apply an undo plan'
};

const element = (id: string, tag: string, options: {
  text?: string; props?: Record<string, unknown>; css?: Record<string, string>; children?: WebpageBlock[];
} = {}): WebpageBlock => ({ id: 'connector-protections-' + id, type: 'element', tag, ...options });

const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock =>
  ({ id: 'connector-protections-' + id, type: 'condition', condition: { arg, equals: true }, children });

const action = (operation: string, inputs: Record<string, string> = {}) => ({
  'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs }
});

const prose = {
  margin: '0', 'font-size': '13px', 'line-height': '1.6',
  color: 'var(--tt-text, #5a5a66)', 'overflow-wrap': 'anywhere'
};
const emphasis = { margin: '0', 'font-size': '14px', 'font-weight': '600', color: 'var(--tt-ink, #16161a)' };
const row = { display: 'flex', 'align-items': 'center', gap: '10px', 'min-width': '0', 'min-height': '44px' };

const checkbox = (key: ConnectorConfirmationAction | 'all', label: string): WebpageBlock => element(key + '-row', 'label', {
  css: { ...row, cursor: 'pointer', 'overflow-wrap': 'anywhere' },
  children: [
    element(key + '-input', 'input', {
      props: {
        type: 'checkbox', checked: key === 'all' ? '{policy.allChecked}' : `{policy.confirmations.${key}}`,
        'aria-disabled': '{policy.controlsUnavailable}', ...(key === 'all' ? { 'aria-checked': '{policy.masterChecked}' } : {}),
        ...action('confirmation.change', { key })
      },
      css: { width: '17px', height: '17px', margin: '0', 'flex-shrink': '0', cursor: 'inherit', 'accent-color': 'var(--tt-accent, #805ad5)' }
    }),
    element(key + '-label', 'span', {
      text: label, css: { ...emphasis, 'font-weight': key === 'all' ? '600' : '500' }
    })
  ]
});

/** Reusable platform defaults. Saved per-account layouts are private Things;
 * live policy booleans and all write authority stay in the scoped adapter. */
export const CONNECTOR_PROTECTION_BLOCKS: WebpageBlock[] = [
  element('section', 'details', {
    props: { open: true },
    css: {
      'min-width': '0', background: 'var(--tt-card, #fff)', border: '1px solid var(--tt-border, #ececef)',
      'border-radius': 'var(--tt-radius-lg, 16px)'
    },
    children: [
      element('summary', 'summary', {
        css: { cursor: 'pointer', padding: 'clamp(16px, 3vw, 20px)' },
        children: [
          element('heading', 'span', { text: 'Thingtime connector confirmations', css: emphasis }),
          element('description', 'span', {
            text: 'Choose which actions require your confirmation in connected AI apps, including ChatGPT and Codex.',
            css: { ...prose, display: 'block', 'margin-top': '4px' }
          })
        ]
      }),
      element('contents', 'div', {
        css: { padding: 'clamp(16px, 3vw, 20px)', 'border-top': '1px solid var(--tt-border, #ececef)' },
        children: [
          element('guidance', 'p', {
            text: 'These choices apply to this Thingtime account. Your AI app may still ask for approval, and Thingtime still checks permissions and validates changes. Workflows and undo also follow the settings for the actions in their plans.',
            css: { ...prose, 'margin-bottom': '12px' }
          }),
          element('fields', 'fieldset', {
            props: { 'aria-label': 'Confirmation preferences', 'aria-busy': '{policy.busy}' },
            css: { border: '0', margin: '0', padding: '0', 'min-width': '0', 'min-height': '275px' },
            children: [
              element('master', 'div', { css: row, children: [
                when('master-ready', 'policy.ready', [checkbox('all', 'Require confirmation for all actions')]),
                when('busy', 'policy.busy', [
                  element('progress', 'progress', {
                    props: { 'aria-label': '{policy.progressLabel}' },
                    css: { width: '38px', height: '5px', 'flex-shrink': '0', 'accent-color': 'var(--tt-accent, #805ad5)' }
                  })
                ])
              ] }),
              element('choices', 'div', {
                props: { style: { visibility: '{policy.readyVisibility}' } },
                css: {
                  display: 'grid', 'grid-template-columns': 'repeat(auto-fit, minmax(min(100%, 21rem), 1fr))',
                  'column-gap': '20px', 'border-top': '1px solid var(--tt-border, #ececef)'
                },
                children: CONNECTOR_CONFIRMATION_ACTIONS.map(key => checkbox(key, labels[key]))
              }),
              when('error-visible', 'policy.hasError', [
                element('error-row', 'div', {
                  css: { ...row, 'flex-wrap': 'wrap', 'margin-top': '8px', 'padding-inline-end': '54px' },
                  children: [
                    element('error', 'p', { text: '{policy.error}', props: { role: 'alert' }, css: prose }),
                    element('retry', 'button', {
                      text: 'Reload settings', props: { type: 'button', 'aria-disabled': '{policy.busy}', ...action('confirmation.reload') },
                      css: { ...emphasis, cursor: 'pointer', padding: '8px 12px', 'min-height': '44px', border: '1px solid var(--tt-border, #ececef)', 'border-radius': 'var(--tt-radius-sm, 9px)' }
                    })
                  ]
                })
              ])
            ]
          })
        ]
      })
    ]
  })
];
