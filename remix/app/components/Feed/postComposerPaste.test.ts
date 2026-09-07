import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const feedDir = dirname(fileURLToPath(import.meta.url));
const composer = readFileSync(resolve(feedDir, 'PostComposer.tsx'), 'utf8');
const attachmentComposer = readFileSync(resolve(feedDir, '..', 'Attachments', 'AttachmentComposer.tsx'), 'utf8');

test('the expanded post composer routes file-bearing paste into its attachment uploader', () => {
	assert.match(composer, /onPasteCapture=\{handleComposerPaste\}/);
	assert.match(composer, /attachmentFilesFromClipboard\(event\.clipboardData\)/);
	assert.match(composer, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);[\s\S]*setPollOn\(false\);/);
	assert.match(composer, /pendingPastedFilesRef\.current = \[\.\.\.pendingPastedFilesRef\.current, \.\.\.files\];[\s\S]*setPhotosOn\(true\);/);
	assert.match(composer, /attachmentComposerRef\.current\.addFiles\(files\)/);
});

test('the attachment composer exposes the same bounded queue used by pick, drop, and paste', () => {
	assert.match(attachmentComposer, /addFiles: \(files: readonly File\[\]\) => boolean;/);
	assert.match(attachmentComposer, /useImperativeHandle\(ref, \(\) => \(\{ markCommitted, addFiles: choose \}\)/);
	assert.match(attachmentComposer, /onPaste=\{\(event\) => \{[\s\S]*attachmentFilesFromClipboard\(event\.clipboardData\)[\s\S]*choose\(files\);/);
	assert.match(attachmentComposer, /drop or paste \(⌘\/Ctrl\+V\)/);
});
