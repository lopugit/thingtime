/** Disposable compiled-Nitro acceptance. Called only by the isolated launcher. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { realpath, stat } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const originalLog = console.log;
console.log = (...args) => { if (!String(args[0]).startsWith('[email][console]')) originalLog(...args); };
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
async function request(path, body, viewer, method) {
  const response = await fetch(base + path, { method: method || (body === undefined ? 'GET' : 'POST'),
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
 const endpoint = '/api/v1/devices/folders';
 const { value: manifest } = await request('/.well-known/thingtime-capabilities.json');
 assert.equal(manifest.features['api.devices-folders'].version, '1.0.0');
 assert.equal(manifest.features['api.devices'].version, '1.16.0');
 assert.equal((await request(endpoint)).response.status, 401);
 const owner = await register(), foreign = await register(), deviceId = await pair(owner);
 const inspect = endpoint + '?' + new URLSearchParams({ deviceId });
 const initial = await request(inspect, undefined, owner);
 assert.equal(initial.response.status, 200); assert.equal(initial.value.folder, null);
 const rootId = initial.value.rootFolderId;
 const listing = (await request(endpoint, undefined, owner)).value;
 assert(listing.devices.some(device => device.deviceId === deviceId && device.rootFolderId === rootId));
 assert.equal(listing.nextCursor, null);
 assert.equal((await request(endpoint + '?cursor=invalid', undefined, owner)).response.status, 400);
 assert.equal((await request(inspect, undefined, foreign)).response.status, 404);
 assert.equal((await request(endpoint, { deviceId }, foreign)).response.status, 404);
 const connectionId = randomUUID(), payload = { deviceId, connectionId, name: 'Photo Library' };
 const [a,b] = await Promise.all([request(endpoint, payload, owner), request(endpoint, payload, owner)]);
 assert.equal(a.response.status, 200, JSON.stringify(a.value)); assert.equal(b.response.status, 200, JSON.stringify(b.value));
 assert.equal(a.value.folder.id, b.value.folder.id); assert.equal(a.value.rootFolderId, rootId);
 assert.equal(a.value.folder.path, 'Disposable sync test / Files / Photo Library');
 const root = (await request('/api/v1/things?id=' + rootId, undefined, owner)).value.thing;
 const leaf = (await request('/api/v1/things?id=' + a.value.folder.id, undefined, owner)).value.thing;
 assert.deepEqual(root.thingtime, ['folder']); assert.deepEqual(root.acl, ['tt:user']); assert.equal(root.author.id, owner.id);
 const parent = (await request('/api/v1/things?id=' + leaf.folderId, undefined, owner)).value.thing;
 assert.equal(parent.folderId, rootId); assert.equal(parent.crystal.name, 'Files');
 assert.equal((await request('/api/v1/things?id=' + rootId, undefined, foreign)).response.status, 404);
 const again = await request(endpoint, { ...payload, name: 'Different connection label' }, owner);
 assert.equal(again.value.folder.id, leaf.id); assert.equal(again.value.folder.name, 'Photo Library');
 const reference = await request(inspect, undefined, owner);
 assert.equal(reference.value.folder.id, rootId); assert.equal(reference.response.headers.get('Cache-Control'), 'private, no-store');
 assert.equal((await request('/api/v1/devices?id=' + deviceId, undefined, owner)).value.device.rootFolderId, rootId);
 const other = await request(endpoint, { ...payload, connectionId: randomUUID() }, owner);
 assert.notEqual(other.value.folder.id, leaf.id); assert.equal(other.value.rootFolderId, rootId);
 for (const connectionId of [null, 0, 1, '', {}, []]) {
  const malformed = await request(endpoint, { ...payload, connectionId }, owner);
  assert.equal(malformed.response.status, 400, 'Malformed connection IDs never create folders');
 }
 assert.equal((await request(endpoint, { ...payload, ownerId: foreign.id }, owner)).response.status, 400);
 const mismatch = await fetch(base + endpoint, { method: 'POST', headers: { Cookie: owner.cookie, Origin: base, 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': foreign.id }, body: JSON.stringify(payload) });
 assert.equal(mismatch.status, 409);
 const configuration = { configurationVersion: 1, name: 'Photo Library backup', deviceId, localRootId: randomUUID(), remoteFolderId: leaf.id, sourceKind: 'photos', mode: 'backup', paused: true, propagateDeletes: false, network: 'any', chargingOnly: false, excludedPaths: [] };
 const selected = (await request('/api/v1/things', { shareId: randomUUID(), thingtime: ['file-sync'], acl: ['tt:user'], crystal: configuration }, owner)).value.thing;
 const home = (await request('/api/v1/things', { shareId: randomUUID(), thingtime: ['file-sync'], acl: ['tt:user'], crystal: { ...configuration, name: 'Unrelated paused Home' } }, owner)).value.thing;
 const refused = await request('/api/v1/things', { id: selected.id, crystal: { paused: false }, expectedUpdatedAt: '2020-01-01T00:00:00Z' }, owner, 'PATCH');
 assert.equal(refused.response.status, 409);
 assert.equal((await request('/api/v1/things?id=' + selected.id, undefined, owner)).value.thing.crystal.paused, true);
 const resume = await request('/api/v1/things', { id: selected.id, crystal: { paused: false }, expectedUpdatedAt: selected.updatedAt }, owner, 'PATCH');
 assert.equal(resume.response.status, 200, JSON.stringify(resume.value));
 const verified = (await request('/api/v1/things?id=' + selected.id, undefined, owner)).value.thing;
 assert.equal(verified.updatedAt, resume.value.thing.updatedAt);
 assert.deepEqual(verified.crystal, { ...selected.crystal, paused: false });
 assert.equal((await request('/api/v1/things?id=' + home.id, undefined, owner)).value.thing.crystal.paused, true);
 console.log('DEVICE_FOLDERS_COMPILED_REAL_API_OK');
} finally {
 server.closeAllConnections(); await new Promise(resolve => server.close(() => resolve()));
}
process.exit(0);
