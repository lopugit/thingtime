import { literalAttachmentId } from '../Sharing/sharedMediaCore';
import { normalizePublicAttachment } from './attachmentUiCore';
import type { HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import type { PublicAttachment } from './attachmentTypes';

export const isPdfAttachment = (attachment: PublicAttachment): boolean =>
  !attachment.url && (attachment.contentType === 'application/pdf' ||
    (attachment.contentType === 'application/octet-stream' && attachment.detectedContentType === 'application/pdf'));

const buttonStyle = { minHeight: '44px', minWidth: '44px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', borderRadius: '8px', background: 'var(--tt-card, white)', color: 'inherit', cursor: 'pointer' };
const button = (action: string, label: string) => ({ tag: 'button', props: { type: 'button', 'data-tt-pdf': action, style: buttonStyle }, children: [label] });

// Ordinary editable Component nodes own every visible control. The only
// native primitive is the PDF document/page adapter; no iframe or remote viewer.
export const PDF_VIEWER_TEMPLATE = {
  tag: 'div', props: { style: { minWidth: '0', width: '100%' } }, children: [
    { tag: 'div', props: { role: 'toolbar', 'aria-label': 'PDF controls', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '8px', borderBottom: '1px solid var(--tt-border, #ddd)' } }, children: [
      button('previous', 'Previous page'),
      { tag: 'label', props: { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, children: [
        'Page', { tag: 'input', props: { type: 'number', 'aria-label': 'PDF page', 'data-tt-pdf': 'page', min: 1,  style: { ...buttonStyle, width: '70px' } } },
        { tag: 'span', children: ['of ', { tag: 'span', props: { 'data-tt-pdf-value': 'pagesLabel' } }] }
      ] },
      button('next', 'Next page'),
      button('zoom-out', 'Zoom out'),
      { tag: 'output', props: { 'aria-label': 'PDF zoom', 'data-tt-pdf-value': 'zoomLabel', style: { minWidth: '48px', textAlign: 'center' } }, children: ['100%'] },
      button('zoom-in', 'Zoom in'),
      button('fit', 'Fit width'),
      { tag: 'a', props: { 'data-tt-pdf': 'download', style: buttonStyle }, children: ['Download'] }
    ] },
    { tag: 'div', props: { role: 'status', 'aria-live': 'polite', 'data-tt-pdf-value': 'status', style: { minHeight: '24px', padding: '0 8px', fontSize: '13px', color: 'var(--tt-muted, #777)' } }, children: [] },
    { tag: 'div', props: { 'data-tt-pdf': 'error', role: 'alert', style: { padding: '8px' } }, children: [
      { tag: 'p', props: { 'data-tt-pdf-value': 'error' } }, button('retry', 'Retry PDF')
    ] },
    { tag: 'tt-pdf-page' }
  ]
};

export type PdfPresentationState = { page: number; pages: number; pagesLabel: string | number; zoomLabel: string; disabled: boolean; previousDisabled: boolean; nextDisabled: boolean; name: string; downloadUrl: string; status: string; error: string; noError: boolean };
/** Closed local view bindings survive outer Component interpolation. Authored
 * nodes remain independently selectable; no action or executable code is read. */
export function bindPdfPresentation(node: unknown, state: PdfPresentationState): HtmlThingNode {
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (!node || typeof node !== 'object' || Array.isArray(node)) return '';
  const input = node as Record<string, any>, props = { ...input.props };
  const control = props['data-tt-pdf'];
  if (props['data-tt-pdf-value'] === 'status') props['aria-label'] = state.status ? 'Opening PDF' : undefined;
  if (control === 'previous') props.disabled = state.previousDisabled;
  else if (control === 'next') props.disabled = state.nextDisabled;
  else if (['zoom-in', 'zoom-out', 'fit'].includes(control)) props.disabled = state.disabled;
  else if (control === 'page') Object.assign(props, { value: state.page, max: state.pages, disabled: state.disabled });
  else if (control === 'download') Object.assign(props, { href: state.downloadUrl, download: state.name });
  else if (control === 'error') props.hidden = state.noError;
  const value = props['data-tt-pdf-value'];
  const allowed = ['pagesLabel', 'zoomLabel', 'status', 'error'];
  const children = allowed.includes(value) ? [state[value as keyof PdfPresentationState] as string] :
    (Array.isArray(input.children) ? input.children : input.children === undefined ? [] : [input.children]).map((child: unknown) => bindPdfPresentation(child, state));
  return { ...input, props, children };
}

export { usesPdfBlocks, PDF_BUILDER_REQUIREMENTS } from './pdfControlContract';

/** Reusable editable block composition, rather than an opaque native toolbar. */
export function pdfViewerBlocks(attachment: PublicAttachment, prefix = `pdf-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`): Record<string, any>[] {
  let index = 0;
  const block = (node: any): Record<string, any> => {
    const nested = (Array.isArray(node.children) ? node.children : []).filter((value: unknown) => value && typeof value === 'object');
    return { id: `${prefix}-control-${++index}`, type: 'element', tag: node.tag, props: node.props || {},
      text: (Array.isArray(node.children) ? node.children : []).filter((value: unknown) => typeof value === 'string' || typeof value === 'number').join(''),
      ...(nested.length ? { children: nested.map(block) } : {}) };
  };
  return [{ id: `${prefix}-document`, type: 'element', tag: 'tt-pdf', props: { attachment, src: `/api/v1/attachments/content?id=${encodeURIComponent(attachment.id)}` }, children: [block(PDF_VIEWER_TEMPLATE)] }];
}

/** Stored src is the same authority used by discovery, sharing and copy rewrite.
 * Embedded metadata cannot hide a second independently executable reference. */
export function pdfAttachmentFromSource(input: unknown, source: unknown): PublicAttachment | null {
  const id = literalAttachmentId(source);
  if (!id || typeof source !== 'string') return null;
  const parsed = new URL(source, 'https://local.invalid');
  if ([...parsed.searchParams.keys()].some(key => key !== 'id') || parsed.searchParams.getAll('id').length !== 1) return null;
  const attachment = normalizePublicAttachment({ ...(input && typeof input === 'object' ? input : {}), id });
  return attachment && isPdfAttachment(attachment) ? attachment : null;
}
