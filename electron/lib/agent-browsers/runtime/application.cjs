'use strict';
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const ORIGIN = 'http://127.0.0.1:18721';
const children = new Set();
let stopping = false;

function child(command, args, env) {
  // App/database output may contain account information. Never forward it to
  // the browser protocol, host logs, task progress, or screenshots.
  const process = spawn(command, args, { env, stdio: 'ignore' });
  children.add(process);
  process.once('error', () => { if (!stopping) global.process.exit(1); });
  process.once('exit', () => { children.delete(process); if (!stopping) global.process.exit(1); });
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

async function startApplication(sessionId, requestedOrigin) {
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
  child(process.execPath, ['-e', "require('/opt/thingtime-browser/application.cjs').serveApplication().catch(()=>process.exit(1))"], { ...base,
    NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(options.port), NITRO_PORT: String(options.port),
    APP_URL: options.origin, JWT_ISSUER: options.origin, JWT_SECRET: randomBytes(48).toString('base64url'),
    THINGTIME_AGENT_TEST_MODE: '1', THINGTIME_AGENT_TEST_SESSION: sessionId,
    MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:27017/thingtime?replicaSet=${replicaSet}`,
    ...options.environment
  });
  await until(async () => {
    const response = await fetch(`${options.origin}/api/v1/health/nitro`, { signal: AbortSignal.timeout(2000) });
    const health = await response.json();
    return applicationHealthIsReady(response.ok, health, sessionId);
  // Cold server imports and first database indexes contend with other task
  // startups. Keep this bounded independently from browser navigation.
  }, 'The private app failed its configuration preflight.', 90000);
  await verifyApplicationAssets(fetch, options.origin);
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
}

async function stopApplication() {
  stopping = true;
  for (const process of children) process.kill('SIGTERM');
}
module.exports = { startApplication, stopApplication, verifyApplicationAssets, applicationHealthIsReady, applicationOptions, serveApplication };
