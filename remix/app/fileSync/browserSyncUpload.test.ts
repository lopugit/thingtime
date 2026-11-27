import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsSyncUploadStreaming } from './browserSyncUpload';
test('request-stream gate refuses missing/throwing or silently stringifying WebKit implementations without network', () => {
 assert.equal(supportsSyncUploadStreaming(), true);
 assert.equal(supportsSyncUploadStreaming(class { constructor() { throw Error('unsupported'); } } as unknown as typeof Request), false);
 assert.equal(supportsSyncUploadStreaming(class { headers = new Headers({ 'Content-Type': 'text/plain' }); } as unknown as typeof Request), false);
});
