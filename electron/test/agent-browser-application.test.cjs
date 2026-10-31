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

test('isolated upload bootstrap registers before restart and approves only exact non-admin private scope', async () => {
  const { bootstrapPrivateUploadFixture } = require('../lib/agent-browsers/runtime/application.cjs');
  const origin = 'http://127.0.0.1:28671', sessionId = '12345678-1234-1234-1234-123456789abc';
  const events = []; let admin, restarted = false, targetExists = false, targetAdmin = false, refused = false;
  const request = async (url, options) => {
    assert.equal(new URL(url).origin, origin);
    assert.equal(options.redirect, 'error');
    const pathname = new URL(url).pathname;
    events.push(pathname);
    if (pathname.endsWith('thingtime-capabilities.json')) return Response.json({ origin, features: {
      'api.auth-register': { version: '1.0.0' }, 'api.admin-users': { version: '1.0.0' }, 'api.auth-me': { version: '1.0.0' }, 'api.admin-users-public-uploads': { version: '1.0.0' }
    } });
    if (pathname === '/api/v1/auth/register') {
      assert.equal(restarted, false); admin = JSON.parse(options.body);
      assert.ok(admin.password.length >= 36);
      return Response.json({ user: { id: 'admin-id', username: admin.username, isAdmin: false } }, { headers: { 'set-cookie': 'fixture=private; HttpOnly' } });
    }
    assert.equal(options.headers.Cookie, 'fixture=private');
    assert.equal(restarted, true);
    if (pathname === '/api/v1/auth/me') return Response.json({ user: { id: 'admin-id', username: admin.username, isAdmin: true } });
    if (pathname === '/api/v1/admin/users') {
      assert.equal(new URL(url).searchParams.get('q'), 'synthetic-user');
      return Response.json({ results: [{ id: 'wrong', username: 'synthetic-user-extra', isAdmin: false },
        ...(targetExists ? [{ id: 'test-id', username: 'synthetic-user', isAdmin: targetAdmin }] : [])] });
    }
    assert.equal(pathname, '/api/v1/admin/users/public-uploads');
    assert.deepEqual(JSON.parse(options.body), { userId: 'test-id', enabled: true, scope: 'private' });
    if (refused) return new Response('sensitive server detail', { status: 403 });
    return Response.json({ user: { id: 'test-id', isAdmin: false, privateUploadsEnabled: true, publicUploadsEnabled: false } });
  };
  const approve = await bootstrapPrivateUploadFixture({ origin, sessionId, request, restart: async username => {
    assert.equal(username, admin.username); restarted = true;
  } });
  assert.equal(await approve('synthetic-user'), false);
  targetExists = true; targetAdmin = true;
  await assert.rejects(approve('synthetic-user'), /distinct non-admin/);
  targetAdmin = false; refused = true;
  await assert.rejects(approve('synthetic-user'), error => !error.message.includes('sensitive') && /refused/.test(error.message));
  refused = false;
  assert.equal(await approve('synthetic-user'), true);
  assert.deepEqual(events.slice(0, 3), ['/.well-known/thingtime-capabilities.json', '/api/v1/auth/register', '/api/v1/auth/me']);
});

test('upload bootstrap refuses foreign/missing authority and incompatible capability before registration', async () => {
  const { bootstrapPrivateUploadFixture } = require('../lib/agent-browsers/runtime/application.cjs');
  const sessionId = '12345678-1234-1234-1234-123456789abc';
  let calls = 0;
  const request = async () => { calls++; return Response.json({ origin: 'http://127.0.0.1:28671', features: { 'api.auth-me': { version: '2.0.0' } } }); };
  for (const origin of [undefined, 'https://thingtime.com']) {
    await assert.rejects(bootstrapPrivateUploadFixture({ origin, sessionId, restart: async () => {}, request }));
  }
  assert.equal(calls, 0);
  await assert.rejects(bootstrapPrivateUploadFixture({ origin: 'http://127.0.0.1:28671', sessionId, restart: async () => {}, request }), /capabilities/);
  assert.equal(calls, 1);
});

test('fixture option refuses production/non-isolated launch before provisioning', () => {
  const { requireFixtureIsolation } = require('../lib/agent-browsers/runtime/application.cjs');
  for (const proof of [undefined, { isolated: false, mode: 'restricted' }, { isolated: false, mode: 'unrestricted' }]) {
    assert.throws(() => requireFixtureIsolation('test-user', 'http://127.0.0.1:28671', proof), /isolated/);
  }
  assert.throws(() => requireFixtureIsolation('test-user', undefined, { isolated: true }));
  requireFixtureIsolation(undefined, undefined, { isolated: false });
  requireFixtureIsolation('test-user', 'http://127.0.0.1:28671', { isolated: true });
});

test('supervised API restart retains signing/database environment and live database child; unrelated exit stays fatal', async () => {
  const { spawnSync } = require('node:child_process');
  const helper = require.resolve('../lib/agent-browsers/runtime/application.cjs');
  const code = `
    const {child,restartApplicationChild,stopApplication}=require(${JSON.stringify(helper)});
    const {randomBytes,createHash}=require('node:crypto');
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    (async()=>{
      const root=fs.mkdtempSync(path.join(os.tmpdir(),'tt-restart-proof-'));
      const env={...process.env,JWT_SECRET:randomBytes(48).toString('base64url'),MONGODB_CONNECTION_STRING:'mongodb://127.0.0.1:27017/'+randomBytes(8).toString('hex')};
      const database=child(process.execPath,['-e','setInterval(()=>{},1000)'],env);
      const program="const fs=require('fs'),c=require('crypto');fs.writeFileSync(process.env.PROOF,c.createHash('sha256').update(process.env.JWT_SECRET+'|'+process.env.MONGODB_CONNECTION_STRING).digest('hex'),{mode:0o600});setInterval(()=>{},1000)";
      const wait=async file=>{for(let i=0;i<100;i++){if(fs.existsSync(file))return;await new Promise(r=>setTimeout(r,10));}throw Error('proof timeout')};
      const first=path.join(root,'first'),second=path.join(root,'second');
      try{
        const api=child(process.execPath,['-e',program],{...env,PROOF:first});await wait(first);
        await restartApplicationChild(api,()=>child(process.execPath,['-e',program],{...env,PROOF:second,ADMIN_USERNAMES:'synthetic-admin'}));
        await wait(second);process.kill(database.pid,0);
        if(fs.readFileSync(first,'utf8')!==fs.readFileSync(second,'utf8'))throw Error('state changed');
      }finally{await stopApplication();fs.rmSync(root,{recursive:true,force:true});}
    })().catch(()=>process.exit(2));`;
  const restarted = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 15000 });
  assert.equal(restarted.status, 0, 'controlled restart must preserve namespace state');
  assert.equal(restarted.stdout, '');
  const failed = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(helper)}).child(process.execPath,['-e','process.exit(0)'],process.env)`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(failed.status, 1, 'unexpected child exit must terminate the runtime');
  assert.equal(failed.stdout, '');
});


test('each used fixture API must be negotiated before any registration', async () => {
  const { bootstrapPrivateUploadFixture } = require('../lib/agent-browsers/runtime/application.cjs');
  const required = ['api.auth-register', 'api.auth-me', 'api.admin-users', 'api.admin-users-public-uploads'];
  for (const missing of required) {
    let calls = 0;
    await assert.rejects(bootstrapPrivateUploadFixture({ origin: 'http://127.0.0.1:28671',
      sessionId: '12345678-1234-1234-1234-123456789abc', restart: async () => assert.fail('must not restart'),
      request: async () => { calls++; return Response.json({ origin: 'http://127.0.0.1:28671',
        features: Object.fromEntries(required.filter(key => key !== missing).map(key => [key, { version: '1.0.0' }])) }); }
    }), /capabilities/);
    assert.equal(calls, 1, missing);
  }
});
