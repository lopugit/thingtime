#!/usr/bin/env node
// Built Nitro transport + disposable API data. Only replica-set administration
// uses Mongo directly; all product identities/data are created through the API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';

assert.equal(process.platform, 'darwin', 'Requires sandbox-exec; never run an unrestricted fallback.');
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-environment-gateway-'));
const ports = { alias: 19771, owner: 19772, follower: 19773, successor: 19774, db: 19775, trap: 19776, vite: 19777, hmr: 19778, dedicated: 19779, dedicatedDb: 19780 };
const origin = key => `http://127.0.0.1:${ports[key]}`;
const children = [];
let routeTo = 'owner', followerDials = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const port of Object.values(ports)) {
  const socket = createTcpServer(); await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => socket.close(resolve));
}
const policy = join(dir, 'network.sb');
await writeFile(policy, `(version 1)(allow default)(deny network*)
(allow network-bind (local unix-socket))
(allow network-inbound ${Object.values(ports).map(port => `(local ip "localhost:${port}")`).join(' ')})
(allow network-outbound ${Object.values(ports).map(port => `(remote ip "localhost:${port}")`).join(' ')})`);
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=gateway-test`;
const dedicatedMongoUri = `mongodb://127.0.0.1:${ports.dedicatedDb}/thingtime?replicaSet=gateway-dedicated-test`;
const relaySecret = randomBytes(48).toString('hex');
const jwt = randomBytes(48).toString('hex');
const instrumentation = join(dir, 'mongo-command-trace.mjs');
// Nitro bundles the driver, so instrument that exact generated module rather
// than a separate node_modules copy. This changes no application source/output.
const endpointBundle = join(cwd, '.output/server/_chunks/endpoint.mjs');
const mongoImport = (await readFile(endpointBundle, 'utf8')).match(/modulePromise \?\?= import\("([^\"]+)"\)/);
assert.ok(mongoImport, 'Locate the built driver factory before collecting command evidence.');
const driverBundle = new URL(mongoImport[1], pathToFileURL(endpointBundle)).href;
await writeFile(instrumentation, `import{appendFileSync}from'node:fs';
const {default:{MongoClient}}=await import(${JSON.stringify(driverBundle)});
const connect=MongoClient.prototype.connect;const traced=new WeakSet();
MongoClient.prototype.connect=async function(...args){if(!traced.has(this)){traced.add(this);this.monitorCommands=true;
for(const event of ['commandStarted','commandSucceeded','commandFailed'])this.on(event,value=>{if(['createIndexes','dropIndexes'].includes(value.commandName))appendFileSync(process.env.GATEWAY_INDEX_TRACE,JSON.stringify({event,id:value.requestId,command:value.commandName})+'\\n')});}return connect.apply(this,args)};`);
function start(executable, args, extra = {}) {
  const child = spawn('/usr/bin/sandbox-exec', ['-f', policy, executable, ...args], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'test', HOST: '127.0.0.1',
    MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: jwt, THINGTIME_DATA_ENV: 'development',
    THINGTIME_GATEWAY_ENVIRONMENT: 'acceptance', THINGTIME_GATEWAY_ORIGIN: origin('alias'),
    THINGTIME_GATEWAY_SECRET: relaySecret, THINGTIME_GATEWAY_TEST_LOOPBACK: '1',
    THINGTIME_GATEWAY_SOURCE_ORIGINS: ['owner', 'follower', 'successor', 'dedicated'].map(origin).join(','), ...extra
  } });
  let log = ''; child.stdout.on('data', value => { log += value; }); child.stderr.on('data', value => { log += value; });
  children.push(child); return { child, log: () => log };
}
const startNitro = (key, extra = {}) => start(process.execPath, ['--import', instrumentation, '.output/server/index.mjs'], {
  PORT: String(ports[key]), THINGTIME_GATEWAY_DEPLOYMENT_ID: key, GATEWAY_INDEX_TRACE: join(dir, `${key}-index.jsonl`), ...extra
});
async function indexTrace(key) {
  let lines;
  try { lines = (await readFile(join(dir, `${key}-index.jsonl`), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return { creates: 0, drops: 0, peak: 0 }; throw error; }
  const active = new Set(); let peak = 0, creates = 0, drops = 0;
  for (const event of lines) {
    if (event.event === 'commandStarted') { active.add(event.id); if (event.command === 'createIndexes') creates++; else drops++; peak = Math.max(peak, active.size); }
    else active.delete(event.id);
  }
  return { creates, drops, peak };
}
async function ready(server, key) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.child.exitCode !== null) throw new Error('Built gateway exited before readiness.');
    try { if ((await fetch(origin(key) + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await delay(150);
  }
  throw new Error('Built gateway readiness timed out.');
}
async function api(key, path, { body, cookie, status = 200, headers = {} } = {}) {
  console.log(`${key} ${body ? 'POST' : 'GET'} ${path.split('?')[0]}`);
  const response = await fetch(origin(key) + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: origin(key),
    ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, status, `${key} ${path}: HTTP ${response.status}`);
  const data = await response.json();
  return { response, data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
const trap = createTcpServer(socket => { followerDials++; socket.destroy(); });
const alias = createServer((request, response) => {
  const upstream = httpRequest(origin(routeTo) + request.url, { method: request.method, headers: { ...request.headers, host: new URL(origin('alias')).host } }, result => {
    response.writeHead(result.statusCode, result.headers); result.pipe(response);
  });
  upstream.on('error', () => { response.writeHead(503); response.end(); }); request.pipe(upstream);
});
try {
  const boundary = start(process.execPath, ['--input-type=module', '-e', `try{await fetch('http://1.1.1.1:80/',{signal:AbortSignal.timeout(1500)});process.exit(2)}catch(error){if(error.cause?.code!=='EPERM')process.exit(3)}`]);
  assert.equal((await once(boundary.child, 'exit'))[0], 0, 'Backend direct-IP boundary must refuse external traffic.');
  await new Promise(resolve => trap.listen(ports.trap, '127.0.0.1', resolve));
  await new Promise(resolve => alias.listen(ports.alias, '127.0.0.1', resolve));
  for (const [key, replica] of [['db', 'gateway-test'], ['dedicatedDb', 'gateway-dedicated-test']]) {
    await mkdir(join(dir, key));
    start('/opt/homebrew/bin/mongod', ['--dbpath', join(dir, key), '--port', String(ports[key]), '--bind_ip', '127.0.0.1', '--replSet', replica, '--nounixsocket']);
    const client = new MongoClient(`mongodb://127.0.0.1:${ports[key]}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
    for (let attempt = 0; ; attempt++) { try { await client.connect(); break; } catch (error) { if (attempt > 40) throw error; await delay(200); } }
    await client.db('admin').command({ replSetInitiate: { _id: replica, members: [{ _id: 0, host: `127.0.0.1:${ports[key]}` }] } });
    for (let attempt = 0; ; attempt++) { if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break; if (attempt > 100) throw new Error('Replica not primary.'); await delay(200); }
    await client.close();
  }
  const owner = startNitro('owner'); await ready(owner, 'owner');
  const follower = startNitro('follower', {
    MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.trap}/thingtime`, JWT_SECRET: randomBytes(48).toString('hex') }); await ready(follower, 'follower');
  const manifest = (await api('alias', '/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.gateway.deploymentId, 'owner'); assert.equal(manifest.features['api.environment-gateway'].version, '1.1.0');
  // Exercise the real Vite config too: direct Nitro checks cannot catch a
  // missing dev proxy rule that serves the SPA shell instead of root docs.
  const vite = start(process.execPath, ['--input-type=module', '-e',
    "const{createServer}=await import('vite');const server=await createServer({envFile:false,server:{host:'127.0.0.1'}});await server.listen();"], {
    TT_WEB_PORT: String(ports.vite), TT_HMR_PORT: String(ports.hmr), TT_API_PORT: String(ports.follower)
  });
  await ready(vite, 'vite');
  for (const transport of ['follower', 'vite']) for (const endpoint of ['/social-card', '/.well-known/thingtime-capabilities.json']) for (const method of ['GET', 'POST']) {
    const response = await fetch(origin(transport) + endpoint + '-docs', { method, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `${transport} ${endpoint}-docs ${method}`);
    assert.match(response.headers.get('content-type'), /application\/json/, `${transport} ${endpoint}-docs ${method} must reach Nitro`);
    const doc = await response.json(); assert.equal(doc.ok, true); assert.equal(doc.docs.endpoint, endpoint);
    assert.equal(doc.docs.docsEndpoint, endpoint + '-docs'); assert.ok(doc.docs.steps.length);
    for (const platform of ['curl', 'node', 'python', 'ruby', 'wget']) assert.ok(doc.docs.platformExamples[platform]);
  }
  const account = await api('follower', '/api/v1/auth/register', { body: { username: 'gateway-acceptance', email: 'gateway@example.invalid', password: randomBytes(24).toString('hex') } });
  assert.ok(account.data.user.id); assert.ok(account.cookie);
  const root = await api('follower', '/api/root-data', { cookie: account.cookie }); assert.equal(root.data.user.id, account.data.user.id);
  await api('follower', '/api/v1/things', { cookie: account.cookie, body: { thingtime: ['post'], crystal: { type: 'text', text: 'Gateway acceptance' }, acl: ['tt:all'] },
    headers: { Origin: 'https://cross-site.invalid', 'Sec-Fetch-Site': 'cross-site' }, status: 403 });
  const saved = await api('follower', '/api/v1/things', { cookie: account.cookie, body: { thingtime: ['post'], crystal: { type: 'text', text: 'Gateway acceptance' }, acl: ['tt:all'] } });
  assert.ok(saved.data.post?.id || saved.data.thing?.id);
  await api('follower', '/api/v1/things', { headers: { 'x-thingtime-gateway-relay': 'forged' }, status: 508 });
  const dedicated = startNitro('dedicated', {
    THINGTIME_MONGODB_CONNECTION_MODE: 'dedicated', MONGODB_CONNECTION_STRING: dedicatedMongoUri,
    JWT_SECRET: randomBytes(48).toString('hex')
  }); await ready(dedicated, 'dedicated');
  assert.equal((await api('dedicated', '/.well-known/thingtime-capabilities.json')).data.gateway, null);
  // The same username is independently registered in a separate disposable DB.
  // If this branch accidentally forwarded to the gateway, this would conflict.
  const branchAccount = await api('dedicated', '/api/v1/auth/register', { body: {
    username: 'gateway-acceptance', email: 'gateway@example.invalid', password: randomBytes(32).toString('hex')
  } });
  assert.notEqual(branchAccount.data.user.id, account.data.user.id);
  assert.equal((await api('dedicated', '/api/root-data', { cookie: branchAccount.cookie })).data.user.id, branchAccount.data.user.id);
  const branchPost = await api('dedicated', '/api/v1/things', { cookie: branchAccount.cookie, body: {
    thingtime: ['post'], crystal: { type: 'text', text: 'Dedicated branch acceptance' }, acl: ['tt:all']
  } });
  const branchPostId = branchPost.data.post?.id || branchPost.data.thing?.id;
  assert.ok(branchPostId);
  const dedicatedShell = await fetch(origin('dedicated') + '/post/' + branchPostId);
  assert.equal(dedicatedShell.headers.get('x-tt-shell'), 'social-meta');
  assert.match(await dedicatedShell.text(), /Dedicated branch acceptance/, 'Dedicated shell must resolve its own public post metadata.');
  const followerShell = await fetch(origin('follower') + '/post/' + branchPostId);
  assert.doesNotMatch(await followerShell.text(), /Dedicated branch acceptance/, 'Proxy follower shell stays generic.');
  assert.equal((await api('follower', '/api/root-data', { cookie: account.cookie })).data.user.id, account.data.user.id);
  await api('dedicated', '/api/v1/things', { headers: { 'x-thingtime-gateway-relay': 'forged' }, status: 403 });
  const dedicatedIndex = await indexTrace('dedicated'); assert.ok(dedicatedIndex.creates > 0);
  const initialized = await indexTrace('owner'); assert.ok(initialized.creates > 0); assert.ok(initialized.peak <= 2);
  const successor = startNitro('successor'); await ready(successor, 'successor');
  routeTo = 'successor'; await delay(5_100);
  assert.equal((await api('owner', '/api/root-data', { cookie: account.cookie })).data.user.id, account.data.user.id);
  await api('successor', '/api/v1/things', { cookie: account.cookie, body: { thingtime: ['post'], crystal: { type: 'text', text: 'Unchanged cold plan' }, acl: ['tt:all'] } });
  const unchanged = await indexTrace('successor'); assert.equal(unchanged.creates, 0); assert.equal(unchanged.drops, 0);
  routeTo = 'owner'; await delay(5_100);
  assert.equal((await api('successor', '/api/root-data', { cookie: account.cookie })).data.user.id, account.data.user.id);
  assert.equal(followerDials, 0, 'Follower must never open its configured MongoDB socket.');
  console.log(JSON.stringify({ ok: true, transport: 'built-nitro', viteRootDocs: true, registration: true, authCookies: true, crossSiteRefused: true, writes: true, dedicatedOwnHandler: true, dedicatedShellMetadata: true, independentDedicatedDatabase: true, dedicatedIndexCommands: dedicatedIndex, promotion: true, rollback: true, followerMongoDials: followerDials,
    initializedIndexCommands: initialized, unchangedColdIndexCommands: unchanged }));
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
  await Promise.all(children.filter(child => child.exitCode === null && child.signalCode === null).map(child => Promise.race([once(child, 'exit'), delay(3000)])));
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  alias.closeAllConnections(); await new Promise(resolve => alias.close(resolve)); await new Promise(resolve => trap.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
