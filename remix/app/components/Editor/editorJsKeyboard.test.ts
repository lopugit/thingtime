import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { EDITOR_JS_NATIVE_TEXT_FIELD_KEYS, getEditorJsArrowMovement, preserveEditorJsTextFieldKeydown, shouldPreserveEditorJsTextFieldKeydown } from './editorJsKeyboard.ts';

const targetFor = (matchesTextField: boolean) => ({
	closest: (selector: string) => (matchesTextField && selector === '[contenteditable="true"].cdx-input' ? {} : null)
});

const eventFor = (key: string, matchesTextField = true) => {
	let propagationStops = 0;
	let defaultPreventions = 0;
	const event = {
		key,
		target: targetFor(matchesTextField),
		stopPropagation: () => {
			propagationStops += 1;
		},
		preventDefault: () => {
			defaultPreventions += 1;
		}
	} as unknown as KeyboardEvent;

	return {
		event,
		propagationStops: () => propagationStops,
		defaultPreventions: () => defaultPreventions
	};
};

test('keeps deletion and cursor navigation inside Editor.js contenteditable text fields', () => {
	for (const key of EDITOR_JS_NATIVE_TEXT_FIELD_KEYS) {
		const observed = eventFor(key);
		preserveEditorJsTextFieldKeydown(observed.event);
		assert.equal(observed.propagationStops(), 1, `${key} should not reach Editor.js block navigation`);
		assert.equal(observed.defaultPreventions(), 0, `${key} should not be cancelled without a usable browser Selection`);
	}
});

test('does not intercept tool-owned or block-level keys', () => {
	for (const key of ['Enter', 'Tab', 'Escape', 'a']) {
		const observed = eventFor(key);
		preserveEditorJsTextFieldKeydown(observed.event);
		assert.equal(observed.propagationStops(), 0, `${key} should continue through Editor.js`);
	}
});

test('does not change normal paragraph, heading, list, or checklist navigation', () => {
	for (const key of EDITOR_JS_NATIVE_TEXT_FIELD_KEYS) {
		const observed = eventFor(key, false);
		preserveEditorJsTextFieldKeydown(observed.event);
		assert.equal(observed.propagationStops(), 0);
	}
});

test('ignores non-element event targets safely', () => {
	assert.equal(shouldPreserveEditorJsTextFieldKeydown({ key: 'Backspace', target: null }), false);
	assert.equal(shouldPreserveEditorJsTextFieldKeydown({ key: 'ArrowUp', target: {} as EventTarget }), false);
});

test('leaves IME composition and tool-owned keyboard events untouched', () => {
	for (const handledState of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
		const observed = eventFor('ArrowLeft');
		Object.assign(observed.event, handledState);
		preserveEditorJsTextFieldKeydown(observed.event);
		assert.equal(observed.propagationStops(), 1);
		assert.equal(observed.defaultPreventions(), 0);
	}
});

test('maps physical horizontal arrows visually for LTR, RTL, and bidi fields', () => {
	const base = { shiftKey: false, metaKey: false, altKey: false, ctrlKey: false };
	assert.deepEqual(getEditorJsArrowMovement({ ...base, key: 'ArrowLeft' }), { alter: 'move', direction: 'left', granularity: 'character' });
	assert.deepEqual(getEditorJsArrowMovement({ ...base, key: 'ArrowRight' }), { alter: 'move', direction: 'right', granularity: 'character' });
	assert.deepEqual(getEditorJsArrowMovement({ ...base, key: 'ArrowUp', shiftKey: true }), { alter: 'extend', direction: 'backward', granularity: 'line' });
	assert.deepEqual(getEditorJsArrowMovement({ ...base, key: 'ArrowDown', metaKey: true }), { alter: 'move', direction: 'forward', granularity: 'documentboundary' });
});
