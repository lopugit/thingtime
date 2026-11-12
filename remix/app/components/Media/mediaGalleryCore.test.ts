import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentedImage } from './PresentedImage';

// @ts-ignore Node executes this TypeScript test through the repository tsx loader.
import {
	appendLinkedImageLines,
	canonicalLinkedImageUrls,
	createLinkedImageItem,
	isLinkedImageUrl,
	linkedImageAddMessage,
	linkedImageItemError
} from './mediaGalleryCore.ts';

test('image presentation encodes literal source metacharacters and preserves valid media URLs', () => {
	const markup = (src: string) => renderToStaticMarkup(React.createElement(PresentedImage, { src, loading: 'lazy' }));
	assert.match(markup('https://images.example/file%20name?q="<tag>"&signature=a%2Bb'), /src="https:\/\/images\.example\/file%20name\?q=%22%3Ctag%3E%22&amp;signature=a%2Bb"/);
	assert.match(markup('/api/v1/attachments/content?id=att_1'), /src="\/api\/v1\/attachments\/content\?id=att_1"/);
	assert.match(markup('blob:https://thingtime.com/fixture'), /src="blob:https:\/\/thingtime\.com\/fixture"/);
	assert.match(markup('data:image/png;base64,iVBORw0KGgo='), /src="data:image\/png;base64,iVBORw0KGgo="/);
	assert.match(markup('data:image/svg+xml,<svg/>'), /src="data:image\/svg\+xml,%3Csvg\/%3E"/);
	// eslint-disable-next-line no-script-url -- Intentionally rejected URL fixtures.
	for (const src of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///private/preview.png']) {
		assert.doesNotMatch(markup(src), /\bsrc=/);
	}
});

test('linked image URLs are trimmed, validated, and deduplicated in stable order', () => {
	const items = [
		{ id: 'one', url: ' https://images.example/one.jpg ' },
		{ id: 'duplicate', url: 'https://images.example/one.jpg' },
		{ id: 'invalid', url: 'ftp://images.example/unsafe.jpg' },
		{ id: 'two', url: 'http://images.example/two.png' }
	];
	assert.deepEqual(canonicalLinkedImageUrls(items), ['https://images.example/one.jpg', 'http://images.example/two.png']);
	assert.equal(isLinkedImageUrl('https://images.example/image.jpg'), true);
	assert.equal(isLinkedImageUrl('https://images.example/image with spaces.jpg'), false);
	assert.equal(isLinkedImageUrl('https://user:secret@images.example/private.jpg'), false);
	assert.equal(isLinkedImageUrl('//images.example/protocol-relative.jpg'), false);
	assert.equal(isLinkedImageUrl('https://images.example/control\u0000character.jpg'), false);
	assert.equal(isLinkedImageUrl('https://images.example\\normalized-away.jpg'), false);
	assert.equal(isLinkedImageUrl('https://images.example/bidi\u202Ename.jpg'), false);
	assert.equal(isLinkedImageUrl('data:image/png;base64,abc'), false);
	assert.match(linkedImageItemError(items, 1) || '', /already added/i);
	assert.match(linkedImageItemError(items, 2) || '', /http\(s\)/i);
});

test('valid linked image URLs keep their trimmed spelling instead of a parsed normalization', () => {
	const source = '  HTTPS://Images.Example:443/a/../photo.jpg?size=large#preview  ';
	assert.equal(isLinkedImageUrl(source), true);
	assert.deepEqual(canonicalLinkedImageUrls([{ id: 'one', url: source }]), [source.trim()]);
});

test('multi-line add keeps stable ids, skips duplicates, and leaves invalid lines editable', () => {
	const ids = ['new-one', 'new-two'];
	const result = appendLinkedImageLines(
		[{ id: 'existing', url: 'https://images.example/existing.jpg' }],
		['  https://images.example/new.jpg  ', 'https://images.example/existing.jpg', 'not-a-url', 'https://images.example/second.jpg'].join('\n'),
		{ idFactory: () => ids.shift() || 'unexpected' }
	);

	assert.deepEqual(
		result.items.map((item) => item.id),
		['existing', 'new-one', 'new-two']
	);
	assert.deepEqual(canonicalLinkedImageUrls(result.items), [
		'https://images.example/existing.jpg',
		'https://images.example/new.jpg',
		'https://images.example/second.jpg'
	]);
	assert.equal(result.remainingInput, 'not-a-url');
	assert.equal(result.addedCount, 2);
	assert.equal(result.duplicateCount, 1);
	assert.equal(result.invalidCount, 1);
	assert.match(linkedImageAddMessage(result) || '', /2 linked images added/i);
	assert.match(linkedImageAddMessage(result) || '', /duplicate/i);
});

test('multi-line add preserves arbitrary valid URL counts and complete long URLs', () => {
 const urls = Array.from({ length: 30 }, (_, index) => `https://images.example/${index}.jpg`);
 urls.push('https://images.example/' + 'x'.repeat(10_000));
 const result = appendLinkedImageLines([], urls.join('\n'));
 assert.equal(result.items.length, urls.length); assert.equal(result.overflowCount, 0); assert.equal(result.remainingInput, ''); assert.deepEqual(canonicalLinkedImageUrls(result.items), urls);
});
