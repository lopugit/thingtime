import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test through the repository tsx loader.
import {
	appendLinkedImageLines,
	canonicalLinkedImageUrls,
	createLinkedImageItem,
	isLinkedImageUrl,
	linkedImageAddMessage,
	linkedImageItemError,
	MAX_LINKED_IMAGES
} from './mediaGalleryCore.ts';

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

test('multi-line add enforces the eight-image limit without discarding overflow input', () => {
	const current = Array.from({ length: MAX_LINKED_IMAGES - 1 }, (_, index) =>
		createLinkedImageItem(`https://images.example/${index}.jpg`, () => `existing-${index}`)
	);
	const result = appendLinkedImageLines(current, 'https://images.example/last.jpg\nhttps://images.example/overflow.jpg', {
		idFactory: () => 'last'
	});
	assert.equal(result.items.length, MAX_LINKED_IMAGES);
	assert.equal(result.overflowCount, 1);
	assert.equal(result.remainingInput, 'https://images.example/overflow.jpg');
	assert.match(linkedImageAddMessage(result) || '', /up to 8/i);
});
