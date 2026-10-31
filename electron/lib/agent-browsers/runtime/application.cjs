'use strict';
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const ORIGIN = 'http://127.0.0.1:18721';
const children = new Set();
const intentionalStops = new WeakSet();
let stopping = false;
const intentionalExits = new WeakSet();

function child(command, args, env) {
  // App/database output may contain account information. Never forward it to
  // the browser protocol, host logs, task progress, or screenshots.
  const process = spawn(command, args, { env, stdio: 'ignore' });
  children.add(process);
  process.once('error', () => { if (!stopping) global.process.exit(1); });
  process.once('exit', () => { children.delete(process); if (!stopping && !intentionalExits.has(process)) global.process.exit(1); });
  return process;
}

async function restartApplicationChild(api, launch) {
  intentionalExits.add(api);
  const exited = once(api, 'exit');
  let timer;
  const deadline = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Fixture API restart timed out.')), 10000); });
  try { api.kill('SIGTERM'); await Promise.race([exited, deadline]); }
  finally { clearTimeout(timer); }
  if (stopping) throw new Error('Fixture stopped.');
  return launch();
}

function requireFixtureIsolation(username, origin, proof) {
  if (username === undefined) return;
  if (!proof?.isolated || origin === undefined || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error('Upload fixture requires enforced isolated networking and an explicit authority.');
}

async function until(check, message, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* startup only */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(message);
}

function applicationOptions(sessionId, origin) {
  if (origin === undefined) return { origin: ORIGIN, port: 18721, environment: {} };
  const url = new URL(origin);
  const port = Number(url.port);
  if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      url.username || url.password || !Number.isInteger(port) || port < 1024 || port > 65535 ||
      !/^[a-f0-9-]{36}$/.test(sessionId || '')) throw new Error('Use an exact private loopback test origin.');
  return { origin, port, environment: {
    THINGTIME_DATA_ENV: `custom:agent-${sessionId}`,
    THINGTIME_DATA_AUTHORITY_ORIGIN: origin,
    THINGTIME_EMAIL_PROVIDER: 'console',
    THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: '/home/pwuser/attachments',
    THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN: origin
  } };
}

async function serveApplication({ profilePath = '/home/pwuser', port = Number(process.env.PORT), entry = '/opt/thingtime-app/server/index.mjs' } = {}) {
  // The image builder stages this exact installed-app helper beside us. Source
  // checks use its canonical host location, without maintaining another server.
  const helper = require('node:fs').existsSync(require('node:path').join(__dirname, 'renderer-server.cjs'))
    ? './renderer-server.cjs' : '../../renderer-server.cjs';
  const { startRendererServer } = require(helper);
  return startRendererServer({ profilePath, selectedPort: port, loadApplication: () => import(pathToFileURL(entry).href) });
}

async function startApplication(sessionId, requestedOrigin, fixtureUsername) {
  if (fixtureUsername !== undefined && (!requestedOrigin || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(fixtureUsername))) throw new Error('Use an exact isolated fixture username.');
  const options = applicationOptions(sessionId, requestedOrigin);
  const { MongoClient } = require('mongodb');
  try { await fs.access('/opt/thingtime-app/server/index.mjs'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('The bundled private app is not readable by the task user.');
  }
  if (!/^[a-f0-9-]{36}$/.test(sessionId || '')) throw new Error('The private app requires a unique task identity.');
  const replicaSet = `tt-agent-${sessionId}`;
  const databasePath = '/home/pwuser/database';
  await fs.mkdir(databasePath, { mode: 0o700 });
  const base = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/pwuser', TMPDIR: '/tmp' };
  child('/usr/local/bin/mongod', ['--bind_ip', '127.0.0.1', '--port', '27017', '--dbpath', databasePath,
    '--replSet', replicaSet, '--wiredTigerCacheSizeGB', '0.25', '--quiet'], base);
  const direct = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true', { serverSelectionTimeoutMS: 700 });
  try {
    await until(async () => {
      // A MongoClient that failed its initial connection is closed by the
      // driver. Each startup probe needs a fresh client, then the long-lived
      // connection is opened only once the server is listening.
      const probe = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true', { serverSelectionTimeoutMS: 700 });
      try { await probe.db('admin').command({ ping: 1 }); return true; } finally { await probe.close(); }
    }, 'The private database did not start.');
    await direct.connect();
    await direct.db('admin').command({ replSetInitiate: { _id: replicaSet, members: [{ _id: 0, host: '127.0.0.1:27017' }] } });
    await until(async () => (await direct.db('admin').command({ hello: 1 })).isWritablePrimary, 'The private database did not become writable.');
  } finally { await direct.close(); }
  // Fresh generated signing material never leaves this namespace. This is a
  // disposable test identity, not a password fetched from a personal profile.
  const applicationEnv = { ...base,
    NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(options.port), NITRO_PORT: String(options.port),
    APP_URL: options.origin, JWT_ISSUER: options.origin, JWT_SECRET: randomBytes(48).toString('base64url'),
    THINGTIME_AGENT_TEST_MODE: '1', THINGTIME_AGENT_TEST_SESSION: sessionId,
    MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:27017/thingtime?replicaSet=${replicaSet}`,
    ...options.environment
  };
  const launchApi = () => child(process.execPath, ['-e', "require('/opt/thingtime-browser/application.cjs').serveApplication().catch(()=>process.exit(1))"], applicationEnv);
  let api = launchApi();
  const ready = async () => { await until(async () => {
    const response = await fetch(`${options.origin}/api/v1/health/nitro`, { signal: AbortSignal.timeout(2000) });
    const health = await response.json();
    return applicationHealthIsReady(response.ok, health, sessionId);
  // Cold server imports and first database indexes contend with other task
  // startups. Keep this bounded independently from browser navigation.
  }, 'The private app failed its configuration preflight.', 90000);
  await verifyApplicationAssets(fetch, options.origin); };
  await ready();
  if (fixtureUsername !== undefined) {
    const approve = await bootstrapPrivateUploadFixture({ origin: options.origin, sessionId, restart: async username => {
      api = await restartApplicationChild(api, () => {
        applicationEnv.ADMIN_USERNAMES = username;
        return launchApi();
      });
      await ready();
    } });
    // Only this explicitly named user can receive approval. No credentials or
    // control interface leave the namespace; the human-facing account uses its
    // own normal UI registration and password-manager entry.
    (async () => {
      const deadline = Date.now() + 1800000;
      let delay = 15000;
      while (!stopping && Date.now() < deadline) {
        if (await approve(fixtureUsername)) return;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 60000);
      }
      if (!stopping) throw new Error('Fixture approval timed out.');
    })().catch(() => { if (!stopping) global.process.exit(1); });
  }
  return { origin: options.origin, sessionId, database: 'private-ephemeral', credentials: 'generated-in-task' };
}

function applicationHealthIsReady(responseOk, health, sessionId) {
  return responseOk && health.ok === true && health.state === 'ready' &&
    health.storageAccounting?.state === 'ready' && health.testEnvironment?.sessionId === sessionId &&
    health.testEnvironment?.mode === 'isolated-agent-test';
}

async function verifyApplicationAssets(request = fetch, origin = ORIGIN) {
  const modulePath = html => html.match(/<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  const shells = await Promise.all(['/index.html', '/login'].map(async pathname => {
    const response = await request(origin + pathname, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The private app shell did not load.');
    return modulePath(await response.text());
  }));
  if (!shells[0]?.startsWith('/assets/') || shells[0] !== shells[1]) throw new Error('The private app shell and client assets do not match. Rebuild with sync:nitro-template.');
  const script = await request(origin + shells[0], { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!script.ok || !/javascript/.test(script.headers.get('content-type') || '')) throw new Error('The private app entry module is missing.');
  // A main Vite build clears dist before the independent renderer bundles are
  // rebuilt. The SPA fallback can return HTML 200 for these missing scripts.
  // Require the complete canonical client build before accepting a runtime.
  for (const pathname of ['/draft-preview/runner.js', '/platform/runtime.js', '/library/runner.js', '/embed/thingtime.min.js']) {
    const response = await request(ORIGIN + pathname, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok || !/javascript/.test(response.headers.get('content-type') || '')) {
      throw new Error(`The private app ${pathname} bundle is missing. Rebuild with build:client, sync:nitro-template and build:server.`);
    }
  }
}

// Test-only bootstrap through ordinary HTTP APIs. Session/signing material stays
// in this process, never in protocol responses, environment dumps or arguments.
async function bootstrapPrivateUploadFixture({ origin, sessionId, restart, request = fetch }) {
  applicationOptions(sessionId, origin);
  if (!origin || typeof restart !== 'function') throw new Error('Fixture authority is required.');
  let cookie = '';
  const call = async (pathname, body) => {
    const response = await request(origin + pathname, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Isolated fixture API refused the operation.');
    let value;
    try { value = await response.json(); } catch { throw new Error('Invalid isolated fixture API response.'); }
    if (pathname === '/api/v1/auth/register') {
      cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      if (!cookie) throw new Error('Fixture registration did not establish a session.');
    }
    return value;
  };
  const manifest = await call('/.well-known/thingtime-capabilities.json');
  if (manifest.origin !== origin || !['api.auth-register', 'api.auth-me', 'api.admin-users', 'api.admin-users-public-uploads'].every(key => {
    const version = manifest.features?.[key]?.version;
    return typeof version === 'string' && /^1\.\d+\.\d+$/.test(version);
  })) throw new Error('Fixture capabilities are unavailable.');
  const username = 'fixture-admin-' + randomBytes(8).toString('hex');
  const registered = await call('/api/v1/auth/register', { username, email: username + '@example.invalid', password: randomBytes(36).toString('base64url') });
  if (!registered.user?.id || registered.user.isAdmin) throw new Error('Fixture registration identity is invalid.');
  await restart(username);
  const me = await call('/api/v1/auth/me');
  if (me.user?.id !== registered.user.id || me.user.username !== username || me.user.isAdmin !== true) throw new Error('Fixture administrator bootstrap failed.');
  return async target => {
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(target) || target === username) throw new Error('Invalid fixture target.');
    const users = await call('/api/v1/admin/users?q=' + encodeURIComponent(target));
    if (!Array.isArray(users.results)) throw new Error('Invalid fixture lookup response.');
    const matches = users.results.filter(user => user.username === target);
    if (!matches.length) return false;
    if (matches.length !== 1 || !matches[0].id || matches[0].isAdmin !== false || matches[0].envAdmin) throw new Error('Fixture target must be a distinct non-admin.');
    const result = await call('/api/v1/admin/users/public-uploads', { userId: matches[0].id, enabled: true, scope: 'private' });
    if (result.user?.id !== matches[0].id || result.user.privateUploadsEnabled !== true || result.user.publicUploadsEnabled !== false || result.user.isAdmin !== false) throw new Error('Private fixture approval readback failed.');
    cookie = ''; // Drop the only bootstrap session handle after its single use.
    return true;
  };
}

async function stopApplication() {
  stopping = true;
  for (const process of children) process.kill('SIGTERM');
}
module.exports = { child, restartApplicationChild, requireFixtureIsolation, bootstrapPrivateUploadFixture, startApplication, stopApplication, verifyApplicationAssets, applicationHealthIsReady, applicationOptions, serveApplication };
