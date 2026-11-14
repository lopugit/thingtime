import assert from 'node:assert/strict';
import test from 'node:test';
import { fileMediaReference, fileMediaAttachment, fileMediaPresentation } from './fileMediaPresentation';
const file = { id: 'file-id', thingtime: ['file'], crystal: { name: 'renamed.png', content: { attachmentId: 'attachment-id', version: 'a'.repeat(64), size: 12 } } };
const attachment = { id: 'attachment-id', thingtime: ['attachment'], targetId: file.id, crystal: { name: 'original.png', contentType: 'image/png', mediaKind: 'image', size: 12 } };
test('synchronized file resolves an exact bound attachment and explicit media Component', () => {
 assert.equal(fileMediaReference(file)?.attachmentId, attachment.id);
 const media = fileMediaAttachment(file, attachment)!;
 assert.equal(media.name, 'renamed.png'); assert.equal(media.mediaKind, 'image');
 assert.deepEqual(fileMediaPresentation(media).renderComponent.render, { tag: 'tt-media', props: { attachments: { ttArg: 'attachments' } } });
});
test('foreign, mismatched, unbound and linked metadata cannot become file media', () => {
 for (const patch of [{ id: 'other' }, { targetId: 'other' }, { targetId: null }, { crystal: { ...attachment.crystal, size: 13 } }, { crystal: { ...attachment.crystal, url: 'https://example.com/image.png' } }]) assert.equal(fileMediaAttachment(file, { ...attachment, ...patch }), null);
});
test('explicit declarations, trashed files, symlinks and malformed content never select legacy fallback', () => {
 for (const patch of [{ renderComponent: null }, { renderComponent: { id: 'saved' } }, { trashed: true }, { symbolicLink: { target: 'elsewhere' } }, { content: { ...file.crystal.content, version: 'unverified' } }]) assert.equal(fileMediaReference({ ...file, crystal: { ...file.crystal, ...patch } }), null);
 assert.equal(fileMediaReference({ ...file, thingtime: ['data'] }), null);
});
test('filename cannot elevate active documents into inline images', () => {
 const media = fileMediaAttachment(file, { ...attachment, crystal: { ...attachment.crystal, contentType: 'text/html' } })!;
 assert.equal(media.mediaKind, 'file');
 const sensitive = fileMediaPresentation({ ...media, mediaKind: 'image', nsfw: true }, true);
 assert.equal(sensitive.renderComponent.render.tag, 'tt-media');
});

test('full preview binds structured attachment data through the canonical Component resolver', async () => {
 const { renderComponentNode } = await import('../Thingtime/renderComponentCore');
 const media = fileMediaAttachment(file, attachment)!;
 const presentation = fileMediaPresentation(media);
 const resolved = renderComponentNode(presentation.renderComponent, presentation) as any;
 assert.deepEqual(resolved.props.attachments, [media]);
});
