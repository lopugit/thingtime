'use strict';
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const ORIGIN = 'http://127.0.0.1:18721';
const children = new Set();
const intentionalStops = new WeakSet();
let stopping = false;

function child(command, args, env) {
  // App/database output may contain account information. Never forward it to
  // the browser protocol, host logs, task progress, or screenshots.
  const process = spawn(command, args, { env, stdio: 'ignore' });
  children.add(process);
  process.once('error', () => { if (!stopping) global.process.exit(1); });
  process.once('exit', () => { children.delete(process); if (!stopping && !intentionalStops.has(process)) global.process.exit(1); });
  return process;
}

async function until(check, message, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* startup only */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(message);
}

async function startApplication(sessionId, { prepareAdministrator = false, configureVault = false } = {}) {
  if (typeof prepareAdministrator !== 'boolean' || typeof configureVault !== 'boolean') throw new Error('Fixture switches must be explicit.');
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
  const serverEnvironment = { ...base,
    NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: '18721', NITRO_PORT: '18721',
    APP_URL: ORIGIN, JWT_ISSUER: ORIGIN, JWT_SECRET: randomBytes(48).toString('base64url'),
    THINGTIME_AGENT_TEST_MODE: '1', THINGTIME_AGENT_TEST_SESSION: sessionId,
    MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:27017/thingtime?replicaSet=${replicaSet}`
  };
  if (configureVault) serverEnvironment.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
  const startServer = () => child(process.execPath, ['/opt/thingtime-app/server/index.mjs'], serverEnvironment);
  let server = startServer();
  const waitForApplication = () => until(async () => {
    const response = await fetch(`${ORIGIN}/api/v1/health/nitro`, { signal: AbortSignal.timeout(2000) });
    const health = await response.json();
    return applicationHealthIsReady(response.ok, health, sessionId);
  // Cold server imports and first database indexes contend with other task
  // startups. Keep this bounded independently from browser navigation.
  }, 'The private app failed its configuration preflight.', 90000);
  await waitForApplication();
  await verifyApplicationAssets();
  let administrator;
  if (prepareAdministrator) {
    // Register through the normal route BEFORE adding this generated username
    // to the allowlist. Reserved admin usernames cannot register, and fixture
    // setup must not bypass that policy or manufacture database roles.
    const username = `tt-fixture-admin-${randomBytes(6).toString('hex')}`;
    const password = `Task-${randomBytes(32).toString('base64url')}-9a!`;
    const request = (pathname, body) => fetch(ORIGIN + pathname, { method: 'POST', redirect: 'error',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const registration = await request('/api/v1/auth/register', { username, password, email: `${username}@example.test` });
    const registered = await registration.json();
    if (!registration.ok || !registered.user?.id || registered.user.isAdmin !== false) {
      throw new Error('The disposable administrator must start as an ordinary API-created account.');
    }
    await fs.mkdir('/home/pwuser/objects', { mode: 0o700 });
    serverEnvironment.ADMIN_USERNAMES = username;
    serverEnvironment.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = '/home/pwuser/objects';
    serverEnvironment.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN = ORIGIN;
    intentionalStops.add(server);
    await new Promise(resolve => {
      // Nitro may keep idle database sockets after closing its listener. This
      // is only the owned disposable server; Mongo stays live across restart.
      const force = setTimeout(() => server.kill('SIGKILL'), 10_000);
      server.once('exit', () => { clearTimeout(force); resolve(); });
      server.kill('SIGTERM');
    });
    server = startServer();
    await waitForApplication();
    await verifyApplicationAssets();
    const login = await request('/api/v1/login', { username, password });
    const authenticated = await login.json();
    if (!login.ok || authenticated.user?.id !== registered.user.id || authenticated.user.isAdmin !== true) {
      throw new Error('The API-created disposable administrator did not retain its identity.');
    }
    administrator = { base: ORIGIN, username, password, ownerId: registered.user.id };
  }
  return { origin: ORIGIN, sessionId, database: 'private-ephemeral', credentials: 'generated-in-task',
    ...(administrator ? { administrator } : {}) };
}

function applicationHealthIsReady(responseOk, health, sessionId) {
  return responseOk && health.ok === true && health.state === 'ready' &&
    health.storageAccounting?.state === 'ready' && health.testEnvironment?.sessionId === sessionId &&
    health.testEnvironment?.mode === 'isolated-agent-test';
}

async function verifyApplicationAssets(request = fetch) {
  const modulePath = html => html.match(/<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  const shells = await Promise.all(['/index.html', '/login'].map(async pathname => {
    const response = await request(ORIGIN + pathname, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The private app shell did not load.');
    return modulePath(await response.text());
  }));
  if (!shells[0]?.startsWith('/assets/') || shells[0] !== shells[1]) throw new Error('The private app shell and client assets do not match. Rebuild with sync:nitro-template.');
  const script = await request(ORIGIN + shells[0], { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(10000) });
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

async function stopApplication() {
  stopping = true;
  for (const process of children) process.kill('SIGTERM');
}
module.exports = { startApplication, stopApplication, verifyApplicationAssets, applicationHealthIsReady };
