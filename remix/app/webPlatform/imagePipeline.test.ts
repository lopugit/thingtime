import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { ImageMagick, MagickFormat, Orientation } from '@imagemagick/magick-wasm';
import { SVG_DOCUMENT_HEAD, compressImage, imageDimensions, isImageFile, pngAnimationFrames, validateStaticSvg, type ImageWasmAssets } from './imagePipeline';

const require = createRequire(import.meta.url);
const assets: ImageWasmAssets = {
	magick: new Uint8Array(readFileSync(require.resolve('@imagemagick/magick-wasm/magick.wasm'))),
	resvg: new Uint8Array(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')))
};
const settings = { maxWidth: 16, maxHeight: 16, imageQuality: 75 };
function crc(bytes: Uint8Array) {
	let c = 0xffffffff;
	for (const byte of bytes) {
		c ^= byte;
		for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
	}
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
	const b = Buffer.alloc(data.length + 12);
	b.writeUInt32BE(data.length, 0);
	b.write(type, 4);
	b.set(data, 8);
	b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4);
	return b;
}
// Independent PNG encoder: real fixture bytes, including partial alpha and a
// non-square source to exercise dimensions without relying on the pipeline.
function png(alpha = false) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(32, 0);
	header.writeUInt32BE(24, 4);
	header[8] = 8;
	header[9] = 6;
	const pixels = Buffer.alloc(24 * (1 + 32 * 4));
	for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) pixels.set([x * 7, y * 9, 100, alpha && x < 16 ? 80 : 255], y * 129 + 1 + x * 4);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(pixels)),
		chunk('IEND', new Uint8Array())
	]);
}
function animation() {
	return Uint8Array.from([
		...Buffer.from('GIF89a'),
		1,
		0,
		1,
		0,
		0x80,
		0,
		0,
		255,
		0,
		0,
		0,
		0,
		255,
		0x21,
		0xff,
		11,
		...Buffer.from('NETSCAPE2.0'),
		3,
		1,
		0,
		0,
		0,
		0x21,
		0xf9,
		4,
		0,
		10,
		0,
		0,
		0,
		0x2c,
		0,
		0,
		0,
		0,
		1,
		0,
		1,
		0,
		0,
		2,
		2,
		0x44,
		1,
		0,
		0x21,
		0xf9,
		4,
		0,
		20,
		0,
		0,
		0,
		0x2c,
		0,
		0,
		0,
		0,
		1,
		0,
		1,
		0,
		0,
		2,
		2,
		0x4c,
		1,
		0,
		0x3b
	]);
}
function patchAnimation() {
	const bytes = [
		...Buffer.from('GIF89a'),
		64,
		0,
		48,
		0,
		0x81,
		0,
		0,
		0,
		0,
		255,
		255,
		0,
		0,
		0,
		255,
		0,
		0,
		0,
		0,
		0x21,
		0xff,
		11,
		...Buffer.from('NETSCAPE2.0'),
		3,
		1,
		0,
		0,
		0
	];
	const frame = (x: number, y: number, width: number, height: number, color: number, delay: number) => {
		// Clearing the tiny LZW dictionary before each pixel keeps codes at
		// three bits. This independent fixture encoder needs no native tooling.
		const codes = Array.from({ length: width * height }, () => [4, color])
			.flat()
			.concat(5);
		const packed = new Uint8Array(Math.ceil((codes.length * 3) / 8));
		codes.forEach((code, index) => {
			const bit = index * 3;
			packed[bit >>> 3] |= code << (bit & 7);
			if ((bit & 7) > 5) packed[(bit >>> 3) + 1] |= code >>> (8 - (bit & 7));
		});
		bytes.push(0x21, 0xf9, 4, 4, delay, 0, 0, 0, 0x2c, x, 0, y, 0, width, 0, height, 0, 0, 2);
		for (let offset = 0; offset < packed.length; offset += 255) {
			const block = packed.subarray(offset, offset + 255);
			bytes.push(block.length, ...block);
		}
		bytes.push(0);
	};
	frame(0, 0, 64, 48, 0, 10);
	frame(8, 8, 4, 4, 1, 20);
	frame(32, 24, 4, 4, 2, 30);
	frame(8, 8, 4, 4, 0, 40);
	return Uint8Array.from([...bytes, 0x3b]);
}
test('image classification and dimensions accept local uncommon raster files without upscaling', () => {
	for (const name of ['A.TIFF', 'a.heic', 'a.psd', 'a.svg', 'a.avif', 'a.jxl']) assert.ok(isImageFile({ name }));
	assert.ok(isImageFile({ type: 'image/unknown' }));
	assert.equal(isImageFile({ name: 'a.mp4', type: 'video/mp4' }), false);
	assert.deepEqual(imageDimensions(32, 24, settings), { width: 16, height: 12 });
	assert.deepEqual(imageDimensions(3, 2, settings), { width: 3, height: 2 });
	assert.throws(() => imageDimensions(Infinity, 1, settings));
});
test('real local raster bytes roundtrip through every offered static output', async () => {
	for (const imageFormat of ['webp', 'png', 'jpeg', 'avif', 'gif'] as const) {
		const { blob, receipt } = await compressImage(new Blob([png()], { type: 'image/png' }), { ...settings, imageFormat }, assets);
		assert.ok(blob.size > 0);
		assert.equal(blob.type, `image/${imageFormat}`);
		assert.equal(receipt.width, 16);
		assert.equal(receipt.height, 12);
		assert.equal(receipt.frameCount, 1);
		ImageMagick.read(new Uint8Array(await blob.arrayBuffer()), (image) => {
			assert.equal(image.width, 16);
			assert.equal(image.height, 12);
		});
	}
});
test('transparency survives auto output, JPEG requires explicit flattening', async () => {
	const file = new Blob([png(true)], { type: 'image/png' });
	const { blob, receipt } = await compressImage(file, settings, assets);
	assert.equal(receipt.hasAlpha, true);
	ImageMagick.read(new Uint8Array(await blob.arrayBuffer()), (image) => assert.equal(image.isOpaque, false));
	await assert.rejects(compressImage(file, { ...settings, imageFormat: 'jpeg' }, assets), /transparency/);
	await assert.rejects(compressImage(file, { ...settings, imageFormat: 'gif' }, assets), /transparency/);
	const flat = await compressImage(file, { ...settings, imageFormat: 'jpeg', imageBackground: '#ffffff' }, assets);
	assert.match(flat.receipt.note, /flattened/);
	ImageMagick.read(new Uint8Array(await flat.blob.arrayBuffer()), (image) => assert.equal(image.isOpaque, true));
});
test('official libheif HEIC fixtures decode with dimensions and transparency intact', async () => {
	for (const [name, transparent] of [
		['colors-no-alpha.heic', false],
		['colors-with-alpha.heic', true]
	] as const) {
		const source = readFileSync(new URL(`../../scripts/media-acceptance/fixtures/${name}`, import.meta.url));
		const { blob, receipt } = await compressImage(new Blob([source], { type: 'image/heic' }), { maxWidth: 128, maxHeight: 128 }, assets, name);
		assert.equal(receipt.width, 64);
		assert.equal(receipt.height, 64);
		assert.equal(receipt.frameCount, 1);
		assert.equal(receipt.hasAlpha, transparent);
		ImageMagick.read(new Uint8Array(await blob.arrayBuffer()), (image) => assert.equal(!image.isOpaque, transparent));
	}
});
test('real GIF animation retains both frames, delay and loop count or refuses incompatible outputs', async () => {
	const file = new Blob([animation()], { type: 'image/gif' });
	for (const imageFormat of ['webp', 'gif'] as const) {
		const { receipt } = await compressImage(file, { ...settings, imageFormat }, assets);
		assert.equal(receipt.animated, true);
		assert.equal(receipt.frameCount, 2);
		assert.ok(Math.abs(receipt.duration - 0.3) < 0.001);
	}
	await assert.rejects(compressImage(file, { ...settings, imageFormat: 'png' }, assets), /Animation requires/);
});
test('delta-rectangle GIF/WebP frames verify against composited animation canvases', async () => {
	const file = new Blob([patchAnimation()], { type: 'image/gif' });
	for (const imageFormat of ['webp', 'gif'] as const) {
		const { blob, receipt } = await compressImage(file, { maxWidth: 128, maxHeight: 128, imageFormat }, assets);
		assert.equal(receipt.frameCount, 4);
		assert.equal(receipt.width, 64);
		assert.equal(receipt.height, 48);
		assert.equal(receipt.duration, 1);
		ImageMagick.readCollection(new Uint8Array(await blob.arrayBuffer()), (frames) => {
			assert.equal(frames.length, 4);
			if (imageFormat === 'webp')
				assert.ok(
					frames.some((frame) => frame.width < 64 || frame.height < 48),
					'fixture must exercise encoded patch rectangles'
				);
			frames.coalesce();
			assert.deepEqual(
				frames.map((frame) => [frame.width, frame.height]),
				Array.from({ length: 4 }, () => [64, 48])
			);
			assert.deepEqual(
				frames.map((frame) => frame.animationDelay / frame.animationTicksPerSecond),
				[0.1, 0.2, 0.3, 0.4]
			);
			assert.equal(frames[0].animationIterations, 0);
			assert.equal(new Set(frames.map((frame) => frame.signature)).size, 4, 'all four meaningful rendered states must remain distinct');
		});
	}
});
test('BMP TIFF ICO TGA and TIFF orientation use the bundled raster decoders', async () => {
	// Warm the same strict decoder policy used by the worker.
	await compressImage(new Blob([png()]), settings, assets);
	for (const format of [MagickFormat.Bmp, MagickFormat.Tiff, MagickFormat.Ico, MagickFormat.Tga]) {
		const source = ImageMagick.read(png(), (image) => image.write(format, (data) => new Uint8Array(data)));
		let result;
		try {
			result = await compressImage(new Blob([source]), settings, assets, format === MagickFormat.Tga ? 'fixture.tga' : undefined);
		} catch (error) {
			throw new Error(`Decode ${format} (${source.length} bytes) failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		const { receipt } = result;
		assert.equal(receipt.width, 16);
		assert.equal(receipt.height, 12);
	}
	const oriented = ImageMagick.read(png(), (image) => {
		image.orientation = Orientation.RightTop;
		return image.write(MagickFormat.Tiff, (data) => new Uint8Array(data));
	});
	const result = await compressImage(new Blob([oriented]), settings, assets);
	assert.equal(result.receipt.width, 12);
	assert.equal(result.receipt.height, 16);
});
test('multi-page sources and dangerous pseudo-format bytes fail explicitly', async () => {
	await compressImage(new Blob([png()]), settings, assets);
	const pages = ImageMagick.readCollection(animation(), (images) => images.write(MagickFormat.Tiff, (data) => new Uint8Array(data)));
	await assert.rejects(compressImage(new Blob([pages]), settings, assets), /Multi-page or layered/);
	for (const source of ['push graphic-context\nviewbox 0 0 10 10\nfill red\nrectangle 0,0 10,10\npop graphic-context', '%!PS\nshowpage'])
		await assert.rejects(compressImage(new Blob([source]), settings, assets));
	assert.throws(
		() => ImageMagick.read(new TextEncoder().encode('push graphic-context\npop graphic-context'), MagickFormat.Mvg, () => {}),
		/NotAuthorized/
	);
});
test('APNG animation control is detected before libpng can flatten it', async () => {
	const still = png();
	const control = Buffer.alloc(8);
	control.writeUInt32BE(2, 0);
	const animated = Buffer.concat([still.subarray(0, 33), chunk('acTL', control), still.subarray(33)]);
	assert.equal(pngAnimationFrames(animated), 2);
	await assert.rejects(compressImage(new Blob([animated], { type: 'image/png' }), settings, assets), /Animated PNG/);
});
test('missing and malformed local image engines reject without starting decode', async () => {
	for (const invalid of [undefined, {}, { magick: new Uint8Array() }] as any[])
		await assert.rejects(compressImage(new Blob([png()]), settings, invalid), /missing or malformed/);
	// A fresh process exercises actual WASM instantiation, rather than the warm
	// shared engine above. A corrupt module must reject, never leave Run pending.
	const result = spawnSync(
		process.execPath,
		[
			'--import',
			'tsx',
			'-e',
			`const {compressImage}=require('./app/webPlatform/imagePipeline.ts'); compressImage(new Blob(['image']),{maxWidth:16,maxHeight:16},{magick:new Uint8Array([0,97,115,109,1,0,0,0])}).then(()=>process.exit(2),()=>console.log('EXPECTED_REJECTION'))`
		],
		{ cwd: process.cwd(), timeout: 5000, encoding: 'utf8' }
	);
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /EXPECTED_REJECTION/);
});
// A chosen file decides this header test, so a header that never reaches
// `<svg` must cost what it is, not exponential backtracking on the browser's
// only thread. The lazy comment body this replaced took 160ms at 24
// repetitions of `--><!--`, and the 4096-byte window holds ~580.
test('SVG detection reads commented headers without exponential backtracking', () => {
	for (const header of [
		'<svg xmlns="http://www.w3.org/2000/svg">',
		'  <svg>',
		'<?xml version="1.0"?><svg >',
		'<?xml version="1.0"?>\n<!-- a -->\n<!-- b --> <svg\t',
		'<!----><svg>',
		'<!-- -- --><svg>'
	])
		assert.ok(SVG_DOCUMENT_HEAD.test(header), header);
	for (const header of ['<html><svg>', '<svgx>', '<!-- unterminated <svg>', '<?xml?><!-- c --><notsvg>'])
		assert.equal(SVG_DOCUMENT_HEAD.test(header), false, header);
	const hostile = '<!--' + '--><!--'.repeat(580);
	const started = process.hrtime.bigint();
	assert.equal(SVG_DOCUMENT_HEAD.test(hostile), false);
	assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 1000, 'the refusal must stay linear');
});
test('static SVG renders locally while text, animation and external dependencies fail', async () => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#ff0000"/></svg>';
	const result = await compressImage(new Blob([svg], { type: 'image/svg+xml' }), settings, assets);
	assert.equal(result.receipt.width, 16);
	assert.equal(result.receipt.height, 12);
	assert.match(result.receipt.note, /SVG rasterized/);
	for (const body of ['<text>Hello</text>', '<animate attributeName="x"/>', '<script/>', '<foreignObject/>'])
		assert.throws(() => validateStaticSvg(`<svg>${body}</svg>`));
	assert.throws(() => validateStaticSvg('<!DOCTYPE svg><svg/>'));
	assert.doesNotThrow(() => validateStaticSvg('<svg><rect fill="url(\'#gradient\')"/><use href="#shape"/></svg>'));
	assert.throws(() => validateStaticSvg('<svg><use href="https://example.com/external.svg#shape"/></svg>'), /external references/);
	await assert.rejects(
		compressImage(
			new Blob([svg.replace('<rect', '<image href="https://example.com/image.png"/><rect')], { type: 'image/svg+xml' }),
			settings,
			assets
		),
		/external images/
	);
});

test('actual encoded image bytes meet targets, including lossless dimension reduction and impossible refusal', async () => {
	const source = new Blob([png(true)], { type: 'image/png' });
	const full = await compressImage(source, { ...settings, maxWidth: 32, maxHeight: 24, imageFormat: 'png' }, assets);
	const target = Math.floor(full.blob.size * 0.95);
	const fitted = await compressImage(source, { ...settings, maxWidth: 32, maxHeight: 24, imageFormat: 'png', maxOutputBytes: target }, assets);
	assert.ok(fitted.blob.size <= target);
	assert.ok(fitted.receipt.width < full.receipt.width);
	assert.equal(fitted.receipt.hasAlpha, true);
	assert.equal(fitted.receipt.frameCount, 1);
	const animated = await compressImage(
		new Blob([animation()], { type: 'image/gif' }),
		{ ...settings, imageFormat: 'webp', maxOutputBytes: 1000 },
		assets
	);
	assert.ok(animated.blob.size <= 1000);
	assert.equal(animated.receipt.frameCount, 2);
	assert.ok(animated.receipt.duration > 0);
	await assert.rejects(() => compressImage(source, { ...settings, imageFormat: 'png', maxOutputBytes: 1 }, assets), /maximum output size/);
	for (const maximum of [NaN, Infinity, -1, 0, 1.1])
		await assert.rejects(() => compressImage(source, { ...settings, maxOutputBytes: maximum }, assets));
});

test('animated size retries retain every frame, exact delays and loop count', async () => {
	const file = new Blob([patchAnimation()], { type: 'image/gif' });
	const options = { maxWidth: 128, maxHeight: 128, imageFormat: 'gif' as const, imageQuality: 100 };
	const original = await compressImage(file, options, assets);
	const maximum = Math.floor(original.blob.size * 0.95);
	const fitted = await compressImage(file, { ...options, maxOutputBytes: maximum }, assets);
	assert.ok(fitted.blob.size <= maximum);
	assert.equal(fitted.receipt.frameCount, 4);
	assert.equal(fitted.receipt.duration, 1);
	ImageMagick.readCollection(new Uint8Array(await fitted.blob.arrayBuffer()), (frames) => {
		assert.equal(frames.length, 4);
		assert.deepEqual(
			frames.map((frame) => frame.animationDelay / frame.animationTicksPerSecond),
			[0.1, 0.2, 0.3, 0.4]
		);
		assert.equal(frames[0].animationIterations, 0);
	});
});
