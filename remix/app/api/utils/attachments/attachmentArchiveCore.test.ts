import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ARCHIVE_ID_PATTERN,
	ArchivePathAllocator,
	archiveDisplayName,
	archiveFileName,
	archiveRootKind,
	formatArchiveLinks,
	safeArchiveSegment,
	shortArchiveId
} from './attachmentArchiveCore';

test('archive roots are posts, comments, pages, folders and media Things only', () => {
	assert.equal(archiveRootKind(['post']), 'post');
	assert.equal(archiveRootKind(['post', 'comment']), 'post');
	assert.equal(archiveRootKind(['webpage']), 'webpage');
	assert.equal(archiveRootKind(['folder']), 'folder');
	assert.equal(archiveRootKind(['attachment']), 'attachment');
	for (const kinds of [['data'], ['schema'], ['chat-message'], [], undefined, null]) assert.equal(archiveRootKind(kinds as any), null);
});

test('zip path segments never carry separators, traversal, control characters or reserved punctuation', () => {
	assert.equal(safeArchiveSegment('../../etc/passwd', 'x'), 'etc passwd');
	assert.equal(safeArchiveSegment('..', 'fallback'), 'fallback');
	assert.equal(safeArchiveSegment('.hidden', 'fallback'), 'hidden');
	assert.equal(safeArchiveSegment('a\\b/c:d*e?f"g<h>i|j', 'x'), 'a b c d e f g h i j');
	// control (tab) and format (zero-width space) characters are dropped outright
	assert.equal(safeArchiveSegment('tab\there null\u200bzw', 'x'), 'tabhere nullzw');
	assert.equal(safeArchiveSegment('   ', 'fallback'), 'fallback');
	assert.equal(safeArchiveSegment(42, 'fallback'), 'fallback');
	assert.equal(safeArchiveSegment('x'.repeat(300), 'fallback').length, 100);
	// trailing dots are stripped even after the length cap
	assert.equal(safeArchiveSegment(`${'y'.repeat(99)}...`, 'fallback'), 'y'.repeat(99));
});

test('long segments lose stem characters, never their extension, and duplicates fold case the way filesystems do', () => {
	const long = safeArchiveSegment(`${'a'.repeat(120)}.jpg`, 'file');
	assert.ok(long.endsWith('.jpg'));
	assert.equal(Array.from(long).length, 100);
	assert.equal(safeArchiveSegment('b'.repeat(300), 'file'), 'b'.repeat(100), 'no extension: plain truncation');
	assert.equal(safeArchiveSegment(`${'c'.repeat(120)}.${'x'.repeat(40)}`, 'file').length, 100, 'an over-long suffix is not an extension');
	const paths = new ArchivePathAllocator();
	assert.equal(paths.claim('', 'ı.jpg'), 'ı.jpg');
	// dotless ı and i collide on case-insensitive filesystems, so the second one is renamed
	assert.equal(paths.claim('', 'I.jpg'), 'I (2).jpg');
});

test('display names prefer folder names, media filenames, page titles and post openers with stable fallbacks', () => {
	assert.equal(archiveDisplayName('folder', { name: 'Recipes 🍜' }, 'folder-1'), 'Recipes 🍜');
	assert.equal(archiveDisplayName('folder', {}, 'folder-abc-123'), 'folder-folderab');
	assert.equal(archiveDisplayName('attachment', { name: 'holiday.photo.JPG' }, 'att-1'), 'holiday.photo');
	assert.equal(archiveDisplayName('attachment', { name: 'x.jpg', filenamePreview: 'Beach day.jpg' }, 'att-1'), 'Beach day');
	assert.equal(archiveDisplayName('webpage', { title: 'Landing: v2' }, 'page-1'), 'Landing v2');
	assert.equal(archiveDisplayName('post', { text: 'First line of the post\nsecond line' }, 'post-1'), 'First line of the post');
	assert.equal(archiveDisplayName('post', { text: 'w'.repeat(100) }, 'post-1'), 'w'.repeat(60));
	assert.equal(archiveDisplayName('post', { richText: {} }, 'post-9f8e7d6c-1'), 'post-post9f8e');
	assert.equal(archiveFileName('Recipes 🍜'), 'Recipes 🍜.zip');
	assert.equal(archiveFileName('///'), 'thingtime-files.zip');
	assert.equal(shortArchiveId('3bda8208-625c-4f5d'), '3bda8208');
	assert.equal(shortArchiveId(null), 'thing');
});

test('path allocation is unique case-insensitively and keeps extensions on renamed duplicates', () => {
	const paths = new ArchivePathAllocator();
	assert.equal(paths.claim('', 'Photo.jpg'), 'Photo.jpg');
	assert.equal(paths.claim('', 'photo.JPG'), 'photo (2).JPG');
	assert.equal(paths.claim('', 'photo.jpg'), 'photo (3).jpg');
	assert.equal(paths.claim('', 'README'), 'README');
	assert.equal(paths.claim('', 'readme'), 'readme (2)');
	const dir = paths.claimDirectory('', 'Dinner');
	assert.equal(dir, 'Dinner');
	assert.equal(paths.claimDirectory('', 'dinner'), 'dinner (2)');
	assert.equal(paths.claim(dir, 'Photo.jpg'), 'Dinner/Photo.jpg');
	assert.equal(paths.claim(dir, '../escape.jpg'), 'Dinner/escape.jpg');
	assert.equal(paths.claim(dir, ''), 'Dinner/file');
});

test('the links member lists every external URL with its origin directory', () => {
	const text = formatArchiveLinks([
		{ name: 'cover.png', url: 'https://cdn.example/cover.png', from: '' },
		{ name: 'clip.mp4', url: 'https://cdn.example/clip.mp4', from: 'Dinner' }
	]);
	assert.match(text, /^Linked media has no stored bytes/);
	assert.match(text, /\ncover\.png\thttps:\/\/cdn\.example\/cover\.png\n/);
	assert.match(text, /\nDinner\/clip\.mp4\thttps:\/\/cdn\.example\/clip\.mp4\n/);
});

test('archive ids follow the attachment id grammar', () => {
	for (const id of ['a', 'post-1', '3bda8208-625c-4f5d-941f-348020021848', 'a:b.c_d']) assert.equal(ARCHIVE_ID_PATTERN.test(id), true, id);
	for (const id of ['', '-lead', '.lead', 'has space', 'a/b', 'a'.repeat(129), 'x\n']) assert.equal(ARCHIVE_ID_PATTERN.test(id), false, JSON.stringify(id));
});
