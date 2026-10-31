import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHIVE_DOWNLOAD_COMMAND, ARCHIVE_SHARE_COMMAND, archiveNounForKinds, archiveShareDescription, archiveErrorMessage, buildArchiveMenuSection } from './attachmentArchiveActions';
import { ATTACHMENT_ARCHIVE_PATH, archiveDownloadLabel, attachmentArchiveShareUrl, attachmentArchiveUrl, downloadableAttachments, formatAttachmentBytes } from './attachmentUiCore';

test('archive URLs point at the first-party endpoint and share links stay canonical (no secret key)', () => {
	assert.equal(attachmentArchiveUrl('post-1'), `${ATTACHMENT_ARCHIVE_PATH}?id=post-1`);
	assert.equal(attachmentArchiveUrl('post-1', { manifest: true }), `${ATTACHMENT_ARCHIVE_PATH}?id=post-1&manifest=1`);
	assert.equal(attachmentArchiveUrl('post 1', { key: 'k&y', sharedRoot: 'page' }), `${ATTACHMENT_ARCHIVE_PATH}?id=post+1&key=k%26y&sharedRoot=page`);
	assert.equal(attachmentArchiveUrl('post-1', { key: '', sharedRoot: '' }), `${ATTACHMENT_ARCHIVE_PATH}?id=post-1`);
	const shared = attachmentArchiveShareUrl('post-1', 'https://thingtime.test');
	assert.equal(shared, `https://thingtime.test${ATTACHMENT_ARCHIVE_PATH}?id=post-1`);
	assert.equal(new URL(shared).searchParams.has('key'), false);
	assert.equal(attachmentArchiveShareUrl('media-1', 'https://thingtime.test', 'page-1'), `https://thingtime.test${ATTACHMENT_ARCHIVE_PATH}?id=media-1&sharedRoot=page-1`);
});

test('only stored attachments count as downloadable and the label reads naturally', () => {
	const stored = { id: 'a', url: undefined } as any;
	const linked = { id: 'b', url: 'https://cdn.test/b.png' } as any;
	assert.deepEqual(downloadableAttachments([stored, linked]), [stored]);
	assert.deepEqual(downloadableAttachments(undefined), []);
	assert.equal(archiveDownloadLabel(1), 'Download all · 1 file');
	assert.equal(archiveDownloadLabel(3, 4_200_000), `Download all · 3 files · ${formatAttachmentBytes(4_200_000)}`);
	assert.match(archiveDownloadLabel(3, 4_200_000), /MiB$/);
	assert.equal(archiveDownloadLabel(2, 0), 'Download all · 2 files');
});

test('the Files menu section offers download + share for archivable Things and hides for empty or bulk targets', () => {
	const post = buildArchiveMenuSection({ fileCount: 3, noun: 'post' });
	assert.ok(post);
	assert.equal(post!.id, 'files');
	assert.deepEqual(post!.actions.map((action) => action.command), [ARCHIVE_DOWNLOAD_COMMAND, ARCHIVE_SHARE_COMMAND]);
	assert.equal(post!.actions[0].label, 'Download all files (3 files)');
	assert.equal(post!.actions[0].lucide, 'folder-down');
	assert.equal(post!.actions[1].label, 'Share download link');
	assert.equal(post!.actions[1].lucide, 'link-2');
	const folder = buildArchiveMenuSection({ fileCount: null, noun: 'folder' });
	assert.equal(folder!.actions[0].label, 'Download all files');
	assert.match(folder!.actions[0].hint || '', /this folder/);
	const media = buildArchiveMenuSection({ fileCount: 1, noun: 'media' });
	assert.equal(media!.actions[0].label, 'Download as ZIP');
	assert.equal(buildArchiveMenuSection({ fileCount: 0, noun: 'post' }), null);
	assert.equal(buildArchiveMenuSection({ fileCount: 5, noun: 'post', bulk: true }), null);
});

test('nouns follow the Thing kind and copy explains the audience contract', () => {
	assert.equal(archiveNounForKinds(['folder']), 'folder');
	assert.equal(archiveNounForKinds(['attachment']), 'media');
	assert.equal(archiveNounForKinds(['post', 'comment']), 'comment');
	assert.equal(archiveNounForKinds(['post']), 'post');
	assert.equal(archiveNounForKinds(['webpage']), 'page');
	assert.equal(archiveNounForKinds(['data']), null);
	assert.match(archiveShareDescription('folder'), /Anyone who can view this folder/);
	assert.match(archiveShareDescription('post'), /wget or curl/);
	assert.equal(archiveErrorMessage({ ok: false, error: 'Thing not found' }), 'Thing not found');
	assert.equal(archiveErrorMessage(new Error('boom')), 'boom');
	assert.equal(archiveErrorMessage(null), 'Try again in a moment.');
});
