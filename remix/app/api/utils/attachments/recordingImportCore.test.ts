import assert from 'node:assert/strict';
import test from 'node:test';
import { isDurableRecordingUpload, prepareRecordingImport } from './recordingImportCore';
import { expiredAttachmentDraftFilter, type AttachmentDoc } from './attachmentStore';

const now = new Date('2026-09-11T00:00:00Z');
const fixture = (): AttachmentDoc => ({
  shareId: 'new-upload', ownerId: 'owner', thingtime: ['attachment'], acl: ['tt:user'],
  attachmentPurpose: 'recording', attachmentImportDraft: true, attachmentState: 'ready',
  attachmentExpiresAt: new Date(now.getTime() + 60_000), objectSizeBytes: 4,
  crystal: { name: 'clip.wav', contentType: 'audio/wav', mediaKind: 'audio', size: 4 },
  objectKey: 'private-object', objectVersionId: 'version', moderation: { status: 'pending' },
  updatedAt: now
} as AttachmentDoc);

test('recording import commits annotations and durability without changing purpose, bytes or moderation', () => {
  const before = fixture();
  const snapshot = structuredClone(before);
  const next = prepareRecordingImport(before, 'owner', 4, { title: 'My recording', description: 'Line one\nLine two' }, now);
  assert.equal(next.attachmentPurpose, 'recording');
  assert.equal(next.attachmentImportDraft, undefined);
  assert.equal(next.attachmentExpiresAt, undefined);
  assert.equal(next.crystal.title, 'My recording');
  assert.equal(next.objectKey, before.objectKey);
  assert.equal(next.objectVersionId, before.objectVersionId);
  assert.deepEqual(next.moderation, { status: 'pending' });
  assert.deepEqual(next.acl, ['tt:user']);
  assert.deepEqual(before, snapshot);
  assert.throws(() => prepareRecordingImport(next, 'owner', 4, {}, now), /fresh/);
});

test('import cannot reuse old recordings, other owners, bound media or another upload purpose', () => {
  for (const patch of [
    { attachmentImportDraft: undefined }, { ownerId: 'another' }, { targetId: 'existing-post' },
    { attachmentPurpose: 'post' }, { attachmentPurpose: 'message' }, { attachmentProfileSlot: 'avatar' },
    { attachmentLinked: true }, { attachmentState: 'pending' }, { attachmentState: 'finalizing' }, { attachmentState: 'deleting' },
    { attachmentExpiresAt: undefined }, { attachmentExpiresAt: now }, { attachmentExpiresAt: new Date(NaN) },
    { objectSizeBytes: 5 }
  ]) assert.throws(() => prepareRecordingImport({ ...fixture(), ...patch } as AttachmentDoc, 'owner', 4, {}, now), /fresh/);
  for (const bytes of [-1, 3, 4.5, NaN, Infinity]) assert.throws(() => prepareRecordingImport(fixture(), 'owner', bytes, {}, now), /fresh/);
});

test('ordinary recordings remain durable and imports remain drafts until committed', () => {
  assert.equal(isDurableRecordingUpload(fixture()), false);
  assert.equal(isDurableRecordingUpload({ attachmentPurpose: 'recording' }), true);
  assert.equal(isDurableRecordingUpload({ attachmentPurpose: 'post' }), false);
  assert.equal(isDurableRecordingUpload({}), false);
});

test('expired recording import drafts enter cleanup without sweeping durable recordings', () => {
  const filter = expiredAttachmentDraftFilter(now, 'owner');
  assert.deepEqual(filter.attachmentExpiresAt, { $lte: now });
  assert.deepEqual((filter.$or as any[])[1], {
    targetId: { $exists: false }, attachmentState: 'ready',
    $or: [{ attachmentPurpose: { $ne: 'recording' } }, { attachmentPurpose: 'recording', attachmentImportDraft: true }]
  });
});
