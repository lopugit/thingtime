import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedDeploymentFetch } from './protected-deployment-fetch.mjs';

const env = { VERCEL_API_TOKEN: 'synthetic-api-token', VERCEL_PROJECT_ID: 'prj_test', VERCEL_TEAM_ID: 'team_test' };
const credential = 'synthetic-preview-only-credential';
const fixture = ({ projectId = 'prj_test', bypass = true } = {}) => {
  const calls = [];
  const fetcher = async (input, init) => {
    const url = new URL(input); calls.push({ url, init });
    if (url.hostname === 'api.vercel.com') {
      if (url.pathname.startsWith('/v9/projects/')) return Response.json({ id: 'prj_test', ssoProtection: { deploymentType: 'prod_deployment_urls_and_all_previews' }, protectionBypass: bypass ? { [credential]: { scope: 'automation-bypass' } } : {} });
      return Response.json({ projectId });
    }
    return Response.json({ ok: true });
  };
  return { calls, request: createProtectedDeploymentFetch({ env, fetcher }) };
};

test('owned preview checks use provider credential and forbid credential redirects', async () => {
  const { calls, request } = fixture();
  await request('https://preview.example.test/api/root-data', { redirect: 'follow', headers: { 'x-vercel-protection-bypass': 'untrusted', Accept: 'application/json' } });
  const call = calls.at(-1);
  assert.equal(call.init.headers.get('x-vercel-protection-bypass'), credential);
  assert.equal(call.init.headers.get('authorization'), null);
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.headers.get('accept'), 'application/json');
  await request('https://preview.example.test/index.html');
  assert.equal(calls.filter(c => c.url.hostname === 'api.vercel.com').length, 2);
});

test('another project never receives an automation credential', async () => {
  const { calls, request } = fixture({ projectId: 'prj_other' });
  await assert.rejects(request('https://foreign.example.test/'), /another project/);
  assert.ok(calls.every(c => c.url.hostname === 'api.vercel.com'));
});

test('protected project without a credential fails closed', async () => {
  const { request } = fixture({ bypass: false });
  await assert.rejects(request('https://preview.example.test/'), /no automation credential/);
});

test('anonymous mode strips caller protection credentials and rejects unsafe URLs', async () => {
  let seen;
  const request = createProtectedDeploymentFetch({ env: {}, fetcher: async (_, init) => { seen = init; return Response.json({ ok: true }); } });
  await request('https://production.example.test/', { headers: { 'x-vercel-protection-bypass': credential, 'x-vercel-set-bypass-cookie': 'true' } });
  assert.equal(seen.headers.get('x-vercel-protection-bypass'), null);
  assert.equal(seen.headers.get('x-vercel-set-bypass-cookie'), null);
  await assert.rejects(request('http://preview.example.test/'), /Invalid/);
  await assert.rejects(request('https://user:pass@preview.example.test/'), /Invalid/);
});

test('target origin validation rejects alternate ports and strips caller routing overrides', async () => {
  const { calls, request } = fixture();
  await assert.rejects(request('https://preview.example.test:8443/'), /Invalid/);
  assert.equal(calls.length, 0);
  await request('https://preview.example.test/', { headers: { Host: 'other-project.example.test' } });
  assert.equal(calls.at(-1).init.headers.has('host'), false);
});

test('provider and target transport diagnostics never include credential-bearing details', async () => {
  for (const failProvider of [true, false]) {
    const request = createProtectedDeploymentFetch({ env, fetcher: async (input) => {
      const url = new URL(input);
      if (url.hostname === 'api.vercel.com' && !failProvider) {
        return Response.json(url.pathname.startsWith('/v9/projects/')
          ? { id: env.VERCEL_PROJECT_ID, protectionBypass: { [credential]: { scope: 'automation-bypass' } } }
          : { projectId: env.VERCEL_PROJECT_ID });
      }
      throw new Error(`Sensitive transport detail ${credential} ${env.VERCEL_API_TOKEN}`);
    } });
    await assert.rejects(request('https://preview.example.test/'), error => {
      assert.equal(error.message.includes(credential), false);
      assert.equal(error.message.includes(env.VERCEL_API_TOKEN), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('real fetch transport sends only the scoped header and never follows a foreign redirect', async t => {
  const { createServer } = await import('node:http');
  let ownedCalls = 0, foreignCalls = 0;
  const foreign = createServer((_request, response) => { foreignCalls++; response.end('unexpected'); });
  const owned = createServer((incoming, response) => {
    ownedCalls++;
    assert.equal(incoming.headers['x-vercel-protection-bypass'], credential);
    assert.equal(incoming.headers.authorization, undefined);
    response.writeHead(302, { Location: `http://127.0.0.1:${foreign.address().port}/foreign` }); response.end();
  });
  for (const server of [foreign, owned]) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  }
  const request = createProtectedDeploymentFetch({ env, fetcher: async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'api.vercel.com') return Response.json(url.pathname.startsWith('/v9/projects/')
      ? { id: env.VERCEL_PROJECT_ID, protectionBypass: { [credential]: { scope: 'automation-bypass' } } }
      : { projectId: env.VERCEL_PROJECT_ID });
    assert.equal(url.origin, 'https://preview.example.test');
    // Map only this synthetic verified target to a local transport fixture.
    return fetch(`http://127.0.0.1:${owned.address().port}${url.pathname}`, init);
  } });
  await assert.rejects(request('https://preview.example.test/'), /Deployment check request unavailable/);
  assert.equal(ownedCalls, 1);
  assert.equal(foreignCalls, 0);
});

test('credential and target verification expire rather than authorizing a moved alias indefinitely', async () => {
  let time = 0, owned = true, requests = 0, lookups = 0;
  const request = createProtectedDeploymentFetch({ env, now: () => time, fetcher: async (input) => {
    const url = new URL(input);
    if (url.hostname === 'api.vercel.com') {
      lookups++;
      return Response.json(url.pathname.startsWith('/v9/projects/')
        ? { id: env.VERCEL_PROJECT_ID, protectionBypass: { [credential]: { scope: 'automation-bypass' } } }
        : { projectId: owned ? env.VERCEL_PROJECT_ID : 'prj_other' });
    }
    requests++; return Response.json({ ok: true });
  } });
  await request('https://preview.example.test/');
  time = 29_999;
  await request('https://preview.example.test/index.html');
  assert.equal(lookups, 2);
  time = 30_000; owned = false;
  await assert.rejects(request('https://preview.example.test/'), /another project/);
  assert.equal(lookups, 4);
  assert.equal(requests, 2);
});
