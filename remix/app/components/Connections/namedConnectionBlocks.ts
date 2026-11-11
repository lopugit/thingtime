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

/** Upgrade the old unsupported input prop while preserving the saved layout. */
export function migrateNamedConnectionForm(blocks: WebpageBlock[]): WebpageBlock[] {
  return blocks.map(block => {
    const children = block.children ? migrateNamedConnectionForm(block.children) : undefined;
    const next = { ...block, ...(children ? { children } : {}) };
    if (block.id === 'named-name-field') {
      const { defaultValue, ...props } = block.props || {};
      next.props = { ...props, ...(!('value' in props) ? { value: defaultValue ?? '{named.name}' } : {}),
        'aria-invalid': '{named.nameInvalid}', 'aria-describedby': 'named-form-error' };
    }
    if (block.id === 'named-form-group' && children && !children.some(child => child.id === 'named-form-error')) {
      const index = children.findIndex(child => child.id === 'named-form-submit');
      next.children = [...children.slice(0, index < 0 ? children.length : index), namedFormError,
        ...children.slice(index < 0 ? children.length : index)];
    }
    return next;

/** Upgrade the old unsupported input prop while preserving the saved layout. */
export function migrateNamedConnectionForm(blocks: WebpageBlock[]): WebpageBlock[] {
  return blocks.map(block => {
    const children = block.children ? migrateNamedConnectionForm(block.children) : undefined;
    const next = { ...block, ...(children ? { children } : {}) };
    if (block.id === 'named-name-field') {
      const { defaultValue, ...props } = block.props || {};
      next.props = { ...props, ...(!('value' in props) ? { value: defaultValue ?? '{named.name}' } : {}),
        'aria-invalid': '{named.nameInvalid}', 'aria-describedby': 'named-form-error' };
    }
    if (block.id === 'named-form-group' && children && !children.some(child => child.id === 'named-form-error')) {
      const index = children.findIndex(child => child.id === 'named-form-submit');
      next.children = [...children.slice(0, index < 0 ? children.length : index), namedFormError,
        ...children.slice(index < 0 ? children.length : index)];
    }
    return next;
  });
}
