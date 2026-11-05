import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import { Resvg } from '@resvg/resvg-js';

import {
	buildSocialCardSvg,
	readBodyWithin,
	renderSocialCardPng,
	socialCardImageExtent,
	socialCardRenderOptions,
	socialTextWidth
} from './socialCard';
import type { SocialPreview } from './socialPreview';
import { staticSocialPreview } from './socialPreview';
import { socialCardLogoSvg, SOCIAL_CARD_BRAND } from './socialCardBrand';
import { buildLogoSvg, LOGO_FULL_MATRIX, LOGO_ICON_MATRIX, LOGO_DEFAULT_COLOURS } from '../../../components/Branding/logoMatrix';
import { SOCIAL_CARD_BRAND_FONTS } from './socialCardBrandFontData';

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

const ONE_PIXEL_PNG = `data:image/png;base64,${new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#FF0000"/></svg>').render().asPng().toString('base64')}`;

const textNodes = (svg: string, role: string): Array<{ x: number; y: number; size: number; width: number; text: string }> =>
	[...svg.matchAll(/<text data-preview-text="([^"]+)" data-max-width="([\d.]+)" x="([\d.]+)" y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
		.filter((match) => match[1] === role)
		.map((match) => ({ width: Number(match[2]), x: Number(match[3]), y: Number(match[4]), size: Number(match[5]), text: match[6] }));

const templates = ['editorial', 'colour-blocks', 'editorial-white', 'pink-invitation', 'night-garden'] as const;
const cardPixels = (preview: SocialPreview, images: readonly (string | null)[] = []): Buffer =>
	new Resvg(buildSocialCardSvg(preview, images), socialCardRenderOptions()).render().pixels;

const pixel = (pixels: Uint8Array, x: number, y: number): number[] => Array.from(pixels.slice((y * 1200 + x) * 4, (y * 1200 + x) * 4 + 3));

test('all five approved flat compositions render a standard 1200×630 PNG', async () => {
	for (const template of templates) {
		const preview = { ...staticSocialPreview('/invite#recipient-private-token'), template };
		const svg = buildSocialCardSvg(preview);
		assert.match(svg, new RegExp(`data-preview-template="${template}"`));
		assert.match(svg, /data-preview-variant="invite"/);
		assert.doesNotMatch(svg, /linearGradient|radialGradient|feDropShadow|recipient|private-token/);
		assert.equal(textNodes(svg, 'title').map((line) => line.text).join(' '), preview.title);
		const png = Buffer.from(await renderSocialCardPng(preview, []));
		assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
		assert.equal(png.readUInt32BE(16), 1200);
		assert.equal(png.readUInt32BE(20), 630);
	}
});

test('photo and gallery layouts retain real pixels across every template', () => {
	for (const template of templates) {
		for (const imageCount of [1, 2, 3, 4, 6]) {
			const svg = buildSocialCardSvg({ ...gallery, template, imageCount }, Array.from({ length: Math.min(imageCount, 4) }, () => ONE_PIXEL_PNG));
			assert.equal((svg.match(/data-preview-image=/g) || []).length, Math.min(imageCount, 4));
			assert.match(svg, /clip-0/);
			const pixels = new Resvg(svg, socialCardRenderOptions()).render().pixels;
			// Probe the actual photo regions. Gallery captions deliberately cover the
			// bottom of the strip, so sample each image above that overlap.
			for (const match of svg.matchAll(/<image data-preview-image="\d+"[^>]* x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
				const [x, y, width, height] = match.slice(1).map(Number);
				const sampleX = Math.floor(x + width / 2);
				const sampleY = Math.floor(y + height / 2);
				assert.deepEqual(pixel(pixels, sampleX, sampleY), [255, 0, 0], `${template}, ${imageCount} photos at ${sampleX},${sampleY}`);
			}
		}
	}
});

test('Colour Blocks galleries use a full-width photo strip, yellow caption and white wordmark panel', () => {
	for (const title of ['Little moments lately.', 'W'.repeat(200)]) {
		const preview = { ...gallery, template: 'colour-blocks' as const, title };
		const svg = buildSocialCardSvg(preview, [ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG]);
		assert.match(svg, /data-preview-composition="photo-strip"/);
		const pixels = cardPixels(preview, [ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG, ONE_PIXEL_PNG]);
		assert.deepEqual(pixel(pixels, 20, 20), [255, 0, 0]);
		assert.deepEqual(pixel(pixels, 20, 600), [255, 194, 14]);
		assert.deepEqual(pixel(pixels, 1180, 610), [255, 255, 255]);
		const titles = textNodes(svg, 'title');
		const body = textNodes(svg, 'description');
		assert.ok(titles.length <= 2 && titles.length > 0);
		if (title === 'Little moments lately.') assert.equal(titles.length, 1);
		assert.ok(titles.at(-1)!.y + 12 < body[0].y - 24);
		assert.ok(body.at(-1)!.y + 8 < 630);
		for (const line of titles) assert.ok(socialTextWidth(line.text, line.size) <= line.width);
	}
});

test('Colour Blocks photo pages overlap a white caption over a blue side panel and real photo', () => {
	const preview = { ...gallery, kind: 'webpage' as const, variant: 'webpage' as const, template: 'colour-blocks' as const, layout: 'photo' as const, title: 'The weekend collection.' };
	const svg = buildSocialCardSvg(preview, [ONE_PIXEL_PNG]);
	assert.match(svg, /data-preview-composition="page-overlap"/);
	const pixels = cardPixels(preview, [ONE_PIXEL_PNG]);
	assert.deepEqual(pixel(pixels, 20, 20), [89, 189, 255]);
	assert.deepEqual(pixel(pixels, 900, 200), [255, 0, 0]);
	assert.deepEqual(pixel(pixels, 20, 610), [255, 255, 255]);
	for (const line of textNodes(svg, 'title')) assert.ok(line.x + socialTextWidth(line.text, line.size) < 820);
});

test('explicit text/photo/gallery layouts remain safe with unavailable media', () => {
	for (const layout of ['text', 'photo', 'gallery'] as const) {
		const noMedia = buildSocialCardSvg({ ...gallery, images: [], imageCount: 0, layout });
		assert.match(noMedia, /data-preview-layout="text"/);
		assert.doesNotMatch(noMedia, /data-preview-image=/);
	}
	const text = buildSocialCardSvg({ ...gallery, layout: 'text' }, [ONE_PIXEL_PNG]);
	assert.doesNotMatch(text, /data-preview-image=/);
	const photo = buildSocialCardSvg({ ...gallery, layout: 'photo' }, [ONE_PIXEL_PNG, ONE_PIXEL_PNG]);
	assert.equal((photo.match(/data-preview-image=/g) || []).length, 1);
});

test('undecodable or missing media paints a flat brand tile, and external image URLs are refused', () => {
	for (const href of [null, 'data:image/png;base64,iVBORw0KGgo=', 'https://example.com/private.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
		const preview = { ...gallery, template: 'editorial' as const, imageCount: 1 };
		const svg = buildSocialCardSvg(preview, [href]);
		assert.deepEqual(pixel(cardPixels(preview, [href]), 900, 300), [255, 105, 180]);
		assert.doesNotMatch(svg, /example\.com|data:image\/svg\+xml;base64,PHN2Zz4=/);
	}
});

test('titles, descriptions, author and eyebrow use measured widths on every template and layout', () => {
	for (const template of templates) for (const layout of ['text', 'photo', 'gallery'] as const) {
		const svg = buildSocialCardSvg({ ...gallery, template, layout,
			title: 'WOW MMM WWW MMM WWW MMM WWW MMM WWW A LONG ANNOUNCEMENT',
			description: 'MMMM WWWW MMMM WWWW MMMM WWWW MMMM WWWW MMMM WWWW MMMM WWWW',
			author: 'Bartholomew Featherstonehaugh-Cholmondeley the Third of Melbourne',
			eyebrow: 'THINGTIME A VERY LONG DESCRIPTION THAT KEEPS GOING AND GOING' });
		for (const role of ['title', 'description', 'author', 'eyebrow']) {
			const lines = textNodes(svg, role);
			assert.ok(lines.length, role);
			assert.equal(new Set(lines.map((line) => line.y)).size, lines.length);
			for (const line of lines) {
				const spacing = role === 'eyebrow' ? Math.max(0, line.text.length - 1) * 2 : 0;
				assert.ok(socialTextWidth(line.text, line.size) + spacing <= line.width, `${template}/${layout} ${role}: ${line.text}`);
			}
		}
	}
	const unbroken = buildSocialCardSvg({ ...gallery, title: 'https://example.com/' + 'W'.repeat(200), template: 'editorial' });
	assert.ok(textNodes(unbroken, 'title').at(-1)?.text.endsWith('…'));
});

test('poll, body and badge rows never overlap, and labels cannot escape their panel', () => {
	for (const template of templates) {
		const svg = buildSocialCardSvg({ ...gallery, template, options: ['W'.repeat(200), 'Beach', 'Gallery'], badges: ['Build with Thingtime', 'W'.repeat(200), 'API + SDK'], title: 'W'.repeat(200) });
		const options = textNodes(svg, 'option');
		const badges = textNodes(svg, 'badge');
		assert.equal(options.length, 3);
		assert.equal(badges.length, 3);
		assert.ok(Math.max(...textNodes(svg, 'description').map((line) => line.y + 8)) < options[0].y - 20);
		assert.ok(options.at(-1)!.y + 8 < badges[0].y - 18);
		for (const label of options) assert.ok(socialTextWidth(label.text, label.size) <= label.width - 24);
		for (const label of badges) assert.ok(socialTextWidth(label.text, label.size) <= 134);
	}
});

test('uncapped public labels stay bounded in rendering work and show visible truncation', () => {
	const enormous = 'a'.repeat(200_000);
	const started = performance.now();
	const svg = buildSocialCardSvg({ ...gallery, options: [enormous], badges: [enormous], author: enormous, eyebrow: enormous });
	assert.ok(performance.now() - started < 5_000);
	for (const role of ['option', 'badge', 'author', 'eyebrow']) assert.ok(textNodes(svg, role)[0].text.endsWith('…'), role);
});

test('XML injection, illegal XML characters and unsupported emoji never reach SVG text', () => {
	const svg = buildSocialCardSvg({ ...gallery, title: '<Cats & things> 😻\uFFFF', description: 'Six\uFFFF very important cats.', eyebrow: 'PHOTO\uFFFF SET', author: '🌸 Rosie\uFFFF', initial: '🌸', badges: ['🎉', '#🎉', '#garden', 'Photo'], options: ['Yes\uFFFF'] });
	assert.equal(textNodes(svg, 'title').map((line) => line.text).join(' '), '&lt;Cats &amp; things&gt;');
	assert.doesNotMatch(svg, /<Cats & things>|\p{Extended_Pictographic}|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u);
	assert.deepEqual(textNodes(svg, 'badge').map((line) => line.text), ['#garden', 'Photo']);
	assert.doesNotThrow(() => new Resvg(svg, socialCardRenderOptions()).render());
	assert.doesNotThrow(() => new Resvg(buildSocialCardSvg(staticSocialPreview('/docs/\uFFFFapi')), socialCardRenderOptions()).render());
});

test('bundled fonts draw visible headline glyphs without any system font', () => {
	assert.equal(socialCardRenderOptions()?.font?.loadSystemFonts, false);
	const preview: SocialPreview = { ...gallery, template: 'editorial', layout: 'text', title: 'The weekend garden bed', author: undefined, badges: [], options: [] };
	const pixels = cardPixels(preview);
	const blank = cardPixels({ ...preview, title: '', description: '', eyebrow: '' });
	let differing = 0;
	for (let y = 205; y < 450; y++) for (let x = 56; x < 820; x++) {
		const i = (y * 1200 + x) * 4;
		if (pixels[i] < blank[i] - 50) differing++;
	}
	assert.ok(differing > 1000, `expected drawn headline ink, found ${differing} pixels`);
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

// A byte cap is not a memory cap. Every format the loader accepts compresses
// uniform pixels to almost nothing, so the bound that actually protects a
// public, unauthenticated renderer is on the decoded pixels — read from the
// image's own header, before resvg is asked to allocate them.
const pngOfSize = (width: number, height: number): Uint8Array => {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buffer: Buffer): number => {
		let c = 0xffffffff;
		for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer): Buffer => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const checksum = Buffer.alloc(4);
		checksum.writeUInt32BE(crc(body));
		return Buffer.concat([length, body, checksum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 0; // greyscale
	return new Uint8Array(
		Buffer.concat([
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
			chunk('IHDR', header),
			chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * Math.min(height, 64)))),
			chunk('IEND', Buffer.alloc(0))
		])
	);
};

test('image dimensions are read from the header of each accepted format', () => {
	assert.deepEqual(socialCardImageExtent(pngOfSize(1200, 630)), { width: 1200, height: 630 });
	// GIF87a, 8×5: logical screen width/height are little-endian at offset 6.
	assert.deepEqual(
		socialCardImageExtent(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 8, 0, 5, 0, 0, 0, 0])),
		{ width: 8, height: 5 }
	);
	// JPEG: SOI, an APP0 segment that must be skipped by its length, then SOF0
	// carrying height before width.
	assert.deepEqual(
		socialCardImageExtent(
			new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03, 0, 0, 0])
		),
		{ width: 1200, height: 630 }
	);
	// Lossy WebP: a VP8 keyframe's 14-bit dimensions follow the start code.
	const webp = new Uint8Array(30);
	webp.set(Buffer.from('RIFF', 'ascii'), 0);
	webp.set(Buffer.from('WEBP', 'ascii'), 8);
	webp.set(Buffer.from('VP8 ', 'ascii'), 12);
	webp.set([0x9d, 0x01, 0x2a], 23);
	webp.set([0xb0, 0x04, 0x76, 0x02], 26);
	assert.deepEqual(socialCardImageExtent(webp), { width: 1200, height: 630 });
});

test('an unmeasurable or mislabelled body never reaches the renderer', () => {
	// The declared Content-Type is author-supplied metadata, so the extent is
	// dispatched on magic bytes; anything unrecognised fails closed.
	assert.equal(socialCardImageExtent(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0x2f, 0x3e])), null);
	assert.equal(socialCardImageExtent(new Uint8Array(0)), null);
	// A truncated PNG header must not read past the bytes it actually has.
	assert.equal(socialCardImageExtent(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), null);
	// A zero dimension is not a renderable image.
	assert.deepEqual(socialCardImageExtent(pngOfSize(0, 630)), null);
});

test('a decompression bomb is rejected on its pixel count, not its byte count', () => {
	// 40000×40000 of one flat colour: a 1.5 MiB file that passes the 2 MiB byte
	// cap and asks resvg for 5.96 GiB of RGBA.
	const bomb = pngOfSize(40_000, 40_000);
	assert.ok(bomb.byteLength < 2 * 1024 * 1024, `the bomb only bites while it fits the byte cap (was ${bomb.byteLength})`);
	const extent = socialCardImageExtent(bomb);
	assert.deepEqual(extent, { width: 40_000, height: 40_000 });
	assert.ok((extent!.width * extent!.height) > 40_000_000, 'the guard must reject this on pixels');
	// An ordinary phone photo stays well inside the same bound.
	const photo = socialCardImageExtent(pngOfSize(4032, 3024))!;
	assert.ok(photo.width * photo.height < 40_000_000);
});


test('every preview carries the exact canonical voxel wordmark and brand typography', () => {
	for (const icon of [false, true]) assert.equal(socialCardLogoSvg(icon), buildLogoSvg({
		matrix: icon ? LOGO_ICON_MATRIX : LOGO_FULL_MATRIX, colourMap: LOGO_DEFAULT_COLOURS
	}).svg);
	for (const path of ['/', '/invite', '/feed', '/docs', '/profile']) {
		const svg = buildSocialCardSvg(staticSocialPreview(path));
		const encoded = svg.match(/data-brand-asset="wordmark"[^>]*href="data:image\/svg\+xml;base64,([^"]+)"/);
		assert.ok(encoded, path);
		assert.equal(Buffer.from(encoded[1], 'base64').toString('utf8'), socialCardLogoSvg());
		assert.doesNotMatch(svg, />THINGTIME<|font-family="Arial/);
		assert.ok(svg.includes(`font-family="${SOCIAL_CARD_BRAND.heading}, sans-serif"`));
		assert.ok(svg.includes(`font-family="${SOCIAL_CARD_BRAND.body}, sans-serif"`));
		assert.ok(svg.includes(`font-family="${SOCIAL_CARD_BRAND.mono}, monospace"`));
	}
	assert.deepEqual([...new Set(SOCIAL_CARD_BRAND_FONTS.map((font) => font.family))].sort(),
		[SOCIAL_CARD_BRAND.heading, SOCIAL_CARD_BRAND.body, SOCIAL_CARD_BRAND.mono].sort());
});
