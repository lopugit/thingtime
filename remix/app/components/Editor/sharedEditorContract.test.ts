import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const app = path.resolve(import.meta.dirname, '../..');
const sourceFiles = (directory: string): string[] =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) && !/\.test\./.test(file) ? [file] : [];
	});

test('all application Editor.js runtimes are owned by the shared editor', () => {
	const owners = sourceFiles(app).filter((file) => /(?:from\s*|import\s*\()['"]@editorjs\/editorjs['"]/.test(readFileSync(file, 'utf8')));
	assert.deepEqual(
		owners.map((file) => path.relative(app, file)),
		['components/Editor/LongTextEditor.tsx']
	);
});

test('every rich-text entry point uses the shared editor without disabling styling', () => {
	for (const file of [
		'Feed/PostComposer.tsx',
		'Thingtime/Thingtime.tsx',
		'Thingtime/concepts/conceptBits.tsx',
		'Admin/TierManager.tsx',
		'Builder/RichTextModal.tsx',
		'Builder/InlineRichTextEditor.tsx'
	]) {
		const source = readFileSync(path.join(app, 'components', file), 'utf8');
		assert.match(source, /<LongTextEditor\b/, file);
		assert.doesNotMatch(source, /\bstyle:\s*false/, `${file} must retain shared styling`);
	}
});
