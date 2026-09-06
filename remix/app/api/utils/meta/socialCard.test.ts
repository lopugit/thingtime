import assert from 'node:assert/strict';
import test from 'node:test';

import { Resvg } from '@resvg/resvg-js';

import { buildSocialCardSvg, readBodyWithin, renderSocialCardPng, socialCardRenderOptions, socialTextWidth } from './socialCard';
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

// The same defect class on the two single-line labels above the headline, which
// wrap() never sees. A display name is allowed 80 characters
// (MAX_DISPLAY_NAME_CHARS) and its line starts at x=136, so anything past ~41
// reached the art panel — drawn last, so it painted over the overflow and the
// name was sliced mid-word with no ellipsis, reading as a complete wrong name.
// The eyebrow additionally carries letter-spacing="2", which the width estimate
// does not model on its own: a label it calls safe is 2px per glyph wider here.
test('the eyebrow and author line are clamped to the text column too', () => {
	const svg = buildSocialCardSvg({
		...gallery,
		eyebrow: 'THINGTIME · A VERY LONG ROUTE DESCRIPTION THAT KEEPS GOING AND GOING',
		author: 'Bartholomew Featherstonehaugh-Cholmondeley the Third of Melbourne',
		images: [],
		imageCount: 0
	});
	const eyebrow = svg.match(/<text x="86" y="134"[^>]*letter-spacing="(\d+)"[^>]*>([^<]*)<\/text>/);
	const author = svg.match(/<text x="136" y="184"[^>]*>([^<]*)<\/text>/);
	assert.ok(eyebrow, 'expected the eyebrow to render');
	assert.ok(author, 'expected the author line to render');
	const spacing = Number(eyebrow[1]);
	const eyebrowWidth = socialTextWidth(eyebrow[2], 15) + Math.max(0, Array.from(eyebrow[2]).length - 1) * spacing;
	assert.ok(eyebrowWidth <= 594, `eyebrow measures ${eyebrowWidth.toFixed(0)}px, past the x=700 art panel`);
	assert.ok(eyebrow[2].endsWith('…'), 'an over-long eyebrow should be visibly truncated');
	// x=136 (clear of the avatar disc) to the art panel at x=700.
	const authorWidth = socialTextWidth(author[1], 19);
	assert.ok(authorWidth <= 564, `author name measures ${authorWidth.toFixed(0)}px, past the x=700 art panel`);
	assert.ok(author[1].endsWith('…'), 'an over-long display name should be visibly truncated');
});

// The card is only ever drawn on Linux hosts, and the deployed Vercel Node
// runtime has NO fonts installed. `font-family="Arial, sans-serif"` therefore
// resolved to nothing there and every production card came back with its
// gradient, browser chrome and panel art drawn and not one glyph on it — while
// CI and dev machines, which do have DejaVu/Liberation, rendered perfectly.
// Asserting PNG magic bytes and a plausible byte length cannot tell those two
// apart, so count the ink the text actually lays down instead.
const inkInBand = (png: Buffer | Uint8Array, options: { top: number; bottom: number; left: number; right: number; dark: boolean }): number => {
	let count = 0;
	for (let y = options.top; y < options.bottom; y += 1) {
		for (let x = options.left; x < options.right; x += 1) {
			const index = (y * 1200 + x) * 4;
			const [red, green, blue] = [png[index], png[index + 1], png[index + 2]];
			const total = red + green + blue;
			if (options.dark ? total < 260 : total > 700) count += 1;
		}
	}
	return count;
};

const cardPixels = (preview: SocialPreview, imageDataUris: readonly (string | null)[] = []): Buffer =>
	new Resvg(buildSocialCardSvg(preview, imageDataUris), socialCardRenderOptions()).render().pixels;

test('cards draw real glyphs on a host with no system fonts (the deployed runtime)', () => {
	const preview: SocialPreview = { ...gallery, kind: 'feed', variant: 'feed', title: 'Nikk: the weekend garden bed', images: [], imageCount: 0 };
	// The card renderer must not depend on the host having fonts at all.
	assert.equal(socialCardRenderOptions()?.font?.loadSystemFonts, false, 'the bundled face must be the only one in play');

	const pixels = cardPixels(preview);
	// Dark headline ink on the white panel, in the title band above the art panel.
	const titleInk = inkInBand(pixels, { top: 200, bottom: 340, left: 86, right: 700, dark: true });
	assert.ok(titleInk > 500, `expected a drawn headline, found ${titleInk} dark pixels in the title band`);

	// The same band with the text removed is the "blank card" this shipped as.
	const blank = cardPixels({ ...preview, title: '', description: '', author: undefined, eyebrow: '', badges: [] });
	const blankInk = inkInBand(blank, { top: 200, bottom: 340, left: 86, right: 700, dark: true });
	assert.ok(titleInk > blankInk * 20, `headline ink (${titleInk}) is indistinguishable from an empty card (${blankInk})`);

	// White wordmark ink inside the dark browser chrome bar.
	const wordmarkInk = inkInBand(pixels, { top: 52, bottom: 80, left: 130, right: 320, dark: false });
	assert.ok(wordmarkInk > 100, `expected the THINGTIME wordmark to render, found ${wordmarkInk} light pixels`);
});

test('nothing on a card is drawn as a missing-glyph box', () => {
	// resvg paints an unmapped code point as `.notdef` — a hollow rectangle. Two
	// of the chrome's decorative marks used to be U+2726/U+271A, which Liberation
	// Sans does not have, and post titles routinely carry emoji.
	const tofu = new Resvg(
		`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#FFFFFF"/><text x="40" y="120" font-family="Arial, sans-serif" font-size="38" fill="#17112D">\u{1F63B}</text></svg>`,
		socialCardRenderOptions()
	)
		.render()
		.pixels.reduce((total, channel, index) => (index % 4 === 0 && channel < 128 ? total + 1 : total), 0);
	assert.ok(tofu > 0, 'expected an unmapped code point to prove it draws a visible .notdef box');

	const withEmoji = buildSocialCardSvg({ ...gallery, title: 'Nikk: this mah cat 😻', badges: ['6 photos 🎉'], images: [], imageCount: 0 });
	assert.doesNotMatch(withEmoji, /\p{Extended_Pictographic}/u, 'emoji must be dropped from the card, never handed to the renderer as tofu');
	assert.match(withEmoji, /Nikk: this mah cat/, 'the words around an emoji must survive');
	assert.doesNotMatch(buildSocialCardSvg({ ...gallery, images: [], imageCount: 0 }), /[✦✚]/, 'the chrome marks must be drawn, not typed');
});

// The emoji strip is applied at paint time, but the avatar letter and the three
// badge pills are both CHOSEN before anything is measured. So a value that is
// entirely unrenderable still took its slot and drew nothing into it: a leading
// emoji in a display name (`🌸 Rosie` — an ordinary name, not an edge case) left
// the avatar disc blank, because `initial || 'T'` sees a truthy emoji and only
// the escape drops it. Badges were worse than blank: `#🎉` spent a pill on a
// bare `#` and, since the slice to three ran first, pushed a real `#garden` off
// the card entirely.
test('a value the card cannot draw never takes the slot of one it can', () => {
	const svg = buildSocialCardSvg({ ...gallery, author: '🌸 Rosie', initial: '🌸', badges: ['🎉', '#🎉', '#garden', 'Photo'], images: [], imageCount: 0 });
	const avatar = svg.match(/<text x="102" y="186"[^>]*>([^<]*)<\/text>/);
	assert.ok(avatar, 'expected the avatar disc to render');
	assert.equal(avatar[1], 'R', 'the avatar letter must come from what the card can actually draw');

	const labels = [...svg.matchAll(/<text x="\d+" y="\d+" fill="#5D5275"[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
	assert.deepEqual(labels, ['#garden', 'Photo'], 'unrenderable badges must not occupy — or displace — a pill');
	assert.equal(rectsFilled(svg, '#F2EEF9').length, labels.length, 'every badge pill drawn must carry a label');

	// A name with nothing renderable in it at all still gets the site letter.
	const allEmoji = buildSocialCardSvg({ ...gallery, author: '🎉🎉', initial: '🎉', images: [], imageCount: 0 });
	assert.equal(allEmoji.match(/<text x="102" y="186"[^>]*>([^<]*)<\/text>/)?.[1], 'T');
});

test('empty-panel copy stays legible over its own artwork', () => {
	// The art is positioned per variant but the copy sits at fixed baselines, so
	// the poll axis stroke and the docs page rect both ran through it. Once the
	// font landed this became two lines of white text on a yellow rectangle.
	for (const variant of ['poll', 'docs', 'webpage', 'media-file', 'collection'] as const) {
		const svg = buildSocialCardSvg({ ...gallery, kind: 'text-post', variant, images: [], imageCount: 0 });
		const scrim = svg.match(/<rect data-preview-scrim="1" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/);
		assert.ok(scrim, `${variant} draws its panel copy with no scrim behind it`);
		const [top, height] = [Number(scrim[2]), Number(scrim[4])];
		// Both copy baselines (y=410 and y=450) plus their descenders must sit
		// inside the darkened band, or the scrim is decorative rather than useful.
		assert.ok(top <= 410 - 30, `${variant} scrim starts at y=${top}, below the first copy line`);
		assert.ok(top + height >= 458, `${variant} scrim ends at y=${top + height}, above the second copy line`);
	}
});

test('the social-card renderer emits a real multi-image collage PNG', async () => {
	const png = await renderSocialCardPng(gallery, [ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG]);
	assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	assert.ok(png.byteLength > 1_000);
});

// An <image> whose bytes will not decode draws NOTHING — resvg has no error
// treatment and the white card panel showed through as a blank slab. Only the
// Content-Type header and a size bound are checked before the bytes reach the
// renderer, so this is reachable from a stored object that does not match its
// declared type, not just from an unlikely corruption in flight.
test('a photo tile whose bytes will not decode falls back to the branded tile', () => {
	// Mean colour of the single-image tile (x=700..1130, y=92..538), sampled
	// well inside it. White is the card panel showing through — the defect.
	const tileIsBlank = (dataUri: string | null): boolean => {
		const pixels = cardPixels({ ...gallery, kind: 'image-post', variant: 'image-post', images: [], imageCount: 1 }, [dataUri]);
		let total = 0;
		let samples = 0;
		for (let y = 200; y < 400; y += 2) {
			for (let x = 800; x < 1050; x += 2) {
				const index = (y * 1200 + x) * 4;
				total += pixels[index] + pixels[index + 1] + pixels[index + 2];
				samples += 1;
			}
		}
		return total / samples > 740;
	};

	assert.ok(!tileIsBlank(null), 'a tile with no image at all must already draw the branded gradient');
	// A PNG header with its image data cut off: valid enough to be fetched and
	// labelled image/png, impossible for the renderer to draw.
	const truncated = `data:image/png;base64,${ONE_PIXEL_PNG.split(',')[1].slice(0, 24)}`;
	assert.ok(!tileIsBlank(truncated), 'an undecodable photo must fall back to the branded tile, not a blank white slab');
});

// A collage cell that is never drawn is not blank — it is the white card panel
// showing through, which is the same slab the branded tile exists to prevent.
// A 2×2 grid drawn for exactly three photos left its fourth cell undrawn, so
// every three-photo post (an ordinary post, not an edge case) shipped with a
// white square in the corner of its collage.
test('every photo count fills the media panel, with no undrawn collage cell', () => {
	// Bottom-right quadrant of the media panel (x=700..1130, y=92..538), sampled
	// well inside it. White is the card panel showing through — the defect.
	const quadrantIsBlank = (imageCount: number): boolean => {
		const pixels = cardPixels({ ...gallery, images: [], imageCount }, []);
		let total = 0;
		let samples = 0;
		for (let y = 340; y < 520; y += 2) {
			for (let x = 940; x < 1120; x += 2) {
				const index = (y * 1200 + x) * 4;
				total += pixels[index] + pixels[index + 1] + pixels[index + 2];
				samples += 1;
			}
		}
		return total / samples > 740;
	};

	for (const imageCount of [1, 2, 3, 4, 6]) {
		assert.ok(!quadrantIsBlank(imageCount), `a ${imageCount}-photo collage leaves the panel's bottom-right corner undrawn`);
	}
});

// The cap on card imagery has to survive a response that declines to say how
// big it is. S3 sends content-length today, so a header-only check looks fine
// in production right up until a proxy, a range response or a compressed
// transfer drops it — and then the only bound on a public, unauthenticated
// endpoint is gone. These pin the bound to the read itself.
const streamed = (chunks: readonly Uint8Array[]): Response =>
	new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				controller.close();
			}
		})
	);

test('a body that never declares its length is still cut off at the cap', async () => {
	const oversize = [new Uint8Array(600), new Uint8Array(600)];
	assert.equal(streamed(oversize).headers.get('content-length'), null, 'the case only bites when the header is absent');
	assert.equal(await readBodyWithin(streamed(oversize), 1_000), null);
});

test('a body inside the cap is returned whole and in order', async () => {
	const bytes = await readBodyWithin(streamed([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]), 1_000);
	assert.deepEqual(bytes && Array.from(bytes), [1, 2, 3, 4, 5]);
});

test('a body exactly at the cap is kept, not rejected off by one', async () => {
	const bytes = await readBodyWithin(streamed([new Uint8Array(1_000)]), 1_000);
	assert.equal(bytes?.byteLength, 1_000);
});

test('a response with no body at all reads as nothing rather than throwing', async () => {
	assert.equal(await readBodyWithin(new Response(null, { status: 204 }), 1_000), null);
});
