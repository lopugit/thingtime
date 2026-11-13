import assert from 'node:assert/strict';
import test from 'node:test';

import { gatewayProtectionHeaders, createGatewayAuthority, gatewayDescriptor, getGatewaySettings, getMongoConnectionMode, GATEWAY_OWNERSHIP_TTL_MS } from './environmentGateway';
import { mongoConnectionPolicy } from './mongoConnectionPolicy';

const selected = { environment: 'preview', origin: 'https://preview.test', deploymentId: 'deployment-new', secret: 's'.repeat(32) };
const manifest = (deploymentId = selected.deploymentId) => ({ schemaVersion: 1, origin: selected.origin,
  gateway: { environment: selected.environment, origin: selected.origin, deploymentId },
  features: { 'api.environment-gateway': { version: '1.0.0' } }, operations: [] });
const withConnectionMode = async (mode: 'proxy' | 'dedicated', run: () => Promise<void>) => {
  const previous = process.env.THINGTIME_MONGODB_CONNECTION_MODE;
  process.env.THINGTIME_MONGODB_CONNECTION_MODE = mode;
  try { await run(); } finally {
    if (previous === undefined) delete process.env.THINGTIME_MONGODB_CONNECTION_MODE;
    else process.env.THINGTIME_MONGODB_CONNECTION_MODE = previous;
  }
};

test('gateway is explicit, validates complete settings and exposes no secret', () => {
  assert.equal(getGatewaySettings({}), null);
  const env = { THINGTIME_GATEWAY_ENVIRONMENT: 'preview', THINGTIME_GATEWAY_ORIGIN: selected.origin,
    THINGTIME_GATEWAY_DEPLOYMENT_ID: selected.deploymentId, THINGTIME_GATEWAY_SECRET: selected.secret,
    THINGTIME_MONGODB_CONNECTION_MODE: 'proxy' };
  assert.deepEqual(getGatewaySettings(env), selected);
  assert.equal('secret' in gatewayDescriptor(env)!, false);
  for (const patch of [{ THINGTIME_GATEWAY_ORIGIN: 'https://u:p@preview.test' }, { THINGTIME_GATEWAY_ORIGIN: 'http://preview.test' },
    { THINGTIME_GATEWAY_ORIGIN: selected.origin + '/path' }, { THINGTIME_GATEWAY_SECRET: 'short' }, { THINGTIME_GATEWAY_DEPLOYMENT_ID: '' },
    { THINGTIME_GATEWAY_ENVIRONMENT: '' }, { THINGTIME_DESKTOP: '1' }, { THINGTIME_AGENT_TEST_MODE: '1' }]) {
    assert.throws(() => getGatewaySettings({ ...env, ...patch }));
  }
});

test('alias ownership is single-flight, bounded, demotes and supports rollback', async () => withConnectionMode('proxy', async () => {
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
}));

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


test('Vercel uses the bundled default and cannot silently fall through missing or malformed settings', () => {
  assert.equal(getMongoConnectionMode({}), mongoConnectionPolicy);
  assert.equal(getMongoConnectionMode({ THINGTIME_MONGODB_CONNECTION_MODE: 'proxy' }), 'proxy');
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

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('demotion drains only admitted lifetimes and rollback waits for pool close', async () => {
  const { createGatewayWorkLifecycle } = await import('./environmentGateway');
  const childStarted = deferred(), childDone = deferred(), closeStarted = deferred(), closeDone = deferred();
  const lifecycle = createGatewayWorkLifecycle(async () => {});
  let closes = 0;
  lifecycle.registerDrain(async () => { closes++; closeStarted.resolve(); await closeDone.promise; });
  const request = await lifecycle.admit();
  const child = request.run(() => lifecycle.withWork(async () => {
    childStarted.resolve(); await childDone.promise;
    assert.equal(lifecycle.isAdmitted(), true, 'detached job retains its own admission');
  }));
  await childStarted.promise;
  lifecycle.demote();
  request.end(); request.end();
  assert.equal(closes, 0, 'inflight detached save must finish before closing');
  let readmitted = false;
  const rollback = lifecycle.admit().then(lease => { readmitted = true; return lease; });
  childDone.resolve(); await child;
  await closeStarted.promise;
  assert.equal(readmitted, false, 'rollback cannot reopen while pool close is pending');
  closeDone.resolve();
  (await rollback).end();
  assert.equal(closes, 1);
});

test('demotion synchronously fences admission awaiting authority', async () => {
  const { createGatewayWorkLifecycle } = await import('./environmentGateway');
  const checking = deferred(), checked = deferred();
  const lifecycle = createGatewayWorkLifecycle(async () => { checking.resolve(); await checked.promise; });
  const incoming = lifecycle.admit();
  await checking.promise;
  lifecycle.demote();
  checked.resolve();
  await assert.rejects(incoming, /environment API gateway/);
});

test('expired asynchronous scopes cannot borrow an old owner admission', async () => {
  const { createGatewayWorkLifecycle } = await import('./environmentGateway');
  const continueWork = deferred();
  let owner = true;
  const lifecycle = createGatewayWorkLifecycle(async () => { if (!owner) throw new Error('not owner'); });
  const request = await lifecycle.admit();
  const late = request.run(async () => { await continueWork.promise; return lifecycle.withWork(async () => {}); });
  request.end(); owner = false; lifecycle.demote(); continueWork.resolve();
  await assert.rejects(late, /not owner/);
});

test('gateway discovery uses the server-only protection credential at the validated origin', async () => {
  const prior = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const secret = 'synthetic-platform-bypass';
  try {
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    assert.deepEqual(gatewayProtectionHeaders(selected), {});
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = secret;
    assert.throws(() => gatewayProtectionHeaders({ ...selected, origin: 'https://other.test/path' }));
    let calls = 0;
    const authority = createGatewayAuthority({ settings: () => selected, fetch: async (url, init) => {
      calls++;
      assert.equal(new URL(String(url)).origin, selected.origin);
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.credentials, 'omit');
      assert.equal(new Headers(init?.headers).get('x-vercel-protection-bypass'), secret);
      return Response.json(manifest());
    } });
    await authority.current();
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(manifest()).includes(secret), false);
  } finally {
    if (prior === undefined) delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    else process.env.VERCEL_AUTOMATION_BYPASS_SECRET = prior;
  }
});

test('ownership revalidates at the same five-second bound without retransmitting unchanged manifests', async () => {
  let time = 1, calls = 0;
  const authority = createGatewayAuthority({ settings: () => selected, now: () => time, fetch: async (_url, init) => {
    calls++;
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('If-None-Match'), calls === 1 ? null : '"owner-one"');
    return calls === 1 ? Response.json(manifest(), { headers: { ETag: '"owner-one"' } }) : new Response(null, { status: 304 });
  } });
  await authority.requireDatabase();
  time += GATEWAY_OWNERSHIP_TTL_MS;
  await Promise.all(Array.from({ length: 12 }, () => authority.requireDatabase()));
  assert.equal(calls, 2);
  time += GATEWAY_OWNERSHIP_TTL_MS;
  await authority.requireDatabase();
  assert.equal(calls, 3, 'A 304 starts only one new bounded ownership lease');
});

test('promotion and failed conditional discovery never retain stale ownership', async () => withConnectionMode('proxy', async () => {
  let time = 1, calls = 0, fail = false;
  const authority = createGatewayAuthority({ settings: () => selected, now: () => time, fetch: async () => {
    calls++;
    if (fail) throw new Error('Synthetic outage');
    return Response.json(manifest(calls === 1 ? selected.deploymentId : 'new-owner'), { headers: { ETag: `"owner-${calls}"` } });
  } });
  await authority.requireDatabase();
  time += GATEWAY_OWNERSHIP_TTL_MS;
  await assert.rejects(authority.requireDatabase());
  time += GATEWAY_OWNERSHIP_TTL_MS; fail = true;
  await assert.rejects(authority.current());
}));

test('304 without an exact verified prior selection and redirected discovery fail closed', async () => {
  for (const response of [new Response(null, { status: 304 }), Response.json(manifest())]) {
    if (response.status === 200) Object.defineProperty(response, 'url', { value: 'https://other.test/.well-known/thingtime-capabilities.json' });
    const authority = createGatewayAuthority({ settings: () => selected, fetch: async () => response });
    await assert.rejects(authority.current());
  }
});

test('late failure of a previous selection cannot invalidate a newer ownership lease', async () => {
  let active = selected, calls = 0, rejectOld!: (error: Error) => void;
  const newer = { ...selected, origin: 'https://newer.test', deploymentId: 'newer-owner' };
  const authority = createGatewayAuthority({ settings: () => active, fetch: async () => {
    calls++;
    if (calls === 1) return new Promise<Response>((_resolve, reject) => { rejectOld = reject; });
    return Response.json({ ...manifest(), origin: newer.origin, gateway: { ...newer, secret: undefined } });
  } });
  const old = assert.rejects(authority.current());
  active = newer;
  assert.equal((await authority.current())?.owner, true);
  rejectOld(new Error('Old selection unavailable'));
  await old;
  assert.equal((await authority.current())?.owner, true);
  assert.equal(calls, 2);
});

test('server-only Vercel protection bypass is limited to the configured discovery target', async () => {
  const previous = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'synthetic-platform-bypass';
  try {
    const authority = createGatewayAuthority({ settings: () => selected, fetch: async (url, init) => {
      assert.equal(String(url), selected.origin + '/.well-known/thingtime-capabilities.json');
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('x-vercel-protection-bypass'), 'synthetic-platform-bypass');
      return Response.json(manifest());
    } });
    await authority.current();
    const invalid = createGatewayAuthority({ settings: () => ({ ...selected, origin: selected.origin + '/foreign-path' }), fetch: async () => { assert.fail('Invalid configured origin must not receive a secret'); } });
    await assert.rejects(invalid.current());
  } finally {
    if (previous === undefined) delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    else process.env.VERCEL_AUTOMATION_BYPASS_SECRET = previous;

  }
});
