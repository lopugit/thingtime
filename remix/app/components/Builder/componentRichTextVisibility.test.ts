import assert from 'node:assert/strict';
import test from 'node:test';
import { observeFirstVisibleEditor } from './componentRichTextVisibility';
import { componentRichTextSaveSnapshot, componentRichTextFieldName } from './componentRichTextValue';
test('hidden or zero-box fields wait for their own document visibility and initialize once', () => {
	let rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
		callback: any,
		disconnected = 0,
		reveals = 0;
	const view: any = {
		getComputedStyle: () => ({ visibility: 'visible' }),
		removeEventListener() {},
		IntersectionObserver: class {
			constructor(fn: any) {
				callback = fn;
			}
			observe() {}
			disconnect() {
				disconnected++;
			}
		}
	};
	const field: any = { ownerDocument: { defaultView: view, removeEventListener() {} }, isConnected: true, getBoundingClientRect: () => rect };
	const cleanup = observeFirstVisibleEditor(field, () => reveals++);
	callback([{ target: field, isIntersecting: false }]);
	callback([{ target: field, isIntersecting: true }]);
	assert.equal(reveals, 0);
	rect = { left: 0, top: 0, right: 100, bottom: 96, width: 100, height: 96 };
	callback([{ target: field, isIntersecting: true }]);
	assert.equal(reveals, 1);
	assert.equal(disconnected, 1);
	callback([{ target: field, isIntersecting: false }]);
	callback([{ target: field, isIntersecting: true }]);
	assert.equal(reveals, 1);
	cleanup();
});
test('a removed field never starts from a late observer callback', () => {
	let callback: any,
		revealed = false;
	const view: any = {
		getComputedStyle: () => ({ visibility: 'visible' }),
		removeEventListener() {},
		IntersectionObserver: class {
			constructor(fn: any) {
				callback = fn;
			}
			observe() {}
			disconnect() {}
		}
	};
	const field: any = {
		ownerDocument: { defaultView: view, removeEventListener() {} },
		isConnected: true,
		getBoundingClientRect: () => ({ width: 100, height: 96 })
	};
	const cancel = observeFirstVisibleEditor(field, () => {
		revealed = true;
	});
	cancel();
	callback([{ target: field, isIntersecting: true }]);
	assert.equal(revealed, false);
});
test('hidden defaults stay typed and current; dirty fields require their real saved document', () => {
	const current = { kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Latest <b>default</b>' } }] };
	const snapshot = componentRichTextSaveSnapshot(undefined, current, false);
	assert.deepEqual(snapshot.document, current);
	assert.equal(snapshot.plainText, 'Latest default');
	assert.equal(componentRichTextSaveSnapshot(undefined, { kind: 'rich-text', blocks: [] }, false).plainText, '');
	assert.throws(() => componentRichTextSaveSnapshot(undefined, current, true), /still opening/);
	assert.equal(
		componentRichTextSaveSnapshot({ kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Dirty draft' } }] }, current, true).plainText,
		'Dirty draft'
	);
});

test('authored rich field names preserve long identifiers without admitting syntax or prototype keys', () => {
	const name = 'longField' + 'x'.repeat(200);
	assert.equal(componentRichTextFieldName(name), name);
	for (const name of ['__proto__', 'constructor', 'prototype', 'bad.path', '1bad']) assert.equal(componentRichTextFieldName(name), '');
});
