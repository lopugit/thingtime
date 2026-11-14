import assert from 'node:assert/strict';
import test from 'node:test';
import { isPdfAttachment, PDF_VIEWER_TEMPLATE, bindPdfPresentation } from './pdfPresentation';
import { normalizePublicAttachment } from './attachmentUiCore';
const pdf = normalizePublicAttachment({ id: 'id', name: 'original.pdf', size: 200, contentType: 'application/octet-stream', detectedContentType: 'application/pdf', mediaKind: 'file' })!;
test('PDFs use canonical detected MIME and never suffix or linked URL inference', () => {
 assert.equal(isPdfAttachment(pdf), true);
 assert.equal(isPdfAttachment({ ...pdf, detectedContentType: undefined }), false);
 assert.equal(isPdfAttachment({ ...pdf, url: 'https://elsewhere.invalid/a.pdf' }), false);
});
test('viewer bindings update independently editable controls with closed local values', () => {
 const state = { page: 2, pages: 3, pagesLabel: 3, zoomLabel: '125%', disabled: false, previousDisabled: false, nextDisabled: false, name: 'original.pdf', downloadUrl: '/api/v1/attachments/content?id=id&download=1', status: '', error: '', noError: true };
 const tree = bindPdfPresentation(PDF_VIEWER_TEMPLATE, state) as any;
 const nodes: any[] = []; const walk = (node: any) => { if (node && typeof node === 'object') { nodes.push(node); for (const child of node.children || []) walk(child); } }; walk(tree);
 assert.equal(nodes.find(n => n.props?.['data-tt-pdf'] === 'page').props.value, 2);
 assert.equal(nodes.find(n => n.props?.['data-tt-pdf'] === 'download').props.href, state.downloadUrl);
 assert.equal(nodes.find(n => n.props?.['data-tt-pdf'] === 'error').props.hidden, true);
 assert.ok(nodes.find(n => n.tag === 'tt-pdf-page'));
 assert.ok(!JSON.stringify(PDF_VIEWER_TEMPLATE).includes('{pdf.'));
});

test('PDF controls are individually persisted ordinary Builder elements with media provenance', async () => {
 const { pdfViewerBlocks, usesPdfBlocks, PDF_BUILDER_REQUIREMENTS } = await import('./pdfPresentation');
 const { sanitizeWebpageBlocks } = await import('../../schemas/registry');
 const { compositionAttachmentIds } = await import('../../api/utils/actions/compositionMediaCore');
 const { capabilitySatisfies } = await import('../../api/utils/capabilities/capabilityContract');
 const blocks = pdfViewerBlocks({ ...pdf, id: 'attachment-pdf-123' });
 const result = sanitizeWebpageBlocks(blocks); assert.equal(result.ok, true);
 assert.equal(usesPdfBlocks({ blocks }), true);
 assert.deepEqual([...compositionAttachmentIds(['webpage'], { blocks })], ['attachment-pdf-123']);
 assert.equal(capabilitySatisfies('1.65.0', PDF_BUILDER_REQUIREMENTS['api.things']), false);
 assert.equal(capabilitySatisfies('1.66.0', PDF_BUILDER_REQUIREMENTS['api.things']), false);
 assert.equal(capabilitySatisfies('1.67.0', PDF_BUILDER_REQUIREMENTS['api.things']), true);
 assert.equal(capabilitySatisfies('1.29.0', PDF_BUILDER_REQUIREMENTS['api.things-update']), false);
 assert.equal(capabilitySatisfies('1.30.0', PDF_BUILDER_REQUIREMENTS['api.things-update']), true);
});

test('copied PDF consumes the rewritten canonical source; hidden metadata ids cannot execute', async () => {
 const { pdfAttachmentFromSource, pdfViewerBlocks } = await import('./pdfPresentation');
 const { sanitizeWebpageBlocks } = await import('../../schemas/registry');
 const source = { ...pdf, id: 'source-private-pdf' };
 assert.equal(pdfAttachmentFromSource(source, undefined), null);
 assert.equal(pdfAttachmentFromSource(source, 'https://foreign.invalid/file.pdf'), null);
 assert.equal(pdfAttachmentFromSource(source, '/api/v1/attachments/content?id=owned-copy&id=source-private-pdf'), null);
 // This is the existing private-copy protocol: only canonical media URLs are
 // rewritten; source metadata IDs remain inert. Revoking the old ID cannot
 // affect the sole byte request identity selected from copied src.
 const copied = pdfAttachmentFromSource(source, '/api/v1/attachments/content?id=independent-owned-copy');
 assert.equal(copied?.id, 'independent-owned-copy'); assert.notEqual(copied?.id, source.id);
 assert.equal(sanitizeWebpageBlocks([...pdfViewerBlocks(source), ...pdfViewerBlocks(source)]).ok, true);
});
