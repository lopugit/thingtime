/** Disposable compiled-Nitro acceptance. Called only by the isolated launcher. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { realpath, stat } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const directory = process.env.THINGTIME_SYNC_CONTROL_TEST_DIRECTORY;
assert.ok(directory && basename(directory).startsWith('thingtime-sync-control-'));
assert.equal(dirname(await realpath(directory)), await realpath(tmpdir()));
assert.equal((await stat(directory)).mode & 0o077, 0);
assert.equal(process.env.MONGODB_CONNECTION_STRING, 'mongodb://127.0.0.1:28179/thingtime?replicaSet=sync-control-fixture');
const base = 'http://127.0.0.1:28180';
const application = await import(pathToFileURL(process.env.THINGTIME_SYNC_CONTROL_BUNDLE).href);
assert.equal(typeof application.middleware, 'function', 'Use the actual compiled Nitro node_middleware bundle');
const server = createServer((request, response) => application.middleware(request, response));
server.listen(28180, '127.0.0.1');
await once(server, 'listening');
async function request(path, body, viewer) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', ...(viewer ? { Cookie: viewer.cookie, 'X-Thingtime-Expected-Actor': viewer.id } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert.match(response.headers.get('Content-Type') ?? '', /application\/json/, path + ' must dispatch Nitro JSON, not the SPA');
  const value = await response.json();
  return { response, value };
}
async function register() {
  const { response, value } = await request('/api/v1/auth/register', { username: 'sync-' + randomUUID().slice(0, 8),
    email: randomUUID() + '@example.invalid', password: randomUUID() + '-Fixture!' });
  assert.equal(response.status, 200, 'Disposable account registration: ' + JSON.stringify(value));
  return { id: value.user.id, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
async function pair(viewer) {
  const { value: challenge, response } = await request('/api/v1/devices/pairing', {}, viewer);
  assert.equal(response.status, 200, JSON.stringify(challenge));
  const { privateKey, publicKey: key } = generateKeyPairSync('ed25519');
  const publicKey = key.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url'), credential = 'ttnode_' + randomBytes(32).toString('base64url');
  const { value: prepared } = await request('/api/v1/devices/pairing/claim', { op: 'prepare', pairingSecret: challenge.pairing.pairingSecret, publicKey, nonce });
  const { pairingId, serverNonce } = prepared.proof;
  const device = { name: 'Disposable sync test', platform: 'macos', model: 'Test', osVersion: 'test', appVersion: '1.0.0' };
  const fields = ['thingtime-device-pairing-claim-v1', pairingId, challenge.pairing.pairingSecret, credential, publicKey, nonce,
    serverNonce, device.name, device.platform, device.model, device.osVersion, device.appVersion, '0'];
  const bytes = Buffer.concat(fields.map(value => { const data = Buffer.from(value, 'utf8'); return Buffer.concat([Buffer.from(data.length + ':'), data]); }));
  const claimed = await request('/api/v1/devices/pairing/claim', { op: 'complete', pairingSecret: challenge.pairing.pairingSecret,
    credential, device, capabilities: [], proof: { pairingId, publicKey, nonce, serverNonce, signature: sign(null, bytes, privateKey).toString('base64url') } });
  assert.equal(claimed.response.status, 200, JSON.stringify(claimed.value));
  return claimed.value.device.id;
}
try {
  const endpoint = '/api/v1/devices/sync-control';
  const publicManifest = await request('/.well-known/thingtime-capabilities.json');
  assert.equal(publicManifest.value.features['api.devices-sync-control'].version, '1.1.0');
  assert.equal((await request('/api/v1/capabilities')).value.features['api.devices-sync-control'], '1.1.0');
  assert.equal((await request(endpoint + '-docs')).value.docs.id, 'devices-sync-control');
  assert.equal((await request(endpoint, { action: 'poll', deviceId: 'device' })).response.status, 401);
  const owner = await register(), foreign = await register(), deviceId = await pair(owner);
  const post = (body, viewer = owner) => request(endpoint, { deviceId, ...body }, viewer);
  const requestId = randomUUID();
  assert.equal((await post({ action: 'enqueue', requestId, command: { action: 'status' } })).value.status, 'pending');
  const query = endpoint + '?' + new URLSearchParams({ deviceId, requestId });
  assert.equal((await request(query, undefined, foreign)).response.status, 404);
  const claimResults = await Promise.all(Array.from({ length: 8 }, () => post({ action: 'poll' })));
  assert.ok(claimResults.every(result => result.response.status === 200));
  const claims = claimResults.flatMap(result => result.value.command ? [result.value.command] : []);
  assert.equal(claims.length, 1, 'Real Mongo atomic claim must dispatch exactly once');
  assert.equal((await post({ action: 'complete', requestId, leaseId: 'wrong', result: {} })).response.status, 409);
  assert.equal((await post({ action: 'complete', requestId, leaseId: claims[0].leaseId, result: { version: 1, roots: [] } })).value.status, 'complete');
  const complete = await request(query, undefined, owner);
  assert.deepEqual(complete.value.result, { version: 1, roots: [] });
  assert.equal(complete.response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await post({ action: 'enqueue', requestId, command: { action: 'status' } })).value.status, 'complete');
  assert.equal((await post({ action: 'enqueue', requestId, command: { action: 'pause', connectionId: 'changed' } })).response.status, 409);
  const queued = await Promise.all(Array.from({ length: 24 }, () => post({ action: 'enqueue', requestId: randomUUID(), command: { action: 'status' } })));
  assert.equal(queued.filter(result => result.response.status === 200).length, 16, 'Real transactions serialize queue backpressure');
  assert.equal(queued.filter(result => result.response.status === 429).length, 8);
  const generic = await request('/api/v1/things', { thingtime: ['device-sync-control'], crystal: { status: 'complete' }, acl: ['tt:user'] }, owner);
  assert.equal(generic.response.status, 403, 'Generic Things cannot mint worker delivery records');
  assert.equal((await request('/api/v1/devices/disconnect', { deviceId }, owner)).response.status, 200);
  assert.equal((await post({ action: 'poll' })).response.status, 404);
  assert.equal((await request(query, undefined, owner)).response.status, 404);
  console.log('DEVICE_SYNC_CONTROL_COMPILED_AND_REPLICA_OK');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
}
process.exit(0);
