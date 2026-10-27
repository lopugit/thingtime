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
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';
import { draftPreviewCsp } from './csp.mjs';
import { tsImport } from 'tsx/esm/api';

// Validate actual HTTP bytes with the shipping protocol reader, not a second
// acceptance-only interpretation of its digest/framing/clean-EOF contract.
const { readCatalogueStream } = await tsImport('../app/catalogue/catalogueStream.ts', import.meta.url);
const { capabilitySatisfies } = await tsImport('../app/api/utils/capabilities/capabilityContract.ts', import.meta.url);
const { getDeploymentDataEnvironment } = await tsImport('../app/api/utils/deployment/dataEnvironment.ts', import.meta.url);

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
async function api(key, path, { body, cookie, status = 200, headers = {}, retryRateLimit = false } = {}) {
  console.log(`${key} ${body ? 'POST' : 'GET'} ${path.split('?')[0]}`);
  const send = () => fetch(origin(key) + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: origin(key),
    ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  let response = await send();
  if (retryRateLimit && status === 200 && response.status === 429) {
    const seconds = Number(response.headers.get('retry-after'));
    assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 60, 'Honor the bounded fixture rate-limit response.');
    await response.body?.cancel(); await delay(seconds * 1000 + 100);
    response = await send(); // Same immutable command and operation identity.
  }
  assert.equal(response.status, status, `${key} ${path}: HTTP ${response.status}`);
  const data = await response.json();
  return { response, data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
async function catalogueCapabilities(key) {
  const publicManifest = (await api(key, '/.well-known/thingtime-capabilities.json')).data;
  const routeResponse = await api(key, '/api/v1/capabilities'), routeManifest = routeResponse.data;
  // The public discovery envelope carries origin. The canonical route
  // manifest instead carries ok/schemaVersion/dataEnvironment; bind that
  // response to the selected URL and verify its own contract independently.
  assert.equal(publicManifest.origin, origin(key));
  assert.equal(routeResponse.response.url, origin(key) + '/api/v1/capabilities');
  assert.equal(routeManifest.ok, true); assert.equal(routeManifest.schemaVersion, 1);
  assert.deepEqual(routeManifest.dataEnvironment, getDeploymentDataEnvironment({ THINGTIME_DATA_ENV: 'development' }));
  for (const [feature, required] of [['api.themes-sync', '1.8.0'], ['api.algorithms-sync', '1.6.0'], ['api.themes', '1.3.0'], ['api.algorithms', '1.2.0'], ['api.things-import', '1.14.0']]) {
    assert.ok(capabilitySatisfies(publicManifest.features[feature]?.version, required), `${key} public ${feature} ${required}`);
    assert.ok(capabilitySatisfies(routeManifest.features[feature], required), `${key} routes ${feature} ${required}`);
  }
}
async function catalogue(key, domain, account) {
  const response = await fetch(origin(key) + `/api/v1/${domain}/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin(key), Cookie: account.cookie,
      'X-Thingtime-Expected-Data-Plane': 'home' },
    body: JSON.stringify({ operation: 'catalogue', expectedOwnerId: account.data.user.id }),
    redirect: 'manual', signal: AbortSignal.timeout(60_000)
  });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^application\/x-ndjson/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const entries = []; let completion;
  const receipt = await readCatalogueStream(response.body, { domain, origin: origin(key), ownerId: account.data.user.id,
    dataPlane: 'home', storagePlane: 'home' }, {
    entry: async (id, value) => { entries.push({ id, value }); },
    complete: async value => { completion = value; }
  });
  assert.deepEqual(completion, receipt, 'Only canonical integrity validation plus clean EOF admits a catalogue.');
  assert.equal(receipt.entries, entries.length);
  assert.deepEqual(entries.map(entry => entry.id), [...new Set(entries.map(entry => entry.id))].sort());
  return { receipt, entries };
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
  // Negotiate the selected origins before any catalogue-dependent work.
  await catalogueCapabilities('owner'); await catalogueCapabilities('follower');
  // A branch's anonymous renderer must keep its own exact assets and restrictive
  // headers even when account API traffic is forwarded to an environment owner.
  for (const file of ['index.html', 'runner.js']) {
    const response = await fetch(origin('follower') + '/draft-preview/' + file, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-security-policy'), draftPreviewCsp);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(cwd, 'dist/draft-preview', file)),
      'The follower must serve its built renderer bytes, not a gateway response or SPA fallback.');
  }
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(origin('follower') + '/social-card', { method, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/png/);
    const body = Buffer.from(await response.arrayBuffer());
    if (method === 'GET') assert.equal(body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    else assert.equal(body.length, 0);
  }
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
  const syncHeaders = { 'X-Thingtime-Expected-Data-Plane': 'home' }, expectedCatalogues = { themes: new Map(), algorithms: new Map() };
  const syncWrite = async (domain, command) => {
    const result = await api('follower', `/api/v1/${domain}/sync`, { cookie: account.cookie, headers: syncHeaders, retryRateLimit: true,
      body: { operation: 'write', expectedOwnerId: account.data.user.id, command } });
    assert.equal(result.data.acknowledgment.id, command.id); assert.equal(result.data.acknowledgment.writeId, command.writeId);
    assert.ok(result.data.acknowledgment.resultVersion);
    return result.data.acknowledgment;
  };
  // Both catalogues exceed the former creation ceilings and cross a 64-row
  // processing page. All product writes use canonical authenticated APIs.
  for (let index = 0; index < 105; index++) {
    const command = { action: 'save', id: randomUUID(), writeId: randomUUID(), expectedVersion: null,
      name: `Gateway catalogue theme ${String(index).padStart(3, '0')}`, theme: { colors: { accent: '#123456', focusBorder: '#26724d' }, general: { focusGlowBlur: 20, focusGlowOpacity: 0.4 } }, visibility: 'private' };
    const acknowledgment = await syncWrite('themes', command);
    if (index === 104) assert.deepEqual(await syncWrite('themes', command), acknowledgment, 'Exact theme retry above old count ceiling replays its receipt.');
    expectedCatalogues.themes.set(command.id, { name: command.name, version: acknowledgment.resultVersion });
  }
  for (let index = 0; index < 65; index++) {
    const command = { action: 'save', id: randomUUID(), writeId: randomUUID(), expectedVersion: null,
      description: 'Disposable gateway catalogue fixture', content: { name: `Gateway algorithm ${index}`, emoji: '🧠',
        weights: { types: { text: 0.5 }, tags: { gateway: 2 }, authors: {} }, eventCount: index, lastTrainedAt: null } };
    const acknowledgment = await syncWrite('algorithms', command);
    if (index === 64) assert.deepEqual(await syncWrite('algorithms', command), acknowledgment, 'Exact algorithm retry above old count ceiling replays its receipt.');
    expectedCatalogues.algorithms.set(command.id, { content: command.content, version: acknowledgment.resultVersion });
  }
  const catalogueEvidence = { themes: {}, algorithms: {}, realReplica: true, canonicalReaderIntegrity: true,
    themeRowsCrossPageBoundary: true, legacyPrecedenceLive: false, concurrentMutationPinningLive: false };
  for (const key of ['owner', 'follower']) for (const domain of ['themes', 'algorithms']) {
    const body = { operation: 'catalogue', expectedOwnerId: account.data.user.id };
    await api(key, `/api/v1/${domain}/sync`, { headers: syncHeaders, body, status: 401 });
    await api(key, `/api/v1/${domain}/sync`, { cookie: account.cookie, headers: {
      ...syncHeaders, Origin: 'https://cross-site.invalid', 'Sec-Fetch-Site': 'cross-site' }, body, status: 403 });
    await api(key, `/api/v1/${domain}/sync`, { cookie: account.cookie, headers: syncHeaders,
      body: { ...body, expectedOwnerId: 'different-disposable-owner' }, status: 409 });
    const observed = await catalogue(key, domain, account), expected = expectedCatalogues[domain];
    assert.deepEqual(observed.entries.map(entry => entry.id), [...expected.keys()].sort());
    for (const { id, value } of observed.entries) {
      assert.equal(value.id, id); assert.equal(value.version, expected.get(id).version);
      if (domain === 'themes') {
        assert.equal(value.name, expected.get(id).name); assert.equal(value.visibility, 'private');
        assert.equal(value.theme.colors.accent, '#123456');
        assert.equal(value.theme.colors.focusBorder, '#26724d'); assert.equal(value.theme.general.focusGlowBlur, 20); assert.equal(value.theme.general.focusGlowOpacity, 0.4);
      } else {
        assert.deepEqual(value.content, expected.get(id).content); assert.equal(value.shared, false); assert.equal(value.listed, false);
      }
    }
    catalogueEvidence[domain][key] = { entries: observed.receipt.entries, authenticated: true, anonymousRefused: true,
      crossSiteRefused: true, wrongOwnerRefused: true, sortedExactIds: true, exactPersistedVersion: true };
  }
  // Normal creates/branches must use the same uncapped-count writers too.
  const normalTheme = await api('follower', '/api/v1/themes', { cookie: account.cookie,
    body: { name: 'Beyond old theme ceiling', theme: {}, visibility: 'private' } });
  const normalAlgorithm = await api('follower', '/api/v1/algorithms', { cookie: account.cookie,
    body: { name: 'Beyond old algorithm ceiling', branchFrom: [...expectedCatalogues.algorithms.keys()][0] } });
  assert.ok(normalTheme.data.theme.id); assert.ok(normalAlgorithm.data.algorithm.id);
  const pagedEvidence = {};
  for (const key of ['owner', 'follower']) for (const domain of ['themes', 'algorithms']) {
    const expectedIds = new Set([...expectedCatalogues[domain].keys(), domain === 'themes' ? normalTheme.data.theme.id : normalAlgorithm.data.algorithm.id]);
    const rows = [], cursors = new Set(); let cursor = null, pages = 0;
    do {
      const query = '?page=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const result = await api(key, `/api/v1/${domain}${query}`, { cookie: account.cookie });
      assert.ok(result.data[domain].length <= 64); rows.push(...result.data[domain]); pages++;
      cursor = result.data.nextCursor;
      assert.ok(cursor === null || typeof cursor === 'string');
      if (cursor) { assert.ok(!cursors.has(cursor)); cursors.add(cursor); }
    } while (cursor);
    assert.equal(rows.length, expectedIds.size); assert.deepEqual(new Set(rows.map(row => row.id)), expectedIds);
    assert.ok(pages > 1); await api(key, `/api/v1/${domain}?page=1`, { status: 401 });
    await api(key, `/api/v1/${domain}?page=1&cursor=invalid`, { cookie: account.cookie, status: 400 });
    const legacy = await api(key, `/api/v1/${domain}`, { cookie: account.cookie });
    assert.equal(legacy.data[domain].length, domain === 'themes' ? 100 : 50);
    pagedEvidence[domain + ':' + key] = { entries: rows.length, pages, exactIds: true, legacyBoundRetained: true, malformedCursorRefused: true, anonymousRefused: true };
  }
  catalogueEvidence.ownedPagination = pagedEvidence;
  catalogueEvidence.canonicalCreatesBeyondOldCeilings = true;
  catalogueEvidence.exactSyncRetriesBeyondOldCeilings = true;
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
  console.log(JSON.stringify({ ok: true, transport: 'built-nitro', draftPreviewExactAssets: true, draftPreviewCsp: true, socialCardPngAndHead: true, viteRootDocs: true, registration: true, authCookies: true, crossSiteRefused: true, writes: true, dedicatedOwnHandler: true, dedicatedShellMetadata: true, independentDedicatedDatabase: true, dedicatedIndexCommands: dedicatedIndex, promotion: true, rollback: true, followerMongoDials: followerDials,
    initializedIndexCommands: initialized, unchangedColdIndexCommands: unchanged, catalogue: catalogueEvidence }));
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
  await Promise.all(children.filter(child => child.exitCode === null && child.signalCode === null).map(child => Promise.race([once(child, 'exit'), delay(3000)])));
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  alias.closeAllConnections(); await new Promise(resolve => alias.close(resolve)); await new Promise(resolve => trap.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
