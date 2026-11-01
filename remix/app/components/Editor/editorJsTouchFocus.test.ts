import assert from 'node:assert/strict';
import test from 'node:test';

import { EDITOR_JS_EDITABLE_SELECTOR, getEditorJsTouchFocusTarget } from './editorJsTouchFocus';

test('resolves an unfocused Editor.js contenteditable for a touch release', () => {
	const editable = {} as HTMLElement;
	const target = {
		closest: (selector: string) => (selector === EDITOR_JS_EDITABLE_SELECTOR ? editable : null)
	} as unknown as EventTarget;
	const holder = { contains: (node: Node) => node === editable } as unknown as HTMLElement;

	assert.equal(getEditorJsTouchFocusTarget(holder, target, 'touch', null), editable);
});

test('does not interfere with mouse pointers, outside targets, or an already focused editor', () => {
	const editable = {} as HTMLElement;
	const target = { closest: () => editable } as unknown as EventTarget;
	const insideHolder = { contains: (node: Node) => node === editable } as unknown as HTMLElement;
	const outsideHolder = { contains: () => false } as unknown as HTMLElement;

	assert.equal(getEditorJsTouchFocusTarget(insideHolder, target, 'mouse', null), null);
	assert.equal(getEditorJsTouchFocusTarget(outsideHolder, target, 'touch', null), null);
	assert.equal(getEditorJsTouchFocusTarget(insideHolder, target, 'touch', editable), null);
	assert.equal(getEditorJsTouchFocusTarget(insideHolder, null, 'touch', null), null);
});
