import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { handleOfflineShell, offlineShellRequest, prepareOfflineShell, validateOfflineManifest, OFFLINE_SHELL_MAX_BYTES } from '../public/offline-shell.mjs';
const origin = 'https://thingtime.test';
const fixture = () => {
	const files = new Map([['/offline-shell.html', '<div id="root"></div>'], ['/assets/app-abcd.js', 'export const app = true;']]);
	const assets = [...files].map(([path, value]) => ({ path, bytes: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') }));
	return { files, manifest: { version: 1, hash: 'f'.repeat(64), assets } };
};
const memoryCaches = () => {
	const caches = new Map();
	return { caches, storage: {
		open: async name => {
			if (!caches.has(name)) caches.set(name, new Map()); const values = caches.get(name);
			return { match: async key => values.get(key)?.clone(), put: async (key, response) => { values.set(key, response.clone()); } };
		}, keys: async () => [...caches.keys()], delete: async name => caches.delete(name)
	} };
};
test('offline policy excludes APIs, external origins, mutations and isolated runtime surfaces', () => {
	const { manifest } = fixture(); assert.equal(validateOfflineManifest(manifest), true);
	const navigation = path => ({ url: origin + path, mode: 'navigate', method: 'GET', headers: new Headers() });
	assert.equal(offlineShellRequest(navigation('/builder?page=local-id'), origin, manifest), true);
	for (const path of ['/api/root-data', '/api/v1/things', '/.well-known/thingtime-capabilities.json', '/draft-preview/index.html', '/platform/runtime.html', '/library/sandbox.html']) assert.equal(offlineShellRequest(navigation(path), origin, manifest), false);
	assert.equal(offlineShellRequest(new Request(origin + '/assets/app-abcd.js'), origin, manifest), true);
	assert.equal(offlineShellRequest(new Request('https://elsewhere.test/assets/app-abcd.js'), origin, manifest), false);
	assert.equal(offlineShellRequest(new Request(origin + '/assets/app-abcd.js', { method: 'POST' }), origin, manifest), false);
	assert.equal(offlineShellRequest(new Request(origin + '/assets/app-abcd.js?token=secret'), origin, manifest), false);
	for (const path of ['/api/root-data', '/private.js', '/assets/../private.js', '//other.test/file.js']) assert.equal(validateOfflineManifest({ ...manifest, assets: [...manifest.assets, { ...manifest.assets[1], path }] }), false);
	assert.equal(validateOfflineManifest({ ...manifest, assets: manifest.assets.map(asset => ({ ...asset, bytes: OFFLINE_SHELL_MAX_BYTES })) }), false);
});
test('offline installation verifies every byte and strips account response metadata', async () => {
	const { manifest, files } = fixture(); const { caches, storage } = memoryCaches(); let calls = 0;
	await prepareOfflineShell(manifest, storage, async (path, options) => {
		calls++; assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
		return new Response(files.get(path), { headers: { 'Content-Type': path.endsWith('html') ? 'text/html' : 'text/javascript', 'Set-Cookie': 'never-cache', 'Location': 'never-cache', 'Content-Security-Policy': "script-src 'self'" } });
	});
	assert.equal(calls, files.size); const values = [...caches.values()][0];
	assert.ok(values.has('/__thingtime_offline_shell_complete__'));
	const response = values.get('/offline-shell.html');
	assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('location'), null);
	assert.equal(response.headers.get('content-security-policy'), "script-src 'self'");
	await prepareOfflineShell(manifest, storage, async () => { throw new Error('Complete shell must be reusable'); });
});
test('a complete shell serves build assets and the offline document, and damaged storage still reaches the network', async () => {
	const { manifest, files } = fixture(); const { storage } = memoryCaches();
	await prepareOfflineShell(manifest, storage, async path => new Response(files.get(path), { headers: { 'Content-Type': 'text/javascript' } }));
	const asset = { url: origin + '/assets/app-abcd.js', mode: 'no-cors', method: 'GET', headers: new Headers() };
	const navigation = { url: origin + '/things', mode: 'navigate', method: 'GET', headers: new Headers() };
	const offline = () => { throw new TypeError('Failed to fetch'); };
	// A cached immutable asset is served without touching the network.
	assert.equal(await (await handleOfflineShell(asset, manifest, storage, offline)).text(), files.get('/assets/app-abcd.js'));
	// Navigation stays network-first and only falls back to the verified shell.
	assert.equal(await (await handleOfflineShell(navigation, manifest, storage, async () => new Response('live'))).text(), 'live');
	assert.equal(await (await handleOfflineShell(navigation, manifest, storage, offline)).text(), files.get('/offline-shell.html'));
	// This worker intercepts every build asset, so unreachable CacheStorage must
	// degrade to the network rather than fail the request outright.
	const broken = { open: async () => { throw new DOMException('Unexpected internal error', 'UnknownError'); }, keys: async () => { throw new DOMException('Unexpected internal error', 'UnknownError'); } };
	assert.equal(await (await handleOfflineShell(asset, manifest, broken, async () => new Response('from network'))).text(), 'from network');
	// A failed navigation still reports the network error, not the cache error.
	await assert.rejects(handleOfflineShell(navigation, manifest, broken, offline), /Failed to fetch/);
	// An incomplete install is never served, even when its assets are present.
	const { storage: partial } = memoryCaches();
	await (await partial.open('thingtime:offline-shell:v1:' + manifest.hash)).put('/assets/app-abcd.js', new Response('unverified'));
	assert.equal(await (await handleOfflineShell(asset, manifest, partial, async () => new Response('from network'))).text(), 'from network');
});
test('mixed deployments, oversized responses and missing assets never produce a ready shell', async () => {
	for (const broken of ['different', 'x'.repeat(200), null]) {
		const { manifest, files } = fixture(); const { caches, storage } = memoryCaches();
		await assert.rejects(prepareOfflineShell(manifest, storage, async path => new Response(path.endsWith('.js') ? broken : files.get(path), { status: broken === null ? 404 : 200 })));
		assert.equal(caches.size, 0);
	}
});
