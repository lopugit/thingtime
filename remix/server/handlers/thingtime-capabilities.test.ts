import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_MANIFEST_EDGE_CACHE, capabilityManifestResponse } from './thingtime-capabilities';

const origin = 'https://manifest.test';
const path = '/.well-known/thingtime-capabilities.json';
const fixture = async (run: () => Promise<void>) => {
  const values = { THINGTIME_GATEWAY_ENVIRONMENT: 'preview', THINGTIME_GATEWAY_ORIGIN: origin,
    THINGTIME_GATEWAY_SECRET: 'synthetic'.repeat(8), THINGTIME_GATEWAY_DEPLOYMENT_ID: 'owner-first',
    THINGTIME_MONGODB_CONNECTION_MODE: 'proxy' };
  const previous = Object.keys(values).map(key => process.env[key]);
  Object.assign(process.env, values);
  try { await run(); } finally {
    Object.keys(values).forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
    });
  }
};

test('manifest validators revalidate exact-origin complete metadata without browser or proxy freshness', async () => fixture(async () => {
  const first = capabilityManifestResponse(new Request(origin + path));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
  const etag = first.headers.get('ETag')!;
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  const manifest = await first.json();
  assert.equal(manifest.origin, origin);
  assert.equal(manifest.gateway.deploymentId, 'owner-first');
  assert.equal(JSON.stringify(manifest).includes(process.env.THINGTIME_GATEWAY_SECRET!), false);
  // Where the edge may not store the manifest (here a HEAD), a matching
  // validator still gets 304.
  const unchanged = capabilityManifestResponse(new Request(origin + path, { method: 'HEAD', headers: { 'If-None-Match': `"other", W/${etag}` } }));
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  assert.equal(unchanged.headers.get('ETag'), etag);
  assert.equal(unchanged.headers.get('Cache-Control'), 'private, no-store');
  const foreign = capabilityManifestResponse(new Request('https://other.test' + path, { headers: { 'If-None-Match': etag } }));
  assert.equal(foreign.status, 200);
  assert.notEqual(foreign.headers.get('ETag'), etag);
  process.env.THINGTIME_GATEWAY_DEPLOYMENT_ID = 'owner-promoted';
  const promoted = capabilityManifestResponse(new Request(origin + path, { headers: { 'If-None-Match': etag } }));
  assert.equal(promoted.status, 200);
  assert.notEqual(promoted.headers.get('ETag'), etag);
  assert.equal((await promoted.json()).gateway.deploymentId, 'owner-promoted');
}));

test('only an exact-host GET may be kept by Vercel\'s per-deployment edge cache', async () => fixture(async () => {
  const stored = capabilityManifestResponse(new Request(origin + path));
  assert.equal(stored.headers.get('Vercel-CDN-Cache-Control'), CAPABILITY_MANIFEST_EDGE_CACHE);
  // Browsers and proxies in front of Vercel never get freshness.
  assert.equal(stored.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(stored.headers.has('CDN-Cache-Control'), false);
  const etag = stored.headers.get('ETag')!;
  // The gateway's ownership check is conditional; a storable request still
  // gets the full body so the edge can keep it.
  const conditional = capabilityManifestResponse(new Request(origin + path, { headers: { 'If-None-Match': etag } }));
  assert.equal(conditional.status, 200);
  assert.equal(conditional.headers.get('Vercel-CDN-Cache-Control'), CAPABILITY_MANIFEST_EDGE_CACHE);
  assert.equal((await conditional.json()).gateway.deploymentId, 'owner-first');
  // A forwarded host or scheme that differs from the routed request would put
  // another origin's manifest under this host's cache key: never stored.
  for (const headers of [{ 'x-forwarded-host': 'evil.test' }, { 'x-forwarded-proto': 'http' }]) {
    const forged = capabilityManifestResponse(new Request(origin + path, { headers }));
    assert.equal(forged.status, 200);
    assert.equal(forged.headers.has('Vercel-CDN-Cache-Control'), false);
    assert.notEqual((await forged.json()).origin, origin);
  }
  // Plain HTTP (local development) and non-GET methods are never stored.
  assert.equal(capabilityManifestResponse(new Request('http://manifest.test' + path)).headers.has('Vercel-CDN-Cache-Control'), false);
  assert.equal(capabilityManifestResponse(new Request(origin + path, { method: 'HEAD' })).headers.has('Vercel-CDN-Cache-Control'), false);
  assert.equal(capabilityManifestResponse(new Request(origin + path, { method: 'OPTIONS' })).headers.has('Vercel-CDN-Cache-Control'), false);
}));

test('conditional public discovery supports HEAD and bounded CORS preflight without cookies', async () => fixture(async () => {
  const get = capabilityManifestResponse(new Request(origin + path));
  const head = capabilityManifestResponse(new Request(origin + path, { method: 'HEAD' }));
  assert.equal(head.headers.get('ETag'), get.headers.get('ETag'));
  assert.equal(await head.text(), '');
  const options = capabilityManifestResponse(new Request(origin + path, { method: 'OPTIONS', headers: {
    origin: 'https://native-ui.test', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'If-None-Match'
  } }));
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(options.headers.get('Access-Control-Allow-Headers'), 'If-None-Match');
  assert.equal(options.headers.get('Access-Control-Max-Age'), '600');
  assert.equal(options.headers.get('Access-Control-Expose-Headers'), 'ETag');
  assert.equal(options.headers.has('Access-Control-Allow-Credentials'), false);
  const denied = capabilityManifestResponse(new Request(origin + path, { method: 'POST' }));
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('Allow'), 'GET, HEAD, OPTIONS');
}));
