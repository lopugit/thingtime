import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs, cloudflareFeatureVersion } from '../../../remix/app/docs/apiDocs';
import { cloudflareRoutes } from '../src/routes.generated';
import { cloudflareManifest, FALLBACK_HEADER, runtimeReadyFor, serveApiRequest, shardIndex } from '../src/serve';

test('the generated route list matches every API doc marked for Cloudflare', () => {
	const marked = apiEndpointDocs.filter((doc) => doc.cloudflare);
	assert.ok(marked.length > 0);
	assert.deepEqual(Object.keys(cloudflareRoutes).sort(), marked.map((doc) => doc.endpoint.replace(/^\/api\//, '')).sort(), 'run `npm run generate` in cloudflare/api');
	for (const doc of marked) {
		const route = cloudflareRoutes[doc.endpoint.replace(/^\/api\//, '')];
		assert.equal(route.feature, `api.${doc.id}`);
		assert.equal(route.version, cloudflareFeatureVersion(doc));
		assert.deepEqual([...route.methods], doc.cloudflare!.methods);
		assert.ok(doc.notes?.some((note) => note.startsWith('Cloudflare deployment:')), `${doc.id} docs carry the Cloudflare note`);
	}
});

test('the Cloudflare manifest lists only what this runtime serves', () => {
	const manifest = cloudflareManifest('1.0.0');
	assert.equal(manifest.runtime, 'cloudflare');
	assert.deepEqual(manifest.features['api.automation-switches'], { version: '1.0.0' });
	assert.deepEqual(manifest.operations.find((operation) => operation.path === '/api/v1/automation/switches')?.methods, ['GET']);
	assert.equal(manifest.operations.length, Object.keys(cloudflareRoutes).length);
});

test('unlisted endpoints and methods are refused with a Vercel fallback hint, without touching MongoDB', async () => {
	const unlisted = await serveApiRequest(new Request('https://thingtime.com/api/v1/teapot'));
	assert.equal(unlisted.status, 421);
	assert.equal(unlisted.headers.get(FALLBACK_HEADER), 'vercel');
	const wrongMethod = await serveApiRequest(new Request('https://thingtime.com/api/v1/automation/switches', { method: 'POST', body: '{}' }));
	assert.equal(wrongMethod.status, 421);
	const outside = await serveApiRequest(new Request('https://thingtime.com/things'));
	assert.equal(outside.status, 421);
});

test('production mode is always required and session routes wait for the JWT keys', () => {
	const route = (sessionFree: boolean) => ({ feature: 'api.x', version: '1.0.0', methods: ['GET'], sessionFree, load: async () => ({}) });
	const base = { NODE_ENV: 'production', MONGODB_CONNECTION_STRING: 'mongodb://example' };
	assert.equal(runtimeReadyFor(route(true), base), true);
	assert.equal(runtimeReadyFor(route(false), base), false, 'no JWT keys: hand back to Vercel');
	assert.equal(runtimeReadyFor(route(false), { ...base, JWT_PUBLIC_KEY: 'public-key' }), true);
	assert.equal(runtimeReadyFor(route(true), { MONGODB_CONNECTION_STRING: 'mongodb://example' }), false, 'never outside production mode');
	assert.equal(runtimeReadyFor(route(false), { ...base, NODE_ENV: 'development', JWT_SECRET: 'secret' }), false);
	assert.equal(runtimeReadyFor(route(true), { NODE_ENV: 'production' }), false, 'no database');
});

test('shard selection stays inside the configured pool', () => {
	assert.equal(shardIndex(1, () => 0.99), 0);
	assert.equal(shardIndex(4, () => 0), 0);
	assert.equal(shardIndex(4, () => 0.999), 3);
});
