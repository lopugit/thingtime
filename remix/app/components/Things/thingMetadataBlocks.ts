import type { WebpageBlock } from '../Builder/webpageBlocks';

const muted = 'var(--tt-muted, #5a5a66)';
const border = '1px solid var(--tt-border, #ececef)';
const buttonStyle = {
  'min-height': '44px', padding: '0 12px', display: 'inline-flex', 'align-items': 'center',
  border, 'border-radius': '10px', cursor: 'pointer', 'font-size': '0.875rem', 'font-weight': '600',
};
const labelStyle = { color: muted, 'font-size': '0.875rem', 'font-weight': '600' };
const valueStyle = { 'font-size': 'clamp(1.25rem, 4vw, 1.625rem)', 'font-weight': '700', 'line-height': '1.2', 'overflow-wrap': 'anywhere', 'font-variant-numeric': 'tabular-nums' };

const element = (id: string, tag: string, options: Omit<WebpageBlock, 'id' | 'type' | 'tag'> = {}): WebpageBlock =>
  ({ id: `thing-metadata-${id}`, type: 'element', tag, ...options });
const condition = (id: string, condition: Record<string, unknown>, children: WebpageBlock[]): WebpageBlock =>
  ({ id: `thing-metadata-${id}`, type: 'condition', condition, children });
const show = (id: string, arg: string, children: WebpageBlock[]) => condition(id, { arg }, children);
const size = (id: string, arg: string, css = valueStyle) =>
  element(id, 'span', { format: { kind: 'bytes', arg }, css });
const exact = (id: string, label: string, arg: string) => element(id, 'div', { children: [
  element(`${id}-label`, 'dt', { text: label, css: labelStyle }),
  element(`${id}-value`, 'dd', { css: { margin: '0' }, children: [
    element(`${id}-number`, 'span', { format: { kind: 'number', arg } }),
    element(`${id}-unit`, 'span', { text: ' bytes' }),
  ] }),
] });

const panel = (children: WebpageBlock[]) => element('panel', 'section', {
  props: { 'aria-label': 'Thing metadata', id: 'thing-metadata' },
  css: {
    display: 'grid', gap: '14px', 'min-width': '0', padding: 'clamp(14px, 3vw, 20px)',
    background: 'var(--tt-card, #ffffff)', border, 'border-radius': 'var(--tt-radius-lg, 16px)',
    'box-shadow': 'var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))',
  },
  children,
});

const heading = element('heading', 'h2', {
  text: 'Thing metadata', css: { 'font-size': '1rem', 'font-weight': '700' },
});

const metrics = element('metrics', 'dl', {
  css: { display: 'flex', 'flex-wrap': 'wrap', gap: '12px', margin: '0', 'min-height': '79px' },
  children: [
    element('file-tile', 'div', { css: {
      flex: '1 1 180px', 'min-width': '0', display: 'grid', 'align-content': 'start', gap: '3px', padding: '12px',
      'border-radius': '10px', background: 'var(--tt-surface, #fafafb)', 'border-inline-start': '3px solid var(--tt-accent, #e24697)',
    }, children: [
      element('file-label', 'dt', { text: 'File data', css: labelStyle }),
      element('file-value', 'dd', { css: { margin: '0' }, children: [
        condition('no-files', { arg: 'attachmentCount', equals: 0 }, [
          element('no-files-label', 'span', { text: 'No attached files', css: valueStyle }),
        ]),
        condition('files', { arg: 'attachmentCount', op: 'gt', value: 0 }, [size('file-size', 'attachedBytes')]),
        element('file-description', 'span', { text: 'Original attachment bytes', css: { display: 'block', color: muted, 'font-size': '0.75rem' } }),
      ] }),
    ] }),
    element('json-tile', 'div', { css: {
      flex: '1 1 180px', 'min-width': '0', display: 'grid', 'align-content': 'start', gap: '3px', padding: '12px',
      'border-radius': '10px', background: 'var(--tt-surface, #fafafb)',
    }, children: [
      element('json-label', 'dt', { text: 'Thing data', css: labelStyle }),
      element('json-value', 'dd', { css: { margin: '0' }, children: [
        size('json-size', 'jsonBytes'),
        element('json-description', 'span', { text: 'Saved JSON, excluding file contents and system fields', css: { display: 'block', color: muted, 'font-size': '0.75rem' } }),
      ] }),
    ] }),
  ],
});

const details = element('details', 'details', { children: [
  element('summary', 'summary', { text: 'Details', css: {
    'min-height': '44px', padding: '11px 0', cursor: 'pointer', 'font-weight': '600', 'font-size': '0.875rem',
  } }),
  element('facts', 'dl', {
    css: { display: 'grid', gap: '8px', margin: '0', padding: '0 0 4px', 'overflow-wrap': 'anywhere' },
    children: [
      exact('json-exact', 'Exact Thing data size', 'jsonBytes'),
      condition('file-exact-visible', { arg: 'attachedBytes', op: 'notEmpty' }, [
        exact('file-exact', 'Exact file data size', 'attachedBytes'),
      ]),
      condition('file-incomplete', { arg: 'unavailableAttachmentCount', op: 'gt', value: 0 }, [
        element('unavailable-file-count', 'div', { children: [
          element('unavailable-file-label', 'dt', { text: 'Attachments with unavailable size', css: labelStyle }),
          element('unavailable-file-value', 'dd', { text: '{unavailableAttachmentCount} of {attachmentCount}' }),
        ] }),
        condition('known-file-visible', { arg: 'knownAttachedBytes', op: 'gt', value: 0 }, [
          exact('known-file-exact', 'Known file bytes (partial total)', 'knownAttachedBytes'),
        ]),
      ]),
      element('hash', 'div', { children: [
        element('hash-label', 'dt', { text: 'Source hash · SHA-256', css: labelStyle }),
        element('hash-value', 'dd', { children: [element('hash-code', 'code', { text: '{sourceHash}', css: { 'overflow-wrap': 'anywhere', 'word-break': 'break-word', 'font-size': '0.8125rem' } })] }),
      ] }),
      element('canonical', 'div', { children: [
        element('canonical-label', 'dt', { text: 'Canonical format', css: labelStyle }),
        element('canonical-version', 'dd', { text: 'Version {canonicalVersion}' }),
      ] }),
    ],
  }),
] });

const sourceLink = element('source-link', 'a', {
  text: 'Open source Thing', props: { href: '{sourceHref}' }, css: buttonStyle,
});

// This projection shares the individual presentation nodes with the editable
// layout. Only the inert intrinsic subset enters the saved metadata Thing.
const toRenderNode = (block: WebpageBlock): Record<string, unknown> => {
  if (block.type === 'condition') {
    return { ttIf: { ...block.condition, then: block.children?.map(toRenderNode) ?? [] } };
  }
  const style = Object.fromEntries(Object.entries(block.css ?? {})
    .map(([key, value]) => [key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()), value]));
  const children = block.format ? [{ ttFormat: block.format }] : block.children?.map(toRenderNode) ?? block.text ?? [];
  return { tag: block.tag, props: { ...block.props, style }, children };
};

export const thingMetadataRenderComponent = {
  name: 'Thing metadata',
  library: 'custom',
  category: 'general',
  render: toRenderNode(panel([heading, metrics, details, show('source-link-visible', 'sourceHref', [sourceLink])])),
};

const refresh = element('refresh', 'button', {
  text: '{refreshLabel}', props: { type: 'button', 'aria-disabled': '{busy}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'refresh' } },
  css: buttonStyle,
});
const progress = element('progress', 'progress', {
  props: { 'aria-label': 'Checking Thing metadata' },
  css: { width: '30px', height: '6px', 'accent-color': 'var(--tt-accent, #e24697)' },
});

export const thingMetadataBlocks: WebpageBlock[] = [panel([
  element('header', 'div', { props: { 'aria-busy': '{busy}' }, css: {
    display: 'flex', 'align-items': 'center', gap: '10px', 'min-height': '24px',
  }, children: [heading, show('checking', 'busy', [progress])] }),
  show('unavailable-visible', 'unavailable', [
    element('unavailable', 'p', { text: '{unavailable}', css: { 'font-size': '0.875rem', color: muted } }),
  ]),
  show('error-visible', 'error', [
    element('error', 'p', { text: '{error}', props: { role: 'alert' }, css: { 'font-size': '0.875rem', color: muted } }),
  ]),
  show('cold-space-visible', 'reserveSpace', [
    element('cold-space', 'div', { props: { 'aria-hidden': true }, css: { 'min-height': '79px' } }),
  ]),
  show('metrics-visible', 'ready', [metrics]),
  show('actions-visible', 'showActions', [
    element('actions', 'div', { css: { display: 'flex', 'flex-wrap': 'wrap', gap: '8px' }, children: [
      show('reference-visible', 'metadataHref', [
        element('reference', 'a', { text: 'Open metadata Thing', props: { href: '{metadataHref}' }, css: buttonStyle }),
      ]),
      refresh,
    ] }),
  ]),
  show('facts-visible', 'ready', [
    details,
    condition('reference-status-visible', { arg: 'error', op: 'empty' }, [
      element('reference-status', 'p', { text: '{referenceStatus}', css: { 'font-size': '0.75rem', color: muted } }),
    ]),
  ]),
])];
