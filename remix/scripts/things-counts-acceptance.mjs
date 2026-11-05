#!/usr/bin/env node
// Built HTTP handler + real disposable replica set. Application fixtures use
// supported APIs only; Mongo is used solely to initiate/observe the replica.
// No inherited account, vault, application configuration or test profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-things-counts-'));
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
  MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=thingscounts`,
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
const register = () => api('/api/v1/auth/register', { body: { username: 'count' + randomBytes(6).toString('hex'),
  email: `count${randomUUID()}@example.invalid`, password: randomBytes(32).toString('hex') } });
let client;
try {
  await mkdir(join(dir, 'db'));
  start(process.env.MONGOD_PATH || 'mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'thingscounts', '--nounixsocket']);
  client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => { try { await client.connect(); return true; } catch { return false; } }, 'disposable Mongo startup');
  await client.db('admin').command({ replSetInitiate: { _id: 'thingscounts', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
  await waitFor(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
  await client.close(); client = null;
  let server = start(process.execPath, [process.env.THINGS_COUNT_SERVER_ENTRY || '.output/server/index.mjs']);
  await waitFor(async () => { assert.equal(server.exitCode, null, 'Disposable Nitro exited');
    try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
  }, 'built Nitro HTTP server');
  const restartServer = async () => {
    const exited = once(server, 'exit');
    process.kill(-server.pid, 'SIGTERM'); await Promise.race([exited, delay(3000)]);
    if (server.exitCode === null && server.signalCode === null) { process.kill(-server.pid, 'SIGKILL'); await exited; }
    server = start(process.execPath, [process.env.THINGS_COUNT_SERVER_ENTRY || '.output/server/index.mjs']);
    await waitFor(async () => {
      assert.equal(server.exitCode, null, 'Disposable Nitro exited');
      try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
    }, 'restarted built Nitro HTTP server');
  };
  const manifest = (await api('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin, origin); assert.equal(manifest.features['api.things'].version, '1.49.2');
  const owner = await register(), other = await register();
  assert(owner.cookie && other.cookie, 'Separate API-created accounts must have authenticated sessions');
  const schema = await api('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['schema'], acl: ['tt:all'], crystal: { name: 'Synthetic count schema', fields: [] } } });
  const schemaId = schema.data.thing.id, parentId = randomUUID();
  const query = new URLSearchParams({ thingtime: 'data', schemaId, parentId, excludeArchived: 'true' });
  const list = '/api/v1/things?' + query;
  const fixtures = Array.from({ length: 120 }, (_, index) => ({ id: `fixture-${index}`, thingtime: ['data'],
    crystal: { schemaId, parentId, rank: index, archived: index >= 113, note: 'x'.repeat(4096), detail: 'x'.repeat(4096) } }));
  // Supported import avoids hitting the normal per-minute interactive-write
  // bucket while keeping all fixture validation and accounting in the API.
  const imported = await api('/api/v1/things/import', { cookie: owner.cookie, body: {
    manifest: { format: 'thingtime.transfer', version: 1, roots: fixtures.map(row => row.id), things: fixtures, files: [] }
  } });
  assert.equal(imported.data.imported, 120);
  for (let index = 0; index < 20; index++) await api('/api/v1/things', { cookie: owner.cookie, method: 'PATCH',
    body: { id: imported.data.ids[`fixture-${index}`], acl: ['tt:all'] } });
  const otherPrivate = await api('/api/v1/things', { cookie: other.cookie, body: { thingtime: ['data'], acl: ['tt:user'], crystal: { schemaId, parentId } } });
  await api('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['data'], crystal: { schemaId, parentId: randomUUID() } } });
  await restartServer();
  const counted = await api(list + '&count=true', { cookie: owner.cookie });
  const warmCount = await api(list + '&count=true', { cookie: owner.cookie });
  assert.deepEqual(warmCount.data, counted.data);
  assert.deepEqual(counted.data, { ok: true, count: 113 }); assert.match(counted.cache, /no-store/);
  assert.equal((await api(list + '&count=true', { cookie: other.cookie })).data.count, 1);
  assert.equal((await api(list + '&count=true&appId=not-this-namespace', { cookie: owner.cookie })).data.count, 0);
  assert.equal((await api(list.replace('excludeArchived=true', 'excludeArchived=false') + '&count=true', { cookie: owner.cookie })).data.count, 120);
  await api(list + '&count=true', { status: 401 });
  for (const extra of ['&limit=10', '&cursor=anything', '&offset=0', '&count=true', '&id=private', '&q=anything'])
    await api(list + '&count=true' + extra, { cookie: owner.cookie, status: 400 });
  for (const extra of ['&offset=-1', '&offset=1.5', '&offset=0&cursor=x', '&offset=0&offset=1'])
    await api(list + extra, { cookie: owner.cookie, status: 400 });
  for (const [visibility, expected] of [['public', 20], ['private', 93]]) {
    const minted = await api('/api/v1/tokens', { cookie: owner.cookie, body: { name: `Synthetic ${visibility} count`, scopes: ['things.read'], visibility }, status: 201 });
    assert(minted.data.token, 'Scoped PAT must be created through the API');
    assert.equal((await api(list + '&count=true', { token: minted.data.token })).data.count, expected);
    const tokenIds = [imported.data.ids['fixture-21'], imported.data.ids['fixture-0'], otherPrivate.data.thing.id];
    const tokenBatch = await api('/api/v1/things?ids=' + encodeURIComponent(JSON.stringify(tokenIds)), { token: minted.data.token });
    assert.deepEqual(tokenBatch.data.things.map(row => row?.id ?? null), visibility === 'public' ? [null, tokenIds[1], null] : [tokenIds[0], null, null]);
  }
  const ownPrivateId = imported.data.ids['fixture-21'], publicId = imported.data.ids['fixture-0'];
  const orderedBatchIds = [ownPrivateId, otherPrivate.data.thing.id, randomUUID(), publicId, publicId];
  const batch = await api('/api/v1/things?ids=' + encodeURIComponent(JSON.stringify(orderedBatchIds)), { cookie: owner.cookie });
  assert.deepEqual(batch.data.things.map(row => row?.id ?? null), [ownPrivateId, null, null, publicId, publicId]);
  const canonicalSingle = (await api('/api/v1/things?id=' + ownPrivateId, { cookie: owner.cookie })).data.thing;
  delete canonicalSingle.attachments; // Batch returns direct bodies without discussion hydration.
  assert.deepEqual(batch.data.things[0], canonicalSingle);
  assert.match(batch.cache, /no-store/);
  assert.deepEqual((await api('/api/v1/things?ids=%5B%5D', { cookie: owner.cookie })).data, { ok: true, things: [] });
  await api('/api/v1/things?ids=%5B%5D', { status: 401 });
  for (const extra of ['&id=anything', '&schemaId=anything', '&count=true', '&ids=[]'])
    await api('/api/v1/things?ids=%5B%5D' + extra, { cookie: owner.cookie, status: 400 });
  for (const invalid of ['{}', '[1]', '["a.b"]', 'not-json'])
    await api('/api/v1/things?ids=' + encodeURIComponent(invalid), { cookie: owner.cookie, status: 400 });
  const joinIds = Array.from({ length: 25 }, (_, index) => imported.data.ids[`fixture-${index}`]);
  const serialJoin = { requests: 0, ms: 0, bytes: 0 };
  for (const id of joinIds) {
    const read = await api('/api/v1/things?id=' + id, { cookie: owner.cookie });
    serialJoin.requests++; serialJoin.ms += read.ms; serialJoin.bytes += read.bytes;
  }
  const batchedJoin = await api('/api/v1/things?ids=' + encodeURIComponent(JSON.stringify(joinIds)), { cookie: owner.cookie });
  assert.deepEqual(batchedJoin.data.things.map(row => row?.id), joinIds);
  const baseline = { requests: 0, ms: 0, bytes: 0, ids: [] };
  let cursor = null;
  do {
    const page = await api(list + '&limit=50' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), { cookie: owner.cookie });
    baseline.requests++; baseline.ms += page.ms; baseline.bytes += page.bytes; baseline.ids.push(...page.data.things.map(row => row.id)); cursor = page.data.nextCursor;
  } while (cursor);
  assert.equal(baseline.ids.length, counted.data.count);
  await restartServer();
  const distant = await api(list + '&offset=80&limit=20', { cookie: owner.cookie });
  const warmDistant = await api(list + '&offset=80&limit=20', { cookie: owner.cookie });
  assert.deepEqual(warmDistant.data.things.map(row => row.id), distant.data.things.map(row => row.id));
  assert.deepEqual(distant.data.things.map(row => row.id), baseline.ids.slice(80, 100));
  assert.equal(distant.data.offset, 80); assert.equal(distant.data.nextOffset, 100);
  const end = await api(list + '&offset=110&limit=20', { cookie: owner.cookie });
  assert.deepEqual(end.data.things.map(row => row.id), baseline.ids.slice(110)); assert.equal(end.data.nextOffset, null);
  const empty = await api(list + '&offset=120&limit=20', { cookie: owner.cookie });
  assert.deepEqual(empty.data.things, []); assert.equal(empty.data.nextOffset, null);
  const summary = await api(list + '&maxCrystalField=rank', { cookie: owner.cookie }); assert.equal(summary.data.summary.max, 112);
  const report = { ok: true, fixtures: { ownerRows: 120, unarchived: 113, otherOwnerRows: 1 },
    checks: ['built origin-scoped 1.49 manifest', 'exact filtered count and independent account privacy', 'public/private PAT visibility',
      'archive/schema/parent/namespace filters', 'invalid count/offset refusal', 'visible ordinal page equals canonical cursor traversal', 'numeric summary compatibility', 'ordered exact-ID joins preserve duplicates and collapse missing/private positions'],
    performance: { serialExactJoin: serialJoin, batchedExactJoin: { requests: 1, ms: batchedJoin.ms, bytes: batchedJoin.bytes }, baselineFullProjection: { requests: baseline.requests, ms: baseline.ms, bytes: baseline.bytes },
      count: { requests: 1, firstAfterServerRestartMs: counted.ms, repeatMs: warmCount.ms, bytes: counted.bytes }, distantPage: { requests: 1, firstAfterServerRestartMs: distant.ms, repeatMs: warmDistant.ms, bytes: distant.bytes } },
    limitations: ['Cold observations restart the API process; they do not evict operating-system or MongoDB caches. Synthetic measurements are not a production latency benchmark.', 'Offset and exact counts observe current authorization; they do not reserve a transaction snapshot.', 'The existing data writer limits each string field to 5000 characters; synthetic 8 KiB payloads use two 4096-character fields. This read/count check does not establish unlimited data writes.'] };
  if (process.env.THINGS_COUNT_REPORT) await writeFile(process.env.THINGS_COUNT_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
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
