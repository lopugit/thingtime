import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSocialCardSvg, renderSocialCardPng, socialTextWidth } from './socialCard';
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
	}
});

// The media/art panel starts at x=700 and the text column at x=86, so no line
// may measure wider than 594px. A character budget cannot express that: these
// titles are all legal 27-character lines under the old rule and every one of
// them printed under the panel.
test('headlines are wrapped by measured width, never by character count', () => {
	const titles = [
		'Nikk: Where should we go on Sunday?',
		'WOW MMM WWW MMM WWW MMM WWW MMM WOW',
		'Someone: A MASSIVE ANNOUNCEMENT ABOUT THE WEEKEND MARKET',
		`Someone: ${'https://thingtime.example/a/very/long/unbroken/permalink/nobody/can/wrap'}`,
		'Someone: 🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉'
	];
	for (const title of titles) {
		for (const kind of ['text-post', 'profile'] as const) {
			const fontSize = kind === 'profile' ? 42 : 38;
			for (const line of titleLinesOf(buildSocialCardSvg({ ...gallery, kind, title, images: [], imageCount: 0 }))) {
				const width = socialTextWidth(line.text, fontSize);
				assert.ok(width <= 594, `"${line.text}" measures ${width.toFixed(0)}px, past the x=700 art panel (${kind})`);
			}
		}
	}
});

test('descriptions are wrapped by measured width too', () => {
	const svg = buildSocialCardSvg({
		...gallery,
		description: 'MMMM WWWW MMMM WWWW MMMM WWWW MMMM WWWW MMMM WWWW MMMM WWWW MMMM WWWW MMMM',
		images: [],
		imageCount: 0
	});
	const lines = [...svg.matchAll(/<text x="86" y="\d+" fill="#5F5872"[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
	assert.ok(lines.length > 1, 'expected the description to wrap');
	for (const line of lines) assert.ok(socialTextWidth(line, 21) <= 594, `description line "${line}" runs past the art panel`);
});

const rectsFilled = (svg: string, fill: string): Array<{ y: number; height: number }> =>
	[...svg.matchAll(/<rect [^>]*y="(\d+)"[^>]*height="(\d+)"[^>]*fill="([^"]+)"/g)]
		.filter((match) => match[3] === fill)
		.map((match) => ({ y: Number(match[1]), height: Number(match[2]) }));

test('poll option rows never overprint the badge pills, with or without an author', () => {
	const poll: SocialPreview = {
		...gallery,
		kind: 'poll',
		variant: 'poll',
		title: 'Nikk: Where should we go on Sunday?',
		description: 'Poll: Where should we go on Sunday? · Park / Beach / Gallery',
		eyebrow: 'THINGTIME · POLL',
		images: [],
		imageCount: 0,
		options: ['Park', 'Beach', 'Gallery'],
		badges: ['#weekend', 'Poll']
	};
	for (const author of ['Nikk', undefined]) {
		const svg = buildSocialCardSvg({ ...poll, author });
		const rows = rectsFilled(svg, '#F0EAFF');
		const pills = rectsFilled(svg, '#F2EEF9');
		assert.equal(rows.length, 3, `expected every poll option to render (author: ${String(author)})`);
		assert.equal(pills.length, 2, `expected both badge pills to render (author: ${String(author)})`);
		const rowsEnd = Math.max(...rows.map((row) => row.y + row.height));
		const pillsStart = Math.min(...pills.map((pill) => pill.y));
		assert.ok(rowsEnd <= pillsStart, `poll rows reach y=${rowsEnd}, past the badge row at y=${pillsStart} (author: ${String(author)})`);
	}
});

// Same defect class as the headline: 'Build with Thingtime' is exactly the 20
// characters the badge row used to allow, and printed 187px wide inside a 150px
// pill.
test('badge and poll labels are clamped to their pill, not to a character count', () => {
	const svg = buildSocialCardSvg({
		...gallery,
		kind: 'poll',
		variant: 'poll',
		images: [],
		imageCount: 0,
		options: ['WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', 'A shortish option'],
		badges: ['Build with Thingtime', 'WWWWWWWWWWWWWWWWWWWW', 'API + SDK']
	});
	const badgeLabels = [...svg.matchAll(/<text x="\d+" y="\d+" fill="#5D5275"[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
	const pollLabels = [...svg.matchAll(/<text x="98" y="\d+" fill="#FFFFFF"[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
	assert.equal(badgeLabels.length, 3, 'expected three badge pills');
	assert.equal(pollLabels.length, 2, 'expected two poll rows');
	for (const label of badgeLabels) assert.ok(socialTextWidth(label, 13) <= 134, `badge "${label}" overflows its 150px pill`);
	for (const label of pollLabels) assert.ok(socialTextWidth(label, 14) <= 506, `poll label "${label}" overflows its row`);
	assert.ok(
		badgeLabels.some((label) => label.endsWith('…')),
		'an over-long badge should be visibly truncated'
	);
});

test('the social-card renderer emits a real multi-image collage PNG', async () => {
	const png = await renderSocialCardPng(gallery, [ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG]);
	assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	assert.ok(png.byteLength > 1_000);
});
