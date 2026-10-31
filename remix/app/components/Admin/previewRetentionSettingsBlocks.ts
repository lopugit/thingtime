import type { WebpageBlock } from '../Builder/webpageBlocks';
const prefix = 'preview-retention-';
const element = (id: string, tag: string, text?: string, props: Record<string, unknown> = {}, children?: WebpageBlock[], css: Record<string, string> = {}): WebpageBlock =>
  ({ id: prefix + id, type: 'element', tag, ...(text === undefined ? {} : { text }), props, ...(children ? { children } : {}), css });
const text = (id: string, content: string) => element(id, 'p', content, {}, undefined,
  { margin: '0', 'font-size': '13px', 'line-height': '1.6', color: 'var(--tt-text, #5a5a66)', 'overflow-wrap': 'anywhere' });
const when = (id: string, arg: string, children: WebpageBlock[]): WebpageBlock => ({ id: prefix + id, type: 'condition', condition: { arg, equals: true }, children });
const action = (operation: string) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } });
const inputCss = { 'min-height': '44px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': 'var(--tt-radius-sm, 9px)', background: 'var(--tt-card, #fff)', color: 'var(--tt-ink, #16161a)', 'max-width': '100%', 'min-width': '0', 'box-sizing': 'border-box' };
const field = (id: string, label: string, property: string, minimum: number, operation: string): WebpageBlock => element(id + '-field', 'div', undefined, {}, [
  element(id + '-label', 'label', label, { htmlFor: `{retention.ids.${property}}` }, undefined, { display: 'block', 'font-size': '14px', 'margin-bottom': '6px' }),
  element(id + '-input', 'input', undefined, { id: `{retention.ids.${property}}`, name: property, type: 'number', inputmode: 'numeric', min: minimum, step: 1, value: `{retention.${property}}`, disabled: '{retention.disabled}', ...action(operation) }, undefined, { ...inputCss, width: '180px' })
]);
const toggle = (id: string, label: string, hint: string, property: string, operation: string): WebpageBlock => element(id + '-row', 'div', undefined, {}, [
  element(id + '-copy', 'div', undefined, {}, [
    element(id + '-label', 'label', label, { htmlFor: `{retention.ids.${property}}` }, undefined, { 'font-size': '14px', 'line-height': '1.5', display: 'block' }),
    text(id + '-hint', hint)
  ], { 'min-width': '0', flex: '1 1 220px' }),
  element(id + '-hit', 'label', undefined, { htmlFor: `{retention.ids.${property}}` }, [
    element(id + '-input', 'input', undefined, { id: `{retention.ids.${property}}`, name: property, type: 'checkbox', checked: `{retention.${property}}`, disabled: '{retention.disabled}', ...action(operation) }, undefined,
      { width: '24px', height: '24px', margin: '0', cursor: 'pointer', 'accent-color': 'var(--tt-accent, #805ad5)' })
  ], { display: 'grid', 'place-items': 'center', 'min-width': '44px', 'min-height': '44px', cursor: 'pointer' })
], { display: 'flex', 'align-items': 'center', 'flex-wrap': 'wrap', gap: '12px', 'min-width': '0' });
const section = (id: string, title: string, description: string, summary: string, children: WebpageBlock[]) => element(id, 'details', undefined, { open: true }, [
  element(id + '-summary', 'summary', undefined, {}, [
    element(id + '-head', 'span', undefined, {}, [
      element(id + '-title', 'span', title, {}, undefined, { display: 'block', 'font-size': '14px', 'font-weight': '600', color: 'var(--tt-ink, #16161a)' }),
      element(id + '-description', 'span', description, {}, undefined, { display: 'block', 'margin-top': '4px', 'font-size': '13px', 'line-height': '1.6', color: 'var(--tt-text, #5a5a66)' }),
      element(id + '-status', 'span', summary, {}, undefined, { display: 'block', 'margin-top': '8px', 'font-size': '12px', color: 'var(--tt-muted, #777783)' })
    ], { 'min-width': '0', flex: '1' }),
    element(id + '-disclosure', 'span', '⌄', { 'aria-hidden': true }, undefined, { 'font-size': '20px', 'flex-shrink': '0' })
  ], { padding: '20px', cursor: 'pointer', display: 'flex', gap: '12px', 'align-items': 'flex-start', 'list-style': 'none' }),
  element(id + '-contents', 'div', undefined, {}, children, { padding: '20px', 'border-top': '1px solid var(--tt-border, #ececef)', display: 'grid', gap: '16px', 'min-width': '0' })
], { border: '1px solid var(--tt-border, #ececef)', 'border-radius': 'var(--tt-radius-lg, 16px)', background: 'var(--tt-card, #fff)', 'min-width': '0' });

/** Every visual element is an ordinary editable block. Only scoped operations
 * stay in the host; saved layouts cannot add authority or external sources. */
export const PREVIEW_RETENTION_SETTINGS_BLOCKS: WebpageBlock[] = [
  element('layout', 'div', undefined, {}, [
    section('cleanup', 'Vercel preview retention', 'Control automatic cleanup of deployment snapshots for this repository. Changes apply to the next protected controller run.', '{retention.cleanupSummary}', [
      when('loading', 'retention.coldLoading', [element('loading-text', 'p', 'Reading the saved policy…', { role: 'status' })]),
      when('policy-ready', 'retention.ready', [
        toggle('enabled', 'Automatic preview cleanup', 'Pause deployment deletion without changing the saved retention rules.', 'enabled', 'policy.enabled'),
        field('orphan-grace', 'Closed or missing PR grace period (hours)', 'noOpenPrGraceHours', 0, 'policy.orphan-grace'),
        text('orphan-help', '0 removes eligible previews on the next run. Tagged previews count from the later of deployment creation or PR closure; untagged branch snapshots count from creation.'),
        toggle('superseded', 'Remove superseded previews on active PRs', 'Keep the newest ready preview for the current PR head and all active builds. Older snapshots become eligible after the grace period.', 'pruneSupersededOpenPr', 'policy.superseded'),
        when('superseded-fields', 'retention.pruneSupersededOpenPr', [field('superseded-grace', 'Superseded preview grace period (hours)', 'supersededGraceHours', 0, 'policy.superseded-grace')])
      ])
    ]),
    when('liveliness-ready', 'retention.ready', [section('liveliness', 'Pull request liveliness', 'Choose when an open PR stops keeping its previews alive. This never closes or edits a pull request.', '{retention.livelinessSummary}', [
      toggle('inactive', 'Expire previews for inactive open PRs', 'Opt in to removing all previews for an open PR after the chosen number of days since its last PR update on GitHub. Preview publishing stays suspended until that PR becomes active again.', 'inactiveEnabled', 'policy.inactive'),
      when('inactive-fields', 'retention.inactiveEnabled', [field('inactive-days', 'Days without PR activity', 'inactivePullRequestDays', 1, 'policy.inactive-days')])
    ])]),
    element('protection', 'div', undefined, {}, [
      element('protection-title', 'h3', 'Always protected', {}, undefined, { margin: '0', 'font-size': '14px', 'font-weight': '600' }),
      text('protection-copy', 'Production, stable environment and gateway deployments, protected aliases and resources outside the configured project remain protected. An unavailable or invalid policy preserves deployments.')
    ], { padding: '16px', 'border-radius': 'var(--tt-radius-md, 12px)', background: 'var(--tt-surface-alt, #f5f5f7)', display: 'grid', gap: '6px' }),
    when('error', 'retention.hasError', [element('error-text', 'p', '{retention.error}', { role: 'alert' }, undefined, { color: 'var(--tt-error, #b83232)', 'font-size': '14px', margin: '0' })]),
    element('actions', 'div', undefined, {}, [
      when('save-ready', 'retention.ready', [element('save', 'button', '{retention.saveLabel}', { type: 'button', disabled: '{retention.saveDisabled}', ...action('policy.save') }, undefined,
        { ...inputCss, cursor: 'pointer', 'font-weight': '600', background: 'var(--tt-accent, #805ad5)', color: 'white' })]),
      element('reload', 'button', 'Reload saved policy', { type: 'button', disabled: '{retention.reloadDisabled}', ...action('policy.reload') }, undefined, { ...inputCss, cursor: 'pointer' }),
      when('dirty', 'retention.dirty', [text('dirty-text', 'Unsaved changes')])
    ], { display: 'flex', gap: '12px', 'flex-wrap': 'wrap', 'align-items': 'center', 'min-width': '0' })
  ], { display: 'grid', gap: '16px', 'min-width': '0' })
];
