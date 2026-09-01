import assert from 'node:assert/strict';
import test from 'node:test';

import { validateThingtimeCrystal } from './registry.ts';

const validatePost = (richText: unknown, text = 'client fallback') =>
	validateThingtimeCrystal(['post'], {
		type: 'text',
		text,
		richText,
		images: [],
		listing: null,
		thing: null
	});

test('post rich text preserves Editor.js markup, styles, whitespace, and a canonical text fallback', () => {
	const richText = {
		kind: 'rich-text',
		blocks: [
			{
				type: 'paragraph',
				data: { text: '<mark>Home  network public ip:</mark><br>113.29.241.145' },
				tunes: { style: { color: '#ff4fa3', align: 'left', size: 18 } }
			}
		]
	};
	const result = validatePost(richText);
	assert.equal(result.ok, true, JSON.stringify(result));
	if (result.ok !== true) return;
	assert.deepEqual(result.crystal.richText, richText);
	assert.equal(result.crystal.text, 'Home  network public ip:\n113.29.241.145');
});

test('post rich text must be a complete bounded Editor.js document', () => {
	assert.equal(validatePost({ kind: 'rich-text' }).ok, false);
	assert.equal(validatePost({ kind: 'rich-text', blocks: [{ type: 'paragraph', data: 'not-an-object' }] }).ok, false);
	assert.equal(validatePost({ kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'x'.repeat(5001) } }] }).ok, false);
});

test('legacy plain-text post crystals remain unchanged when richText is omitted', () => {
	const result = validateThingtimeCrystal(['post'], { type: 'text', text: 'line one\nline two' });
	assert.equal(result.ok, true, JSON.stringify(result));
	if (result.ok !== true) return;
	assert.equal(result.crystal.text, 'line one\nline two');
	assert.equal('richText' in result.crystal, false);
});
