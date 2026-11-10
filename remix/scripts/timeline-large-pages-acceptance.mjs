#!/usr/bin/env node
// Built HTTP handler + real disposable replica set. Application fixtures use
// supported APIs only; Mongo is used solely to initiate/observe the replica.
// No inherited account, vault, application configuration or test profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-large-page-'));
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const availablePort = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
const ports = { db: await availablePort(), api: await availablePort() };
const origin = `http://127.0.0.1:${ports.api}`;
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, TMPDIR: dir,
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(ports.api),
  MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=largepages`,
  JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development' };
function start(command, args) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: 'ignore' }); children.push(child); return child;
}
async function waitFor(read, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await read()) return; await delay(200); }
  throw Error(`Timed out: ${label}`);
}
async function api(path, { cookie, token, body, method = body === undefined ? 'GET' : 'POST', status = 200 } = {}) {
  const start = performance.now();
  const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = null; }
  assert.equal(response.status, status, `${method} ${path.split('?')[0]} unexpected status${typeof data?.error === 'string' ? `: ${data.error}` : ''}`);
  return { data, ms: Math.round((performance.now() - start) * 100) / 100, bytes: Buffer.byteLength(text),
    cache: response.headers.get('cache-control'), cookie: (response.headers.getSetCookie?.() || []).map(value => value.split(';')[0]).join('; ') };
}
const register = () => api('/api/v1/auth/register', { body: { username: 'largepage' + randomBytes(6).toString('hex'),
  email: `largepage${randomUUID()}@example.invalid`, password: randomBytes(32).toString('hex') } });
let client;
try {
  await mkdir(join(dir, 'db'));
  start(process.env.MONGOD_PATH || 'mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'largepages', '--nounixsocket']);
  client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => { try { await client.connect(); return true; } catch { return false; } }, 'disposable Mongo startup');
  await client.db('admin').command({ replSetInitiate: { _id: 'largepages', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
  await waitFor(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
  await client.close(); client = null;
  const server = start(process.execPath, [process.env.LARGE_PAGE_SERVER_ENTRY || '.output/server/index.mjs']);
  await waitFor(async () => { assert.equal(server.exitCode, null, 'Disposable Nitro exited');
    try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
  }, 'built Nitro HTTP server');
  const manifest = (await api('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin, origin);
  if (process.env.EXPECT_LARGE_PAGE_FAILURE !== '1') for (const [feature, version] of Object.entries({ 'api.things': '1.49.2', 'api.things-update': '1.18.1', 'api.timeline': '1.19.1' })) assert.equal(manifest.features[feature].version, version);
  const owner = await register(), other = await register(); assert(owner.cookie && other.cookie);
  const component = (label) => ({ name: label, componentKey: label, version: 1, args: [], render: { tag: 'p', children: 'Synthetic component' } });
  const ownComponent = (await api('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['component'], crystal: component('synthetic-owned'), visibility: 'private' } })).data.thing;
  const foreignComponent = (await api('/api/v1/things', { cookie: other.cookie, body: { thingtime: ['component'], crystal: component('synthetic-foreign'), visibility: 'private' } })).data.thing;
  const original = { name: 'Synthetic editable page', version: 1, blocks: [{ id: 'initial', type: 'text', text: 'Initial' }] };
  const created = await api('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['webpage'], crystal: original, visibility: 'private' } });
  assert.equal(created.data.ok, true); const page = created.data.thing;
  const blocks = Array.from({ length: 1400 }, (_, index) => ({ id: `synthetic-${index}`, type: 'text', text: `Synthetic row ${index}` }));
  blocks.push({ id: 'owned-slot', type: 'component', component: ownComponent.id }, { id: 'foreign-slot', type: 'component', component: foreignComponent.id });
  const status = process.env.EXPECT_LARGE_PAGE_FAILURE === '1' ? 500 : 200;
  const updated = await api('/api/v1/things/update', { cookie: owner.cookie, status, body: { id: page.id, expectedUpdatedAt: page.updatedAt, crystal: { ...original, version: 2, blocks } } });
  const readback = (await api(`/api/v1/things?id=${encodeURIComponent(page.id)}`, { cookie: owner.cookie })).data.thing;
  if (status === 500) {
    assert.equal(readback.updatedAt, page.updatedAt); assert.equal(readback.crystal.version, 1);
    console.log(JSON.stringify({ reproduced: true, status, persistedVersion: readback.crystal.version, blocksAttempted: blocks.length, productionDataUsed: false }));
  } else {
    assert.equal(updated.data.ok, true); assert.equal(readback.crystal.blocks.length, blocks.length); assert.equal(readback.crystal.version, 2);
    assert.deepEqual(readback.crystal.blocks.map(block => block.id), blocks.map(block => block.id));
    const scope = `ownerId=${owner.data.user.id}&dataPlane=home`;
    const history = (await api(`/api/v1/timeline?${scope}&thingId=${page.id}`, { cookie: owner.cookie })).data.entries;
    const event = history[0].event; assert.equal(event.dependencies.length, 2);
    const captures = (await api(`/api/v1/timeline?${scope}&eventId=${event.id}&components=1`, { cookie: owner.cookie })).data.entries;
    assert(captures.find(entry => entry.event.after.value.ref === ownComponent.id).event.after.value.component);
    assert.equal(captures.find(entry => entry.event.after.value.ref === foreignComponent.id).event.after.value.component, null);
    let deep = [{ id: 'deep-text', type: 'text', text: 'Deep synthetic row' }, { id: 'deep-slot', type: 'component', component: ownComponent.id }];
    for (let index = 0; index < 30; index++) deep = [{ id: `deep-${index}`, type: 'container', direction: 'column', children: deep }];
    const nested = await api('/api/v1/things/update', { cookie: owner.cookie, body: { id: page.id, expectedUpdatedAt: readback.updatedAt, crystal: { ...original, version: 3, blocks: deep } } });
    assert.equal(nested.data.ok, true);
    const final = (await api(`/api/v1/things?id=${encodeURIComponent(page.id)}`, { cookie: owner.cookie })).data.thing;
    assert.deepEqual(final.crystal.blocks, nested.data.thing.crystal.blocks); assert.equal(final.crystal.version, 3);
    const preview = await api(`/api/v1/timeline?${scope}`, { cookie: owner.cookie, body: { command: 'preview-version', mode: 'restore', eventId: event.id, choices: {}, componentMode: 'recorded', componentChoices: {} } });
    assert.equal(preview.data.ok, true);
    console.log(JSON.stringify({ ok: true, blocks: blocks.length, nesting: 30, realApi: true, disposableReplica: true }));
  }
} finally {
  await client?.close().catch(() => {});
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
    await Promise.race([once(child, 'exit'), delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  }));
  await rm(dir, { recursive: true, force: true });
}
