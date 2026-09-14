import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubspaceMedia, subspaceMediaUrl, subspaceAttachmentTargetAllows } from './subspaceMediaCore';

test('subspace image mutations reject malformed input and hostile URLs', () => {
  for (const input of [null, [], { icon: null }, { unknown: { kind: 'clear' } }, { icon: { kind: 'attachment', attachmentId: '../secret' } }, { banner: { kind: 'external', url: 'javascript:alert(1)' } }, { icon: { kind: 'external', url: 'https://user:pass@example.com/a.png' } }]) assert.throws(() => parseSubspaceMedia(input));
  assert.deepEqual(parseSubspaceMedia({ icon: { kind: 'attachment', attachmentId: 'image-id' }, banner: { kind: 'external', url: 'https://example.com/banner.png' } }), { icon: { kind: 'attachment', attachmentId: 'image-id' }, banner: { kind: 'external', url: 'https://example.com/banner.png' } });
  assert.deepEqual(parseSubspaceMedia(undefined), {});
  assert.deepEqual(parseSubspaceMedia({ icon: { kind: 'clear' } }), { icon: { kind: 'clear' } });
});

test('branding projections prefer managed content and preserve legacy external URLs', () => {
  const doc = { iconAttachmentId: 'image-id', crystal: { branding: { iconUrl: 'https://example.com/old.png', bannerUrl: 'https://example.com/banner.png' } } };
  assert.equal(subspaceMediaUrl(doc, 'icon'), '/api/v1/attachments/content?id=image-id');
  assert.equal(subspaceMediaUrl(doc, 'banner'), 'https://example.com/banner.png');
});

test('public branding content requires exact live subspace and purpose-specific slot', () => {
  const attachment = { shareId: 'image-id', targetId: 'space', attachmentPurpose: 'subspace-icon' };
  const target = { shareId: 'space', thingtime: ['subspace'], iconAttachmentId: 'image-id', crystal: { access: 'private' } };
  assert.equal(subspaceAttachmentTargetAllows(attachment, target), true);
  for (const other of [null, { ...target, shareId: 'other' }, { ...target, thingtime: ['post'] }, { ...target, thingtime: ['subspace', 'post'] }, { ...target, iconAttachmentId: 'replacement' }]) assert.equal(subspaceAttachmentTargetAllows(attachment, other), false);
  assert.equal(subspaceAttachmentTargetAllows({ ...attachment, attachmentPurpose: 'subspace-banner' }, target), false);
  assert.equal(subspaceAttachmentTargetAllows({ ...attachment, attachmentPurpose: 'profile' }, target), false);
});
