import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedAttachmentUrl } from './sharedMediaCore';

test('media key transport is restricted to the exact first-party content path', () => {
	const source = '/api/v1/attachments/content?id=fixture&width=320';
	assert.equal(sharedAttachmentUrl(source, 'read-key'), `${source}&key=read-key`);
	assert.equal(sharedAttachmentUrl(source), source);
	for (const value of ['https://external.test/image.png', '//external.test/api/v1/attachments/content?id=x', '/api/v1/attachments/content/other?id=x', '/api/v1/things?id=x', '/api/v1/attachments/content?next=https://external.test']) {
		assert.equal(sharedAttachmentUrl(value, 'read-key'), value);
	}
	assert.equal(sharedAttachmentUrl(`${source}&key=independent`, 'read-key'), `${source}&key=independent`);
});
