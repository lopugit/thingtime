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

test('desktop acceptance authority is exact loopback, with private local bytes and explicit data identity', () => {
  const { applicationOptions } = require('../lib/agent-browsers/runtime/application.cjs');
  const id = '12345678-1234-1234-1234-123456789abc', origin = 'http://127.0.0.1:28671';
  assert.deepEqual(applicationOptions(id), { origin: 'http://127.0.0.1:18721', port: 18721, environment: {} });
  const options = applicationOptions(id, origin);
  assert.equal(options.port, 28671);
  assert.equal(options.origin, origin);
  assert.equal(options.environment.THINGTIME_DATA_AUTHORITY_ORIGIN, origin);
  assert.equal(options.environment.THINGTIME_DATA_ENV, `custom:agent-${id}`);
  assert.equal(options.environment.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN, origin);
  assert.equal(options.environment.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR, '/home/pwuser/attachments');
  for (const invalid of ['http://127.0.0.1:28671/', 'https://thingtime.com', 'http://localhost:28671', 'http://127.0.0.1:80',
    'http://127.0.0.1:28671/path', 'http://127.0.0.1:28671?x=1', 'http://127.0.0.1:28671#x', 'http://user:password@127.0.0.1:28671']) {
    assert.throws(() => applicationOptions(id, invalid));
  }
  assert.throws(() => applicationOptions('not-a-session', origin));
});

test('asset acceptance reads the selected shared test origin, with no fixed-port fallback', async () => {
  const origin = 'http://127.0.0.1:28671', urls = [];
  await verifyApplicationAssets(async (url, options) => {
    urls.push(url);
    return options.method === 'HEAD' ? new Response('', { headers: { 'content-type': 'text/javascript' } }) : new Response(html('shared'));
  }, origin);
  assert.deepEqual(urls.sort(), [`${origin}/assets/index-shared.js`, `${origin}/index.html`, `${origin}/login`].sort());
});

test('packaged node_middleware exports serve real health and assets through the installed-app listener', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
  const { serveApplication } = require('../lib/agent-browsers/runtime/application.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-packaged-middleware-'));
  const entry = path.join(root, 'index.mjs');
  // Match the packaged Nitro export shape; this module intentionally has no
  // listener of its own, reproducing the previously silent startup failure.
  await fs.writeFile(entry, `export const middleware=(req,res)=>{if(req.url==='/api/v1/health/nitro'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({ok:true,state:'ready'}));}if(req.url==='/assets/index-current.js'){res.setHeader('content-type','text/javascript');return res.end('export{}');}if(req.url==='/fail')throw Error('private failure');res.end('<script type="module" src="/assets/index-current.js"></script>');};export const handleUpgrade=undefined;`);
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  let application;
  try {
    application = await serveApplication({ profilePath: root, port, entry });
    assert.equal(application.origin, `http://127.0.0.1:${port}`);
    assert.equal(application.server.address().address, '127.0.0.1');
    const health = await fetch(`${application.origin}/api/v1/health/nitro`);
    assert.deepEqual(await health.json(), { ok: true, state: 'ready' });
    await verifyApplicationAssets(fetch, application.origin);
    const failed = await fetch(`${application.origin}/fail`);
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /private failure/);
  } finally { await application?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
