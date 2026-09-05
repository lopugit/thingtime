import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSocialCardSvg, renderSocialCardPng } from './socialCard';
import type { SocialPreview } from './socialPreview';

const gallery: SocialPreview = {
	kind: 'gallery',
	variant: 'gallery',
	path: '/post/cats',
	title: 'Nikk: This mah cat 😻',
	description: 'A very important six-photo cat post.',
	eyebrow: 'THINGTIME · PHOTO SET',
	article: true,
	author: 'Nikk',
	initial: 'N',
	badges: ['6 photos', '#cats'],
	options: [],
	images: [
		{ attachmentId: 'one', label: 'Cat one' },
		{ attachmentId: 'two', label: 'Cat two' },
		{ attachmentId: 'three', label: 'Cat three' },
		{ attachmentId: 'four', label: 'Cat four' }
	],
	imageCount: 6
};

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5+QAAAABJRU5ErkJggg==';

test('gallery cards lay out each available image as a collage and escape post text', () => {
	const svg = buildSocialCardSvg({ ...gallery, title: '<Cats & things>' }, [ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG]);
	assert.match(svg, /clip-0/);
	assert.match(svg, /clip-3/);
	assert.match(svg, /&lt;Cats &amp; things&gt;/);
	assert.doesNotMatch(svg, /<Cats & things>/);
});

test('the social-card renderer emits a standard PNG for a no-media route', async () => {
	const png = await renderSocialCardPng({ ...gallery, kind: 'feed', variant: 'feed', images: [], imageCount: 0, author: undefined });
	assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	assert.ok(png.byteLength > 1_000);
});

test('every post-shaped card variant gets its own deliberate visual panel', () => {
	const variants: SocialPreview['variant'][] = [
		'text-post',
		'image-post',
		'gallery',
		'poll',
		'listing',
		'thingtime',
		'share',
		'comment',
		'reply',
		'media-video',
		'media-audio',
		'media-file'
	];
	for (const variant of variants) {
		const svg = buildSocialCardSvg({
			...gallery,
			kind: variant === 'reply' ? 'reply' : variant === 'comment' ? 'comment' : 'text-post',
			variant,
			images: [],
			imageCount: 0
		});
		assert.match(svg, new RegExp(`data-preview-variant="${variant}"`));
		assert.match(svg, new RegExp(`data-preview-panel="${variant}"`));
	}
});

const titleLinesOf = (svg: string): Array<{ y: number; text: string }> =>
	[...svg.matchAll(/<text x="86" y="(\d+)" fill="#17112D"[^>]*>([^<]*)<\/text>/g)].map((match) => ({ y: Number(match[1]), text: match[2] }));

test('multi-line titles stack instead of overprinting, with and without an author', () => {
	const longTitle = 'Nikolaj Lopusanschi: we spent the whole weekend rebuilding the little garden bed out the back';
	for (const author of ['Nikolaj Lopusanschi', undefined]) {
		const lines = titleLinesOf(buildSocialCardSvg({ ...gallery, title: longTitle, author, images: [], imageCount: 0 }));
		assert.ok(lines.length > 1, `expected a wrapped title (author: ${String(author)})`);
		assert.equal(new Set(lines.map((line) => line.y)).size, lines.length, `title lines share a baseline (author: ${String(author)})`);
		// the media/art panel starts at x=700; the headline column must not run under it
		for (const line of lines) assert.ok(line.text.length <= 27, `title line too wide for the card column: ${line.text}`);
	}
});

test('the social-card renderer emits a real multi-image collage PNG', async () => {
	const png = await renderSocialCardPng(gallery, [ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG]);
	assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	assert.ok(png.byteLength > 1_000);
});
