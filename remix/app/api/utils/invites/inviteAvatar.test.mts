import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
let choice: any = { kind: 'off' };
mock.module(new URL('../moderation/providers.ts', import.meta.url).href, {
	namedExports: { resolveConfiguredModerationProvider: async () => choice }
});
const { normalizeInviteAvatar } = await import('./inviteAvatar');
test('avatars are bounded raster thumbnails, with metadata removed and moderation enforced', async () => {
	const source = await sharp({ create: { width: 256, height: 128, channels: 3, background: '#4488aa' } })
		.png()
		.toBuffer();
	const input = `data:image/png;base64,${source.toString('base64')}`;
	const output = await normalizeInviteAvatar(input);
	assert.match(output!, /^data:image\/png;base64,/);
	const bytes = Buffer.from(output!.split(',')[1], 'base64');
	assert.ok(bytes.length <= 80 * 1024);
	const metadata = await sharp(bytes).metadata();
	assert.equal(metadata.width, 128);
	assert.equal(metadata.height, 128);
	assert.equal(metadata.exif, undefined);
	for (const invalid of ['https://example.com/photo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,ZmFrZQ==', 'x'.repeat(112001)])
		await assert.rejects(() => normalizeInviteAvatar(invalid));
	assert.equal(await normalizeInviteAvatar(null), null);
	choice = { kind: 'provider', provider: { analyzeImage: async () => ({ nsfw: true }) } };
	await assert.rejects(() => normalizeInviteAvatar(input), /different avatar/);
	choice = {
		kind: 'provider',
		provider: {
			analyzeImage: async () => {
				throw new Error('offline');
			}
		}
	};
	await assert.rejects(() => normalizeInviteAvatar(input), /review is unavailable/);
});

test('PNG normalization preserves detailed 128px pixels and alpha without palette quantization', async () => {
 const pixels = randomBytes(128 * 128 * 4);
 for (let i = 3; i < pixels.length; i += 4) pixels[i] = 128;
 const source = await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer();
 assert.ok(source.length > 16 * 1024, 'Fixture must exercise the old JPEG byte ceiling');
 let moderated = false;
 choice = { kind: 'provider', provider: { analyzeImage: async (image: any) => {
  assert.equal(image.contentType, 'image/png');
  assert.equal(image.filename, 'invite-avatar.png');
  assert.deepEqual(await sharp(image.bytes).ensureAlpha().raw().toBuffer(), pixels);
  moderated = true;
  return { nsfw: false, tosViolation: false };
 } } };
 const output = await normalizeInviteAvatar(`data:image/png;base64,${source.toString('base64')}`);
 const bytes = Buffer.from(output!.split(',')[1], 'base64');
 assert.ok(bytes.length <= 80 * 1024);
 assert.deepEqual(await sharp(bytes).ensureAlpha().raw().toBuffer(), pixels);
 assert.equal(moderated, true);
 choice = { kind: 'off' };
});
