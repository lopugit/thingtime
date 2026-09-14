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

test('subspace post creation preserves the destination, headline and flair through JSON transport', () => {
	for (const type of ['text', 'image', 'thingtime']) {
		const payload = JSON.parse(JSON.stringify(buildThingCreateRequestPayload({
			type,
			text: 'A subspace post',
			title: 'My headline',
			subspaceId: 'chosen-subspace',
			flairId: 'discussion',
			viewerCanModerate: true
		})));
		assert.equal(payload.subspaceId, 'chosen-subspace');
		assert.equal(payload.title, 'My headline');
		assert.equal(payload.flairId, 'discussion');
		assert.equal('viewerCanModerate' in payload, false);
	}
});

test('ordinary posts do not acquire a subspace destination', () => {
	const payload = JSON.parse(JSON.stringify(buildThingCreateRequestPayload({ type: 'text', text: 'Outside subspaces' })));
	assert.equal('subspaceId' in payload, false);
	assert.equal('flairId' in payload, false);
});

test('unified posts keep subspace fields in the canonical crystal', () => {
	const crystal = { type: 'text', text: 'A subspace post', title: 'Headline', subspaceId: 'chosen-subspace', flairId: 'discussion' };
	const payload = buildThingCreateRequestPayload({ thingtime: ['post'], crystal, subspaceId: 'wrong-subspace', title: 'Wrong', flairId: 'wrong' });
	assert.deepEqual(payload.crystal, crystal);
	for (const key of ['subspaceId', 'title', 'flairId']) assert.equal(key in payload, false);
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
