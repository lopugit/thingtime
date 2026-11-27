import assert from 'node:assert/strict';
import test from 'node:test';

import { apiEndpointDocs } from '../../../remix/app/docs/apiDocs';
import { cloudflareRoutes } from '../src/routes.generated';
import { cloudflareManifest, FALLBACK_HEADER, serveApiRequest, shardIndex } from '../src/serve';

test('the generated route list matches every API doc marked for Cloudflare', () => {
	const marked = apiEndpointDocs.filter((doc) => doc.cloudflare);
	assert.ok(marked.length > 0);
	assert.deepEqual(Object.keys(cloudflareRoutes).sort(), marked.map((doc) => doc.endpoint.replace(/^\/api\//, '')).sort(), 'run `npm run generate` in cloudflare/api');
	for (const doc of marked) {
		const route = cloudflareRoutes[doc.endpoint.replace(/^\/api\//, '')];
		assert.equal(route.feature, `api.${doc.id}`);
		assert.equal(route.version, doc.cloudflare!.featureVersion);
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

test('shard selection stays inside the configured pool', () => {
	assert.equal(shardIndex(1, () => 0.99), 0);
	assert.equal(shardIndex(4, () => 0), 0);
	assert.equal(shardIndex(4, () => 0.999), 3);
});
