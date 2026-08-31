import assert from 'node:assert/strict';
import test from 'node:test';

import { buildThingCommentRequestPayload, buildThingCreateRequestPayload } from './thingsRequestPayload.ts';

const richText = {
	kind: 'rich-text',
	blocks: [
		{ type: 'header', data: { text: 'Posts', level: 2 } },
		{ type: 'paragraph', data: { text: 'Are  now<br>Working' }, tunes: { style: { color: '#8f6fff', size: 24, align: 'right' } } }
	]
};

test('legacy post creation transports the complete native Editor.js document', () => {
	const payload = buildThingCreateRequestPayload({
		type: 'text',
		text: 'Posts\n\nAre  now\nWorking',
		richText,
		visibility: 'public',
		shareId: 'post-rich-text-transport'
	});

	assert.deepEqual(payload.richText, richText);
	assert.equal(payload.text, 'Posts\n\nAre  now\nWorking');
});

test('rich comments transport the complete native Editor.js document', () => {
	const payload = buildThingCommentRequestPayload({
		id: 'parent-post',
		type: 'text',
		text: 'Posts\n\nAre  now\nWorking',
		richText,
		shareId: 'comment-rich-text-transport'
	});

	assert.deepEqual(payload.richText, richText);
});

test('unified creation keeps rich text inside its crystal without a second top-level copy', () => {
	const payload = buildThingCreateRequestPayload({
		thingtime: ['post'],
		crystal: { type: 'text', text: 'Posts', richText },
		richText: { should: 'not leak outside crystal' }
	});

	assert.deepEqual(payload.crystal, { type: 'text', text: 'Posts', richText });
	assert.equal('richText' in payload, false);
});
