import assert from 'node:assert/strict';
import test from 'node:test';
import { H3 } from 'nitro/h3';
import handler from './thingtime-capabilities';
import middleware from '../middleware/environment-gateway';
import { effectiveThingtimeCapabilityManifest, thingtimeCapabilityManifest } from '../../app/api/utils/capabilities/thingtimeCapabilities';
import { createGatewayAuthority, gatewayAuthority, getGatewaySettings, GATEWAY_OWNERSHIP_TTL_MS } from '../../app/api/utils/deployment/environmentGateway';
import { gatewaySupportsOperation, isGatewayDataPath } from '../../app/api/utils/deployment/gatewayOperations';
import { THINGTIME_CAPABILITY_MANIFEST_PATH } from '../../app/api/utils/capabilities/capabilityContract';

const owner = 'https://gateway.test';
const follower = 'https://follower.test';
const keys = ['THINGTIME_GATEWAY_ENVIRONMENT', 'THINGTIME_GATEWAY_ORIGIN', 'THINGTIME_GATEWAY_SECRET',
  'THINGTIME_GATEWAY_DEPLOYMENT_ID', 'THINGTIME_GATEWAY_SOURCE_ORIGINS', 'THINGTIME_MONGODB_CONNECTION_MODE',
  'VERCEL', 'VERCEL_ENV', 'THINGTIME_DESKTOP', 'THINGTIME_AGENT_TEST_MODE'] as const;
const fixture = async (run: () => Promise<void>) => {
  const before = keys.map(key => process.env[key]);
  keys.forEach(key => { delete process.env[key]; });
  Object.assign(process.env, { THINGTIME_GATEWAY_ENVIRONMENT: 'preview', THINGTIME_GATEWAY_ORIGIN: owner,
    THINGTIME_GATEWAY_SECRET: 'synthetic'.repeat(8), THINGTIME_GATEWAY_DEPLOYMENT_ID: 'follower', THINGTIME_GATEWAY_SOURCE_ORIGINS: follower, THINGTIME_MONGODB_CONNECTION_MODE: 'proxy' });
  try { await run(); } finally { keys.forEach((key, index) => {
    if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index];
  }); }
};
const ownerManifest = () => {
  const manifest = thingtimeCapabilityManifest(owner);
  manifest.gateway!.deploymentId = 'owner';
  return manifest;
};
const olderOwner = () => {
  const manifest = ownerManifest();
  manifest.features['api.environment-gateway'] = { version: '1.1.0' };
  for (const key of Object.keys(manifest.features).filter(key => key.startsWith('api.connections'))) {
    manifest.features[key] = { version: '1.0.0' };
  }
  delete manifest.features['api.connections-request'];
  manifest.operations = manifest.operations.filter(operation => operation.feature !== 'api.connections-request');
  return manifest;
};
const authority = (manifest: ReturnType<typeof ownerManifest>) => createGatewayAuthority({
  settings: getGatewaySettings, fetch: async () => Response.json(manifest)
});
const app = () => new H3().use(middleware).all(THINGTIME_CAPABILITY_MANIFEST_PATH, handler);

test('follower omits incompatible whole contracts without downgrading or inventing operations', async () => fixture(async () => {
  const remote = olderOwner();
  const effective = await effectiveThingtimeCapabilityManifest(follower, authority(remote).current);
  for (const feature of ['api.connections', 'api.connections-providers', 'api.connections-feed', 'api.connections-oauth-begin',
    'api.connections-oauth-callback', 'api.connections-request', 'api.connections-filters']) {
    assert.equal(effective.features[feature], undefined);
    assert.equal(effective.operations.some(operation => operation.feature === feature), false);
  }
  assert.equal(effective.origin, follower);
  assert.deepEqual(effective.gateway, thingtimeCapabilityManifest(follower).gateway);
  assert.equal(effective.features['api.passwords'].version, '1.3.0');
  assert.equal(effective.features['api.environment-gateway'].version, '1.2.0');
  for (const operation of effective.operations.filter(operation => isGatewayDataPath(operation.path))) {
    assert.ok(operation.methods.every(method => gatewaySupportsOperation(remote, operation.feature,
      effective.features[operation.feature].version, operation.path, method)));
  }
}));

test('missing path, missing method, missing feature and incompatible version each remove the full feature', async () => fixture(async () => {
  const mutations = [
    (m: ReturnType<typeof ownerManifest>) => { m.operations = m.operations.filter(op => op.path !== '/api/v1/passwords-docs'); },
    (m: ReturnType<typeof ownerManifest>) => { m.operations = m.operations.map(op => op.path === '/api/v1/passwords' ? { ...op, methods: ['GET'] } : op); },
    (m: ReturnType<typeof ownerManifest>) => { delete m.features['api.passwords']; },
    (m: ReturnType<typeof ownerManifest>) => { m.features['api.passwords'] = { version: '2.0.0' }; },
    (m: ReturnType<typeof ownerManifest>) => { m.features['api.passwords'] = { version: 'broken' }; }
  ];
  for (const mutate of mutations) {
    const remote = ownerManifest(); mutate(remote);
    const effective = await effectiveThingtimeCapabilityManifest(follower, authority(remote).current);
    assert.equal(effective.features['api.passwords'], undefined);
    assert.equal(effective.operations.some(op => op.feature === 'api.passwords'), false);
  }
}));

test('compatible owner supports the local promise without copying extra remote contracts or configuration', async () => fixture(async () => {
  const remote = ownerManifest(); remote.features['api.passwords'] = { version: '1.4.0' };
  remote.features['api.remote-only'] = { version: '1.0.0' };
  Object.assign(remote, { secret: 'must-not-publish', internalPath: '/private/fixture', deploymentConfig: 'must-not-publish' });
  const effective = await effectiveThingtimeCapabilityManifest(follower, authority(remote).current);
  assert.equal(effective.features['api.passwords'].version, '1.3.0');
  assert.equal(effective.features['api.remote-only'], undefined);
  assert.deepEqual(effective, thingtimeCapabilityManifest(follower));
  assert.doesNotMatch(JSON.stringify(effective), /must-not-publish|private\/fixture|synthetic/);
}));

test('standalone, dedicated, canonical alias and verified immutable owner retain their local registry', async () => fixture(async () => {
  const never = async () => { throw new Error('must not resolve canonical/standalone/dedicated discovery'); };
  assert.deepEqual(await effectiveThingtimeCapabilityManifest(owner, never), thingtimeCapabilityManifest(owner));
  process.env.THINGTIME_MONGODB_CONNECTION_MODE = 'dedicated';
  assert.deepEqual(await effectiveThingtimeCapabilityManifest(follower, never), thingtimeCapabilityManifest(follower));
  process.env.THINGTIME_MONGODB_CONNECTION_MODE = 'proxy';
  process.env.THINGTIME_GATEWAY_DEPLOYMENT_ID = 'owner';
  assert.deepEqual(await effectiveThingtimeCapabilityManifest('https://immutable-owner.test', authority(ownerManifest()).current),
    thingtimeCapabilityManifest('https://immutable-owner.test'));
  keys.forEach(key => { delete process.env[key]; });
  assert.deepEqual(await effectiveThingtimeCapabilityManifest(follower, never), thingtimeCapabilityManifest(follower));
}));

test('unavailable, malformed, wrong-origin and wrong-environment gateway discovery cannot advertise local contracts', async () => fixture(async () => {
  const invalid = [null, { ...ownerManifest(), origin: 'https://wrong.test' },
    { ...ownerManifest(), gateway: { ...ownerManifest().gateway!, origin: 'https://wrong.test' } },
    { ...ownerManifest(), gateway: { ...ownerManifest().gateway!, environment: 'production' } }];
  for (const value of invalid) {
    const resolver = createGatewayAuthority({ settings: getGatewaySettings, fetch: async (_url, init) => {
      assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
      return Response.json(value);
    } });
    await assert.rejects(effectiveThingtimeCapabilityManifest(follower, resolver.current));
  }
  const unavailable = createGatewayAuthority({ settings: getGatewaySettings, fetch: async () => { throw new Error('private failure'); } });
  await assert.rejects(effectiveThingtimeCapabilityManifest(follower, unavailable.current));
  await assert.rejects(effectiveThingtimeCapabilityManifest(follower, async () => null));
}));

test('new discovery follows owner replacement after the bounded ownership cache, without stale-on-error', async () => fixture(async () => {
  let now = 0; let manifest = ownerManifest(); let failed = false;
  const resolver = createGatewayAuthority({ settings: getGatewaySettings, now: () => now, fetch: async () => {
    if (failed) throw new Error('private failure'); return Response.json(manifest);
  } });
  assert.equal((await effectiveThingtimeCapabilityManifest(follower, resolver.current)).features['api.connections'].version, '2.0.0');
  manifest = olderOwner(); manifest.gateway!.deploymentId = 'replacement'; now += GATEWAY_OWNERSHIP_TTL_MS + 1;
  assert.equal((await effectiveThingtimeCapabilityManifest(follower, resolver.current)).features['api.connections'], undefined);
  failed = true; now += GATEWAY_OWNERSHIP_TTL_MS + 1;
  await assert.rejects(effectiveThingtimeCapabilityManifest(follower, resolver.current));
}));

test('a configuration selection change during discovery cannot publish the old authority', async () => fixture(async () => {
  const resolver = createGatewayAuthority({ settings: getGatewaySettings, fetch: async () => {
    const manifest = ownerManifest(); process.env.THINGTIME_GATEWAY_DEPLOYMENT_ID = 'changed'; return Response.json(manifest);
  } });
  await assert.rejects(effectiveThingtimeCapabilityManifest(follower, resolver.current));
}));

test('real discovery handler and request gate agree for an older owner; no forwarding or credentials', async t => fixture(async () => {
  const resolver = authority(olderOwner());
  t.mock.method(gatewayAuthority, 'current', resolver.current);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not forward'); });
  const server = app();
  const response = await server.fetch(new Request(follower + THINGTIME_CAPABILITY_MANIFEST_PATH));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const manifest = await response.json(); assert.equal(manifest.origin, follower);
  assert.equal(manifest.features['api.connections'], undefined);
  assert.equal((await server.fetch(new Request(follower + '/api/v1/connections-docs'))).status, 409);
  assert.equal(fetch.mock.callCount(), 0);
}));

test('handler returns fixed no-store 503 for GET/HEAD failures without private error or configuration', async t => fixture(async () => {
  t.mock.method(gatewayAuthority, 'current', async () => { throw new Error('private /fixture synthetic-secret'); });
  const server = app();
  const response = await server.fetch(new Request(follower + THINGTIME_CAPABILITY_MANIFEST_PATH));
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json(); assert.equal(body.code, 'ENVIRONMENT_GATEWAY_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(body), /fixture|synthetic-secret|deploymentId|secret/);
  const head = await server.fetch(new Request(follower + THINGTIME_CAPABILITY_MANIFEST_PATH, { method: 'HEAD' }));
  assert.equal(head.status, 503); assert.equal(await head.text(), '');
  assert.equal((await server.fetch(new Request(follower + THINGTIME_CAPABILITY_MANIFEST_PATH, { method: 'POST' }))).status, 405);
  assert.equal((await server.fetch(new Request(owner + THINGTIME_CAPABILITY_MANIFEST_PATH))).status, 200);
}));
