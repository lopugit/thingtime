import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import sharp from 'sharp';
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
	assert.match(output!, /^data:image\/jpeg;base64,/);
	const bytes = Buffer.from(output!.split(',')[1], 'base64');
	assert.ok(bytes.length <= 16384);
	const metadata = await sharp(bytes).metadata();
	assert.equal(metadata.width, 128);
	assert.equal(metadata.height, 128);
	assert.equal(metadata.exif, undefined);
	for (const invalid of ['https://example.com/photo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,ZmFrZQ==', 'x'.repeat(32001)])
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
