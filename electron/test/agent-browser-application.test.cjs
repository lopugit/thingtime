'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyApplicationAssets, applicationHealthIsReady } = require('../lib/agent-browsers/runtime/application.cjs');
const html = hash => `<html><script type="module" crossorigin src="/assets/index-${hash}.js"></script></html>`;
test('a stale embedded shell or HTML substituted for JavaScript cannot pass app preflight', async () => {
  const request = (stale, missing) => async (url, options) => options.method === 'HEAD'
    ? new Response('', { headers: { 'content-type': missing ? 'text/html' : 'text/javascript' } })
    : new Response(html(url.endsWith('/login') && stale ? 'old' : 'current'));
  await verifyApplicationAssets(request(false, false));
  await assert.rejects(verifyApplicationAssets(request(true, false)), /shell and client assets do not match/);
  await assert.rejects(verifyApplicationAssets(request(false, true)), /entry module is missing/);
});

test('a successful HTTP response alone cannot establish private database readiness', () => {
  const health = { ok: true, state: 'ready', storageAccounting: { state: 'ready' }, testEnvironment: { mode: 'isolated-agent-test', sessionId: 'own-session' } };
  assert.equal(applicationHealthIsReady(true, health, 'own-session'), true);
  assert.equal(applicationHealthIsReady(false, health, 'own-session'), false);
  assert.equal(applicationHealthIsReady(true, health, 'other-session'), false);
  for (const change of [{ ok: false }, { state: 'degraded' }, { storageAccounting: { state: 'migration-required' } }, { testEnvironment: undefined }]) {
    assert.equal(applicationHealthIsReady(true, { ...health, ...change }, 'own-session'), false);
  }
});
