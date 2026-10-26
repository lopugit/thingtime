import assert from 'node:assert/strict';
import test from 'node:test';
import { H3 } from 'nitro/h3';

import middleware from '../middleware/environment-gateway';
import { thingtimeCapabilityManifest } from '../../app/api/utils/capabilities/thingtimeCapabilities';
import { createGatewayAuthority, getGatewaySettings, requireGatewayDatabaseAccess } from '../../app/api/utils/deployment/environmentGateway';
import { GATEWAY_RELAY_HEADER, environmentGatewayIngress, proxyEnvironmentRequest, restoreGatewayRequest } from './environmentGateway';

const origin = 'https://gateway.test';
const follower = 'https://follower.test';
const keys = ['THINGTIME_GATEWAY_ENVIRONMENT', 'THINGTIME_GATEWAY_ORIGIN', 'THINGTIME_GATEWAY_SECRET', 'THINGTIME_GATEWAY_DEPLOYMENT_ID', 'THINGTIME_GATEWAY_SOURCE_ORIGINS', 'THINGTIME_MONGODB_CONNECTION_MODE'] as const;
const fixture = async (run: () => Promise<void>) => {
  const before = keys.map(key => process.env[key]);
  process.env.THINGTIME_GATEWAY_ENVIRONMENT = 'preview'; process.env.THINGTIME_GATEWAY_ORIGIN = origin;
  process.env.THINGTIME_GATEWAY_SECRET = 'synthetic'.repeat(8); process.env.THINGTIME_GATEWAY_DEPLOYMENT_ID = 'follower';
  process.env.THINGTIME_GATEWAY_SOURCE_ORIGINS = follower;
  process.env.THINGTIME_MONGODB_CONNECTION_MODE = 'proxy';
  try { await run(); } finally { keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }); }
};
const aliasManifest = () => { const manifest = thingtimeCapabilityManifest(origin); manifest.gateway!.deploymentId = 'owner'; return manifest; };

test('signed relay preserves authentication, original URL, cookies, transport hooks and manual redirects', async t => fixture(async () => {
  const settings = getGatewaySettings()!;
  const authority = await createGatewayAuthority({ settings: () => settings, fetch: async () => Response.json(aliasManifest()) }).current();
  const body = 'synthetic-stream-body';
  let sent = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent++; assert.equal(String(url), origin + '/api/v1/login?next=%2F'); assert.equal(init?.redirect, 'manual');
    const incoming = new Request(url, init);
    let attached = false;
    const runtime = { sentinel: 'runtime' };
    Object.assign(incoming, { runtime, context: { sentinel: 'context' }, waitUntil: () => { attached = true; } });
    const restored = restoreGatewayRequest(incoming, settings)!;
    assert.equal((restored as any).runtime, runtime);
    (restored as any).waitUntil(Promise.resolve()); assert.equal(attached, true);
    assert.equal((restored as any).context.sentinel, 'context');
    assert.equal(restored.url, follower + '/api/v1/login?next=%2F');
    assert.equal(restored.headers.get('origin'), follower);
    assert.equal(restored.headers.get('authorization'), 'Bearer synthetic'); assert.equal(restored.headers.get('cookie'), 'tt_auth=synthetic');
    assert.equal(restored.headers.get('x-forwarded-host'), 'follower.test'); assert.equal(await restored.text(), body);
    assert.equal(restoreGatewayRequest(incoming, { ...settings, environment: 'production' }), null);
    assert.equal(restoreGatewayRequest(incoming, settings, Date.now() + 30_000), null);
    const changed = new Headers(incoming.headers); changed.set('cookie', 'tt_auth=changed');
    assert.equal(restoreGatewayRequest(new Request(incoming.url, { headers: changed, method: 'GET' }), settings), null);
    const headers = new Headers({ location: follower + '/oauth/callback', 'content-encoding': 'gzip' });
    headers.append('set-cookie', 'tt_auth=new; HttpOnly; Secure; SameSite=Lax'); headers.append('set-cookie', 'tt_accounts=roster; HttpOnly; Secure');
    return new Response(null, { status: 302, headers });
  });
  const request = new Request(follower + '/api/v1/login?next=%2F', { method: 'POST', body,
    headers: { authorization: 'Bearer synthetic', cookie: 'tt_auth=synthetic', origin: follower, 'x-forwarded-host': 'evil.test' } });
  const response = await proxyEnvironmentRequest(request, authority!);
  assert.equal(response.status, 302); assert.equal(response.headers.get('location'), follower + '/oauth/callback');
  assert.equal(response.headers.getSetCookie().length, 2); assert.equal(response.headers.has('content-encoding'), false); assert.equal(sent, 1);
}));

test('operation registry mismatch and cross-site cookie writes fail before body or credential forwarding', async t => fixture(async () => {
  const settings = getGatewaySettings()!;
  const manifest = aliasManifest(); manifest.operations = manifest.operations.filter(operation => operation.path !== '/api/v1/things');
  const authority = await createGatewayAuthority({ settings: () => settings, fetch: async () => Response.json(manifest) }).current();
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not forward'); });
  const request = new Request(follower + '/api/v1/things', { method: 'POST', body: 'synthetic', headers: { cookie: 'tt_auth=synthetic', origin: 'https://cross-site.test' } });
  assert.equal((await proxyEnvironmentRequest(request, authority!)).status, 403); assert.equal(request.bodyUsed, false);
  const safe = new Request(follower + '/api/v1/things'); assert.equal((await proxyEnvironmentRequest(safe, authority!)).status, 409);
  assert.equal(mock.mock.callCount(), 0);
}));

test('stream cancellation propagates without buffering and no Mongo dial is possible on a follower', async t => fixture(async () => {
  const settings = getGatewaySettings()!;
  const authority = await createGatewayAuthority({ settings: () => settings, fetch: async () => Response.json(aliasManifest()) }).current();
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('.well-known') ? Response.json(aliasManifest()) :
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('first')); }, cancel() { cancelled = true; } })));
  const response = await proxyEnvironmentRequest(new Request(follower + '/api/v1/things'), authority!);
  const reader = response.body!.getReader(); assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  await reader.cancel(); assert.equal(cancelled, true);
  const { getMongoDb } = await import('../../app/api/utils/mongodb/mongodb');
  const { MongoClient } = await getMongoDb();
  const client = new MongoClient('mongodb://127.0.0.1:1/test', { serverSelectionTimeoutMS: 50 });
  await assert.rejects(client.connect(), /environment API gateway/);
  await client.close();
}));

test('gateway rejects incompatible semantic API contracts before forwarding credentials/body', async t => fixture(async () => {
  const manifest = aliasManifest(); delete manifest.features['api.things'];
  const settings = getGatewaySettings()!;
  const authority = await createGatewayAuthority({ settings: () => settings, fetch: async () => Response.json(manifest) }).current();
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not forward'); });
  const response = await proxyEnvironmentRequest(new Request(follower + '/api/v1/things', { method: 'POST', body: 'synthetic' }), authority!);
  assert.equal(response.status, 409); assert.equal(mock.mock.callCount(), 0);
}));

test('follower refuses database access and forged/repeated hops', async t => fixture(async () => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(aliasManifest()));
  await assert.rejects(requireGatewayDatabaseAccess());
  const forged = await environmentGatewayIngress(new Request(follower + '/api/v1/things', { headers: { [GATEWAY_RELAY_HEADER]: 'forged' } }));
  assert.ok(forged instanceof Response); assert.equal(forged.status, 508);
}));

test('real H3 middleware restores owner request before same-origin checks and streaming', async t => fixture(async () => {
  const settings = getGatewaySettings()!;
  const authority = await createGatewayAuthority({ settings: () => settings, fetch: async () => Response.json(aliasManifest()) }).current();
  const app = new H3().use(middleware).all('/api/**', event => {
    assert.equal(event.req.url, follower + '/api/v1/things');
    assert.equal(event.req.headers.get('origin'), follower);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('first\n')); controller.close(); } }));
  });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('.well-known')) return Response.json(aliasManifest());
    process.env.THINGTIME_GATEWAY_DEPLOYMENT_ID = 'owner';
    return app.fetch(new Request(url, init));
  });
  const result = await proxyEnvironmentRequest(new Request(follower + '/api/v1/things', { headers: { origin: follower } }), authority!);
  assert.equal(result.status, 200); assert.equal(await result.text(), 'first\n');
}));


test('explicit dedicated build executes its own handler, allows its Mongo client, and refuses relays', async t => fixture(async () => {
  const manifest = aliasManifest();
  process.env.THINGTIME_MONGODB_CONNECTION_MODE = 'dedicated';
  const mock = t.mock.method(globalThis, 'fetch', async url => {
    assert.match(String(url), /well-known/); return Response.json(manifest);
  });
  assert.equal(thingtimeCapabilityManifest(follower).gateway, null);
  assert.equal(await environmentGatewayIngress(new Request(follower + '/api/v1/things')), null);
  await requireGatewayDatabaseAccess();
  const app = new H3().use(middleware).all('/api/**', () => Response.json({ handler: 'dedicated-branch' }));
  const response = await app.fetch(new Request(follower + '/api/v1/things'));
  assert.deepEqual(await response.json(), { handler: 'dedicated-branch' });
  const forged = await environmentGatewayIngress(new Request(follower + '/api/v1/things', { headers: { [GATEWAY_RELAY_HEADER]: 'forged' } }));
  assert.equal((forged as Response).status, 403);
  assert.ok(mock.mock.callCount() > 0);
}));

test('a request cannot opt a proxy deployment into dedicated connections', async t => fixture(async () => {
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('.well-known') ? Response.json(aliasManifest()) : Response.json({ handler: 'gateway' }));
  const response = await environmentGatewayIngress(new Request(follower + '/api/v1/things', {
    headers: { 'x-thingtime-mongodb-connection-mode': 'dedicated' }
  }));
  assert.ok(response instanceof Response); assert.deepEqual(await response.json(), { handler: 'gateway' });
  await assert.rejects(requireGatewayDatabaseAccess());
}));
