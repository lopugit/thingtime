import assert from 'node:assert/strict';
import test from 'node:test';

import { createGatewayAuthority, gatewayDescriptor, getGatewaySettings, getMongoConnectionMode, GATEWAY_OWNERSHIP_TTL_MS } from './environmentGateway';

const selected = { environment: 'preview', origin: 'https://preview.test', deploymentId: 'deployment-new', secret: 's'.repeat(32) };
const manifest = (deploymentId = selected.deploymentId) => ({ schemaVersion: 1, origin: selected.origin,
  gateway: { environment: selected.environment, origin: selected.origin, deploymentId },
  features: { 'api.environment-gateway': { version: '1.0.0' } }, operations: [] });

test('gateway is explicit, validates complete settings and exposes no secret', () => {
  assert.equal(getGatewaySettings({}), null);
  const env = { THINGTIME_GATEWAY_ENVIRONMENT: 'preview', THINGTIME_GATEWAY_ORIGIN: selected.origin,
    THINGTIME_GATEWAY_DEPLOYMENT_ID: selected.deploymentId, THINGTIME_GATEWAY_SECRET: selected.secret };
  assert.deepEqual(getGatewaySettings(env), selected);
  assert.equal('secret' in gatewayDescriptor(env)!, false);
  for (const patch of [{ THINGTIME_GATEWAY_ORIGIN: 'https://u:p@preview.test' }, { THINGTIME_GATEWAY_ORIGIN: 'http://preview.test' },
    { THINGTIME_GATEWAY_ORIGIN: selected.origin + '/path' }, { THINGTIME_GATEWAY_SECRET: 'short' }, { THINGTIME_GATEWAY_DEPLOYMENT_ID: '' },
    { THINGTIME_GATEWAY_ENVIRONMENT: '' }, { THINGTIME_DESKTOP: '1' }, { THINGTIME_AGENT_TEST_MODE: '1' }]) {
    assert.throws(() => getGatewaySettings({ ...env, ...patch }));
  }
});

test('alias ownership is single-flight, bounded, demotes and supports rollback', async () => {
  let time = 100, owner = selected.deploymentId, requests = 0, demotions = 0;
  const authority = createGatewayAuthority({ settings: () => selected, now: () => time, demoted: () => { demotions++; },
    fetch: async (_url, init) => { requests++; assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).has('cookie'), false); return Response.json(manifest(owner)); } });
  const checks = await Promise.all(Array.from({ length: 20 }, () => authority.current()));
  assert.ok(checks.every(check => check?.owner)); assert.equal(requests, 1);
  owner = 'deployment-promoted';
  time += GATEWAY_OWNERSHIP_TTL_MS + 1;
  await assert.rejects(authority.requireDatabase()); assert.equal(demotions, 1);
  owner = selected.deploymentId; time += GATEWAY_OWNERSHIP_TTL_MS + 1;
  await authority.requireDatabase(); assert.equal(requests, 3);
});

test('discovery outage never uses stale authorization and can recover', async () => {
  let time = 1, fail = false;
  const authority = createGatewayAuthority({ settings: () => selected, now: () => time,
    fetch: async () => { if (fail) throw new Error('private upstream details'); return Response.json(manifest()); } });
  await authority.requireDatabase();
  time += GATEWAY_OWNERSHIP_TTL_MS + 1; fail = true;
  await assert.rejects(authority.requireDatabase(), error => !String(error).includes('private upstream'));
  fail = false; await authority.requireDatabase();
});

test('different environments, origins, missing/breaking manifests fail closed', async () => {
  for (const body of [ { ...manifest(), origin: 'https://other.test' }, { ...manifest(), gateway: { ...manifest().gateway, environment: 'production' } },
    { ...manifest(), features: {} }, { ...manifest(), features: { 'api.environment-gateway': { version: '2.0.0' } } }, { ...manifest(), gateway: null } ]) {
    const authority = createGatewayAuthority({ settings: () => selected, fetch: async () => Response.json(body) });
    await assert.rejects(authority.requireDatabase());
  }
});

test('configuration cannot change while discovery authorizes an old endpoint', async () => {
  let settings = selected;
  const authority = createGatewayAuthority({ settings: () => settings, fetch: async () => {
    settings = { ...selected, environment: 'production' }; return Response.json(manifest());
  } });
  await assert.rejects(authority.current());
});


test('Vercel defaults to proxy and cannot silently fall through missing or malformed settings', () => {
  assert.equal(getMongoConnectionMode({}), 'proxy');
  for (const env of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' },
    { THINGTIME_MONGODB_CONNECTION_MODE: 'proxy' }, { THINGTIME_GATEWAY_ORIGIN: '' },
    { THINGTIME_GATEWAY_DEPLOYMENT_ID: 'partial' },
    { THINGTIME_MONGODB_CONNECTION_MODE: '' }, { THINGTIME_MONGODB_CONNECTION_MODE: 'direct' },
    { VERCEL: '1', THINGTIME_MONGODB_CONNECTION_MODE: 'dedicated' }]) assert.throws(() => getGatewaySettings(env));
  assert.equal(getGatewaySettings({ THINGTIME_DESKTOP: '1' }), null);
  const env = { VERCEL: '1', THINGTIME_GATEWAY_ENVIRONMENT: 'preview', THINGTIME_GATEWAY_ORIGIN: selected.origin,
    THINGTIME_GATEWAY_DEPLOYMENT_ID: selected.deploymentId, THINGTIME_GATEWAY_SECRET: selected.secret,
    THINGTIME_MONGODB_CONNECTION_MODE: 'dedicated' };
  assert.equal(getMongoConnectionMode(env), 'dedicated');
  assert.deepEqual(getGatewaySettings(env), selected);
  assert.equal(gatewayDescriptor(env), null);
  assert.throws(() => getGatewaySettings({ ...env, THINGTIME_GATEWAY_SECRET: '' }));
});
