import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import sharp from 'sharp';
import { attachmentImageResponse } from '../attachments/imageVariants';
import { loadSocialCardAttachmentImage, type SocialCardImageDependencies } from './socialCardImages';
import { renderSocialCardPng } from './socialCard';
import type { SocialPreview } from './socialPreview';

const source = { ok: true as const, image: true, size: 8_222_083, url: 'server-generated-only', cacheKey: 'version-one', version: 'immutable-one' };
const redThumbnail = () => sharp({ create: { width: 800, height: 1200, channels: 3, background: '#ee2211' } }).webp().toBuffer();
const dependencies = (bytes: Buffer, authorize: SocialCardImageDependencies['authorize'] = async () => source): SocialCardImageDependencies => ({
 authorize,
 thumbnail: async (_source, width) => {
  assert.equal(width, 640);
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp' } });
 }
});

test('large original photos use the canonical bounded thumbnail and embed actual photo pixels in the PNG card', async () => {
 // High-entropy image bytes represent an ordinary multi-megabyte attachment;
 // the previous loader discarded it before requesting any stored content.
 const raw = Buffer.alloc(1300 * 1000 * 3);
 let state = 12345;
 for (let i = 0; i < raw.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; raw[i] = state & 255; }
 const original = await sharp(raw, { raw: { width: 1300, height: 1000, channels: 3 } }).png().toBuffer();
 assert.ok(original.length > 2 * 1024 * 1024);
 let reads = 0;
 const server = createServer((_request, response) => { reads++; response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': original.length }); response.end(original); });
 await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
 try {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let authorizations = 0;
  const authorized = { ...source, size: original.length, url: `http://127.0.0.1:${address.port}/stored-version`, cacheKey: `photo-pixels-${address.port}` };
  const loaded = await loadSocialCardAttachmentImage('att_public_photo', {
   authorize: async () => { authorizations++; return authorized; },
   thumbnail: attachmentImageResponse
  });
  assert.ok(loaded);
  assert.match(loaded.uri, /^data:image\/png;base64,/);
  assert.equal(reads, 1, 'canonical variant reads the stored original once');
  assert.equal(authorizations, 2, 'authorization is checked before cache access and again after decoding');
  const normalized = Buffer.from(loaded.uri.split(',')[1], 'base64');
  const metadata = await sharp(normalized).metadata();
  assert.ok(metadata.width! <= 640 && metadata.height! <= 640);
  assert.equal(loaded.pixels, metadata.width! * metadata.height!);
  const preview: SocialPreview = { kind: 'image-post', variant: 'image-post', path: '/post/photo', title: 'A real stored photo', description: 'Photo pixels must survive thumbnail generation and card rendering.', eyebrow: 'PHOTO', article: true, badges: [], options: [], images: [{ attachmentId: 'att_public_photo', label: 'Stored photo' }], imageCount: 1 };
  const painted = await renderSocialCardPng(preview, [loaded.uri]);
  const placeholder = await renderSocialCardPng(preview, [null]);
  const actualPixels = await sharp(painted).raw().toBuffer();
  const fallbackPixels = await sharp(placeholder).raw().toBuffer();
  assert.equal(actualPixels.length, fallbackPixels.length);
  let changed = 0;
  for (let i = 0; i < actualPixels.length; i += 4) {
   if (Math.abs(actualPixels[i] - fallbackPixels[i]) + Math.abs(actualPixels[i + 1] - fallbackPixels[i + 1]) + Math.abs(actualPixels[i + 2] - fallbackPixels[i + 2]) > 30) changed++;
  }
  assert.ok(changed > 20_000, `photo changed only ${changed} card pixels; a placeholder is not photo acceptance`);
 } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test('unreadable and non-image attachments never request even a cached thumbnail', async () => {
 for (const authorized of [{ ok: false as const }, { ...source, image: false }, { ...source, size: 21 * 1024 * 1024 }]) {
  let thumbnailCalled = false;
  assert.equal(await loadSocialCardAttachmentImage('att_private', { authorize: async () => authorized, thumbnail: async () => { thumbnailCalled = true; throw new Error('must not fetch'); } }), null);
  assert.equal(thumbnailCalled, false);
 }
});

test('revocation and exact-version replacement during thumbnail work discard decoded bytes', async () => {
 const bytes = await redThumbnail();
 for (const after of [{ ok: false as const }, { ...source, version: 'replaced' }, { ...source, cacheKey: 'replaced' }]) {
  let calls = 0;
  assert.equal(await loadSocialCardAttachmentImage('att_recheck', dependencies(bytes, async () => ++calls === 1 ? source : after)), null);
  assert.equal(calls, 2);
 }
});

test('thumbnail bytes are format-verified and remain bounded before decoding', async () => {
 for (const response of [new Response('<svg/>', { headers: { 'Content-Type': 'image/webp' } }), new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/webp' } }), new Response('unavailable', { status: 415 })]) {
  assert.equal(await loadSocialCardAttachmentImage('att_invalid', { authorize: async () => source, thumbnail: async () => response }), null);
 }
});

test('portrait thumbnails normalize to PNG within both dimensions for resvg', async () => {
 const loaded = await loadSocialCardAttachmentImage('att_portrait', dependencies(await redThumbnail()));
 assert.ok(loaded);
 const metadata = await sharp(Buffer.from(loaded.uri.split(',')[1], 'base64')).metadata();
 assert.equal(metadata.format, 'png');
 assert.equal(metadata.width, 427);
 assert.equal(metadata.height, 640);
});

test('a valid compressed thumbnail exceeding the canonical decoded-pixel budget is refused', async () => {
 const bomb = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: '#ee2211' } }).webp({ quality: 1, effort: 0 }).toBuffer();
 assert.ok(bomb.length < 2 * 1024 * 1024, 'compressed bytes alone cannot enforce a memory budget');
 const metadata = await sharp(bomb).metadata();
 assert.ok(metadata.width! * metadata.height! > 40_000_000);
 assert.equal(await loadSocialCardAttachmentImage('att_pixel_bomb', dependencies(bomb)), null);
});
