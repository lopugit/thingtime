import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { parseImageWidth, resizeAttachmentImage } from './imageVariants';

test('image previews use bounded canonical widths, resize real pixels and never upscale', async () => {
	assert.equal(parseImageWidth(null), undefined);
	for (const invalid of ['', '0', '9999999', '064', '-64', '64px']) assert.equal(parseImageWidth(invalid), null);
	const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#77aadd' } })
		.png()
		.toBuffer();
	const preview = await resizeAttachmentImage(original, 64);
	const metadata = await sharp(preview).metadata();
	assert.equal(metadata.width, 64);
	assert.equal(metadata.height, 32);
	assert.equal(metadata.format, 'webp');
	assert.ok(preview.length < original.length);
	assert.equal((await sharp(await resizeAttachmentImage(original, 1920)).metadata()).width, 800);
	await assert.rejects(resizeAttachmentImage(original, 4096));
	await assert.rejects(resizeAttachmentImage(Buffer.from('not an image'), 64));
});
