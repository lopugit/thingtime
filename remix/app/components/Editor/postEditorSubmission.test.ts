import assert from 'node:assert/strict';
import test from 'node:test';

import type { EditorJsDoc } from './editorJsValue';
import { capturePostEditorValue } from './postEditorSubmission';

const fallback: EditorJsDoc = {
	kind: 'rich-text',
	blocks: [{ type: 'paragraph', data: { text: 'Rich text\n## Posts' } }]
};

test("submission awaits and returns the editor's latest styled block snapshot", async () => {
	let resolveSave!: (value: EditorJsDoc) => void;
	const save = new Promise<EditorJsDoc>((resolve) => {
		resolveSave = resolve;
	});
	const captured = capturePostEditorValue({ save: () => save }, fallback);
	let settled = false;
	captured.then(() => {
		settled = true;
	});
	await Promise.resolve();
	assert.equal(settled, false);

	const latest: EditorJsDoc = {
		kind: 'rich-text',
		blocks: [
			{ type: 'paragraph', data: { text: '<font color="#3498db">Rich Text</font>' } },
			{ type: 'header', data: { text: '<mark>Posts</mark>', level: 2 }, tunes: { style: { align: 'center' } } },
			{ type: 'paragraph', data: { text: 'Work' }, tunes: { style: { align: 'right', color: '#7c3aed', fontSize: 'xl' } } }
		]
	};
	resolveSave(latest);

	assert.deepEqual(await captured, latest);
});

test('submission keeps the last accepted document while the editor is unavailable', async () => {
	assert.equal(await capturePostEditorValue(null, fallback), fallback);
	assert.equal(await capturePostEditorValue({ save: async () => 'plain text' }, fallback), fallback);
});
