import assert from 'node:assert/strict';
import test from 'node:test';
import { discussionAttachmentMap } from './discussionAttachments';
test('discussion readback retains all 27 files in stored order while excluding independently unauthorized rows', () => {
  const docs = Array.from({ length: 27 }, (_, index) => ({ shareId: `attachment-${index}`, ownerId: 'owner', targetId: 'post', attachmentState: 'ready', attachmentPurpose: 'post', acl: ['tt:inherit'], attachmentSortIndex: 26 - index,
    crystal: { name: `${index}.custom`, size: index, contentType: 'application/octet-stream', mediaKind: 'file' }, moderation: { status: 'skipped' } }));
  const bad = [{ ...docs[0], shareId: 'foreign', ownerId: 'other' }, { ...docs[0], shareId: 'wrong-purpose', attachmentPurpose: 'message' }, { ...docs[0], shareId: 'standalone', acl: ['tt:user'] }];
  const result = discussionAttachmentMap([...bad, ...docs], new Map([['post', { ownerId: 'owner', purpose: 'post' }]]), 'owner').get('post')!;
  assert.equal(result.length, 27);
  assert.deepEqual(result.map(item => item.id), docs.map(doc => doc.shareId).reverse());
});
