import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedBlob, compatibleManifest, managedUrl, publicAsset, publicLifetime, responseFromRecord } from '../public/media-cache-core.mjs';
import { MAX_FILE_BYTES, mediaStore } from '../public/media-cache-store.mjs';
const origin = 'https://thingtime.example';

test('capability negotiation requires this origin and a compatible attachment contract', () => {
	const manifest = (version) => ({ schemaVersion: 1, origin, features: { 'api.attachment-content': { version } } });
	for (const version of ['1.1.0', '1.2.0', '1.1.1']) assert.equal(compatibleManifest(manifest(version), origin), true);
	for (const version of ['1.0.9', '2.0.0', '1.1', undefined]) assert.equal(compatibleManifest(manifest(version), origin), false);
	assert.equal(compatibleManifest(manifest('1.1.0'), 'https://other.example'), false);
});
test('only managed content and public assets enter the cache policy', () => {
	assert.ok(managedUrl(new Request(`${origin}/api/v1/attachments/content?id=a`), origin));
	assert.equal(managedUrl(new Request(`${origin}/api/v1/attachments/content?id=a&cache=validate`), origin), null);
	for (const path of ['/api/v1/users/me', '/login', '/index.html', '/bundle.js', '/photo.png?token=private']) {
		assert.equal(publicAsset(new Request(`${origin}${path}`), origin), false);
	}
	assert.equal(publicAsset(new Request(`${origin}/font.woff2`), origin), true);
	for (const policy of ['private, max-age=300', 'no-store', 'public, max-age=0', 'no-cache, max-age=300']) {
		assert.equal(publicLifetime(new Response('bytes', { headers: { 'Cache-Control': policy } })), 0);
	}
	assert.equal(publicLifetime(new Response('bytes', { headers: { 'Cache-Control': 'public, max-age=300', Age: '20' } })), 280000);
});
test('cached complete files satisfy byte ranges, suffix ranges and unsatisfiable ranges', async () => {
	const record = { bytes: new Blob(['0123456789']), headers: { 'Content-Type': 'audio/mpeg' } };
	const response = responseFromRecord(record, 'bytes=2-5');
	assert.equal(response.status, 206);
	assert.equal(await response.text(), '2345');
	assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
	assert.equal(await responseFromRecord(record, 'bytes=-3').text(), '789');
	assert.equal(responseFromRecord(record, 'bytes=100-').status, 416);
	assert.equal(responseFromRecord(record, 'bytes=0-1,5-6'), null);
});
test('incomplete, partial and oversized files never become complete cache entries', async () => {
	assert.equal(await boundedBlob(new Response('bytes', { status: 206 })), null);
	assert.equal(await boundedBlob(new Response('bytes', { headers: { 'Content-Length': '100' } })), null);
	assert.equal(await boundedBlob(new Response('bytes', { headers: { 'Content-Length': String(MAX_FILE_BYTES + 1) } })), null);
	assert.equal((await boundedBlob(new Response('hello'))).size, 5);
});
test('unavailable persistent storage degrades to bounded memory, expires and clears', async () => {
	await mediaStore.clear();
	await mediaStore.put({ key: 'image', bytes: new Blob(['abc']), headers: {}, usedAt: 1, expiresAt: Date.now() + 10000 });
	assert.equal((await mediaStore.get('image')).bytes.size, 3);
	await mediaStore.put({ key: 'expired', bytes: new Blob(['abc']), headers: {}, usedAt: 1, expiresAt: 1 });
	assert.equal(await mediaStore.get('expired'), null);
	await mediaStore.clear();
	assert.equal(await mediaStore.get('image'), null);
});

test('real worker reauthorizes cache hits, deduplicates bytes, respects ranges, revocation and disable', async () => {
	const listeners = {};
	const previousSelf = globalThis.self;
	const previousFetch = globalThis.fetch;
	let allowed = true,
		validations = 0,
		downloads = 0;
	globalThis.self = {
		location: { origin },
		addEventListener: (type, listener) => {
			listeners[type] = listener;
		}
	};
	globalThis.fetch = async (input) => {
		const url = new URL(typeof input === 'string' ? input : input.url || input, origin);
		if (url.pathname.includes('capabilities'))
			return Response.json({ schemaVersion: 1, origin, features: { 'api.attachment-content': { version: '1.1.0' } } });
		if (url.searchParams.get('cache') === 'validate') {
			validations++;
			return allowed ? Response.json({ ok: true, cacheKey: `${'b'.repeat(64)}:original`, size: 10 }) : new Response(null, { status: 404 });
		}
		downloads++;
		return allowed
			? new Response('0123456789', { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '10' } })
			: new Response(null, { status: 404 });
	};
	try {
		await mediaStore.clear();
		await import('../public/media-cache-sw.mjs');
		const request = async (range) => {
			let result;
			const work = [];
			listeners.fetch({
				request: new Request(`${origin}/api/v1/attachments/content?id=test`, { headers: range ? { Range: range } : {} }),
				respondWith: (promise) => {
					result = promise;
				},
				waitUntil: (promise) => work.push(promise)
			});
			const response = await result;
			await Promise.all(work);
			return response;
		};
		assert.equal(await (await request()).text(), '0123456789');
		assert.equal(await (await request()).text(), '0123456789');
		assert.equal(downloads, 1);
		assert.equal(validations, 2);
		assert.equal(await (await request('bytes=3-5')).text(), '345');
		assert.equal(downloads, 1);
		allowed = false;
		assert.equal((await request()).status, 404);
		assert.equal(downloads, 1);
		allowed = true;
		const work = [];
		listeners.message({
			source: { url: `${origin}/settings` },
			data: { type: 'tt-media-config', enabled: false },
			ports: [],
			waitUntil: (p) => work.push(p)
		});
		await Promise.all(work);
		assert.equal((await mediaStore.status()).entries, 0);
		await request();
		assert.equal(downloads, 2);
	} finally {
		globalThis.self = previousSelf;
		globalThis.fetch = previousFetch;
	}
});
