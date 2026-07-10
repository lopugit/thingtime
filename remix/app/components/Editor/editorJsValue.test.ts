import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { EDITOR_JS_AUTO_DETECT_LIMITS, getEditorJsDoc, getEditorJsValueSignature, isEditorJsDoc, isEditorJsDocSafeToEdit, parseEditorJsDocString } from './editorJsValue.ts';

const doc = {
	time: 123,
	version: '2.30.8',
	kind: 'rich-text',
	blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Hello' } }]
};

test('recognises native Editor.js documents and preserves metadata', () => {
	assert.equal(isEditorJsDoc(doc), true);
	assert.equal(getEditorJsDoc(doc), doc);
});

test('recognises JSON-stringified Editor.js documents', () => {
	const parsed = parseEditorJsDocString(JSON.stringify(doc));
	assert.deepEqual(parsed, doc);
});

test('ordinary long and multi-line strings stay plain', () => {
	assert.equal(parseEditorJsDocString('A plain line\nA second plain line'), null);
	assert.equal(parseEditorJsDocString('x'.repeat(500)), null);
	assert.equal(getEditorJsDoc('Hmm very nice!\n'), null);
});

test('rejects lookalike or malformed payloads', () => {
	assert.equal(parseEditorJsDocString('{"blocks":"nope"}'), null);
	assert.equal(parseEditorJsDocString('{"blocks":[{"type":"paragraph"}]}'), null);
	assert.equal(parseEditorJsDocString('{not json}'), null);
});

test('accepts an empty Editor.js document', () => {
	assert.deepEqual(parseEditorJsDocString('{"blocks":[]}'), { blocks: [] });
});

test('value signatures match structurally equal parent echoes', () => {
	assert.equal(getEditorJsValueSignature(doc), getEditorJsValueSignature(structuredClone(doc)));
});

test('value signatures never throw for open-ended Editor.js metadata', () => {
	const unusual: Record<string, unknown> = { blocks: [], count: (globalThis as any).BigInt(2) };
	unusual.self = unusual;
	unusual.toJSON = () => {
		throw new Error('not serialisable');
	};

	assert.doesNotThrow(() => getEditorJsValueSignature(unusual));
	assert.equal(getEditorJsValueSignature(unusual), getEditorJsValueSignature(unusual));
});

test('auto-detection rejects oversized source and block collections', () => {
	const oversizedSource = `{"blocks":[],"padding":"${'x'.repeat(EDITOR_JS_AUTO_DETECT_LIMITS.sourceLength)}"}`;
	const block = { type: 'paragraph', data: { text: 'x' } };
	assert.equal(parseEditorJsDocString(oversizedSource), null);
	assert.equal(parseEditorJsDocString(JSON.stringify({ blocks: Array.from({ length: 501 }, () => block) })), null);
	assert.equal(parseEditorJsDocString(JSON.stringify({ blocks: Array.from({ length: 500 }, () => block) }))?.blocks.length, 500);
});

test('auto-detection rejects documents deeper than the edit safety limit', () => {
	let nested: Record<string, unknown> = { text: 'leaf' };
	for (let index = 0; index < EDITOR_JS_AUTO_DETECT_LIMITS.depth + 2; index += 1) nested = { child: nested };
	assert.equal(parseEditorJsDocString(JSON.stringify({ blocks: [{ type: 'paragraph', data: nested }] })), null);
	assert.equal(isEditorJsDocSafeToEdit({ blocks: [{ type: 'paragraph', data: nested }] }), false);
});

test('native Editor.js identity is preserved while unsafe values are gated from editing', () => {
	const block = { type: 'paragraph', data: { text: 'x' } };
	const oversized = { kind: 'rich-text', blocks: Array.from({ length: 501 }, () => block) };
	assert.equal(getEditorJsDoc(oversized), oversized);
	assert.equal(isEditorJsDocSafeToEdit(oversized), false);
	assert.equal(isEditorJsDocSafeToEdit(doc), true);
});

test('native edit safety uses cumulative value and text budgets', () => {
	const manyValues = { blocks: [{ type: 'paragraph', data: { rows: Array.from({ length: 10_001 }, (_, index) => index) } }] };
	const muchText = {
		blocks: [
			{
				type: 'paragraph',
				data: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`field${index}`, 'x'.repeat(100_000)]))
			}
		]
	};
	assert.equal(isEditorJsDocSafeToEdit(manyValues), false);
	assert.equal(isEditorJsDocSafeToEdit(muchText), false);
});
