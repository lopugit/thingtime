/** Uses an independently allocated canonical API fixture; never a raw DB write.
 * THINGTIME_DIAGNOSTICS_FIXTURE is its protected account file, not a token. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { canonicalDevicePairingClaimBytes } from '../app/api/utils/devices/deviceAuth';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
const filename = process.env.THINGTIME_DIAGNOSTICS_FIXTURE;
assert.ok(filename, 'Use the protected disposable fixture account handle');
const account = JSON.parse(await readFile(filename, 'utf8'));
assert.match(account.base, /^http:\/\/127\.0\.0\.1:\d+$/);
type Auth = { cookie?: string; bearer?: string; userId?: string };
async function call(path: string, body?: any, auth: Auth = {}, status = 200, method?: string) {
    const response = await fetch(account.base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
        signal: AbortSignal.timeout(30_000), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(auth.cookie ? { Cookie: auth.cookie, Origin: account.base } : {}),
            ...(auth.bearer ? { Authorization: 'Bearer ' + auth.bearer } : {}),
            ...(auth.userId ? { 'X-Thingtime-Expected-Actor': auth.userId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, status, path.split('?')[0] + ' ' + (data.error ?? ''));
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('tt_auth='))?.split(';')[0];
    if (path.includes('/diagnostics')) assert.match(response.headers.get('Cache-Control') ?? '', /private.*no-store/);
    return { data, cookie };
}
const login = await call('/api/v1/login', { username: account.username, password: account.password });
assert.ok(login.cookie);
const owner: Auth = { cookie: login.cookie, userId: account.userId };
assert.equal((await call('/api/v1/auth/me', undefined, owner)).data.user.id, account.userId);
const outsiderName = 'debug-' + randomUUID().slice(0, 8);
const outside = await call('/api/v1/auth/register', { username: outsiderName, email: outsiderName + '@example.invalid', password: randomUUID() + '-Fixture!' });
const other: Auth = { cookie: outside.cookie, userId: outside.data.user.id };
async function pair(auth: Auth) {
    const { pairing } = (await call('/api/v1/devices/pairing', {}, auth)).data;
    const { privateKey, publicKey: key } = generateKeyPairSync('ed25519');
    const publicKey = key.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url'), bearer = 'ttnode_' + randomBytes(32).toString('base64url');
    const { proof } = (await call('/api/v1/devices/pairing/claim', { op: 'prepare', pairingSecret: pairing.pairingSecret, publicKey, nonce })).data;
    const device = { name: 'Diagnostic fixture', platform: 'ios' as const, model: 'Fixture', osVersion: '27.0', appVersion: '1.0.0' }, capabilities: string[] = [];
    const signature = sign(null, canonicalDevicePairingClaimBytes({ ...proof, pairingSecret: pairing.pairingSecret, credential: bearer, publicKey, nonce, device, capabilities }), privateKey).toString('base64url');
    const claimed = (await call('/api/v1/devices/pairing/claim', { op: 'complete', pairingSecret: pairing.pairingSecret, credential: bearer, device, capabilities,
        proof: { pairingId: proof.pairingId, serverNonce: proof.serverNonce, publicKey, nonce, signature } })).data;
    return { bearer, deviceId: claimed.device.id };
}
const manifest = (await call('/.well-known/thingtime-capabilities.json')).data;
for (const feature of ['api.devices-diagnostics', 'api.devices-node-diagnostics']) assert.equal(capabilitySatisfies(manifest.features[feature]?.version, '1.0.0'), true);
assert.equal(manifest.operations.find((value: any) => value.path === '/api/v1/devices/node/diagnostics').methods.join(','), 'POST');
const endpoint = '/api/v1/devices/diagnostics', nodeEndpoint = '/api/v1/devices/node/diagnostics';
const raced = await Promise.all([call(endpoint, { action: 'ensure' }, other), call(endpoint, { action: 'ensure' }, other)]);
assert.equal(raced[0].data.folder.id, raced[1].data.folder.id);
const first = (await call(endpoint, { action: 'ensure' }, owner)).data;
// This script owns this disposable account's diagnostics; a deliberate rerun
// starts from a proven bounded clear rather than assuming an empty history.
const initialWatermark = (await call(endpoint, undefined, owner)).data.throughSequence;
const initialClear = { action: 'clear', requestId: randomUUID(), throughSequence: initialWatermark };
while ((await call(endpoint, initialClear, owner)).data.hasMore) { /* drain this fixed watermark only */ }
const node = await pair(owner), foreign = await pair(other);
await call(endpoint, undefined, { bearer: node.bearer }, 401);
await call(nodeEndpoint, { action: 'status' }, owner, 401);
const status = (await call(nodeEndpoint, { action: 'status' }, node)).data;
assert.equal(status.enabled, true); assert.equal(status.folderId, first.folder.id);
const root = (await call('/api/v1/things?folder=root&limit=100', undefined, owner)).data;
assert.equal(root.things.some((value: any) => value.id === first.folder.id), false);
const folder = (await call('/api/v1/things?id=' + first.folder.id, undefined, owner)).data.thing;
assert.deepEqual(folder.acl, ['tt:user']);
await call('/api/v1/things?id=' + first.folder.id, undefined, {}, 404);
await call('/api/v1/things?id=' + first.folder.id, undefined, other, 404);
await call('/api/v1/things/update', { id: first.folder.id, acl: ['tt:all'] }, owner, 403);
const event = { eventId: randomUUID(), occurredAt: new Date().toISOString(), category: 'sync', level: 'error', code: 'sync.failed', state: 'waiting',
    phase: 'uploading', reason: 'transfer-state', failureOperation: 'parts', retrySource: 'transferBackoff',
    counts: { pendingOriginals: 3, uploadedBytes: 8388608 }, background: { outcome: 'launch-timeout', applicationState: 'background' },
    systemError: { domain: 'NSURLErrorDomain', code: -1009 } };
const sibling = await pair(owner);
const destination = (await call('/api/v1/things', { thingtime: ['folder'], acl: ['tt:user'], crystal: { name: 'Diagnostic scope fixture' } }, owner)).data.thing;
const configuration = (await call('/api/v1/things', { thingtime: ['file-sync'], acl: ['tt:user'], crystal: {
    name: 'Diagnostic scope', deviceId: sibling.deviceId, localRootId: randomUUID(), remoteFolderId: destination.id,
    configurationVersion: 1, sourceKind: 'photos', paused: false, mode: 'backup', propagateDeletes: false, network: 'any', chargingOnly: false, excludedPaths: []
} }, owner)).data.thing;
await call(nodeEndpoint, { action: 'append', events: [{ ...event, configurationId: configuration.id }] }, node, 403);
await call(nodeEndpoint, { action: 'append', events: [{ ...event, configurationId: configuration.id }] }, foreign, 403);
await call(nodeEndpoint, { action: 'append', events: [{ ...event, deviceId: foreign.deviceId }] }, node, 400);
await call(nodeEndpoint, { action: 'append', events: [{ ...event, message: 'never-save-secret' }] }, node, 400);
const used = async () => (await call('/api/v1/auth/me', undefined, owner)).data.user.storageUsedBytes;
const before = await used();
const subscription = (await call('/api/v1/admin/subscriptions?subjectType=user&subjectId=' + account.userId, undefined, owner)).data.subscription;
assert.equal(subscription.overrides?.userStorageBytes ?? null, null, 'Disposable fixture starts without a storage override');
await call('/api/v1/admin/subscriptions', { subjectType: 'user', subjectId: account.userId, tier: subscription.tier,
    tierVersionId: subscription.tierVersionId, overrides: { userStorageBytes: before } }, owner);
try { await call(nodeEndpoint, { action: 'append', events: [event] }, node, 507); assert.equal(await used(), before); }
finally { await call('/api/v1/admin/subscriptions', { subjectType: 'user', subjectId: account.userId, clear: true }, owner); }
const writes = await Promise.all([call(nodeEndpoint, { action: 'append', events: [event] }, node), call(nodeEndpoint, { action: 'append', events: [event] }, node)]);
for (const value of writes) assert.deepEqual(value.data.acknowledgedEventIds, [event.eventId]);
const after = await used(); assert.ok(after > before);
await call(nodeEndpoint, { action: 'append', events: [event] }, node); assert.equal(await used(), after);
await call(nodeEndpoint, { action: 'append', events: [{ ...event, state: 'failed' }] }, node, 409);
let page = (await call(endpoint, undefined, owner)).data;
assert.equal(page.events.length, 1); assert.equal(page.events[0].systemError.code, -1009);
const eventThingId = page.events[0].id;
const saved = (await call('/api/v1/things?id=' + eventThingId, undefined, owner)).data.thing;
assert.deepEqual(saved.crystal.event, event);
const publicPat = (await call('/api/v1/tokens', { name: 'Diagnostic public-read refusal', scopes: ['things'], visibility: 'public' }, owner, 201)).data.token;
const privatePat = (await call('/api/v1/tokens', { name: 'Diagnostic private read', scopes: ['things'], visibility: 'private' }, owner, 201)).data.token;
assert.equal(typeof publicPat, 'string'); assert.equal(typeof privatePat, 'string');
await call('/api/v1/things?id=' + eventThingId, undefined, { bearer: publicPat }, 404);
await call('/api/v1/things?id=' + first.folder.id, undefined, { bearer: publicPat }, 404);
assert.equal((await call('/api/v1/things?id=' + eventThingId, undefined, { bearer: privatePat })).data.thing.id, eventThingId);
assert.equal((await call('/api/v1/things?id=' + first.folder.id, undefined, { bearer: privatePat })).data.thing.id, first.folder.id);
await call('/api/v1/things?id=' + eventThingId, undefined, {}, 404);
await call('/api/v1/things?id=' + eventThingId, undefined, other, 404);
await call('/api/v1/things/update', { id: eventThingId, acl: ['tt:all'] }, owner, 403);
await call('/api/v1/things', { thingtime: ['device-diagnostic'], crystal: event }, owner, 403);
const extra = Array.from({ length: 105 }, () => ({ ...event, eventId: randomUUID(), level: 'info' }));
for (let offset = 0; offset < extra.length; offset += 32) await call(nodeEndpoint, { action: 'append', events: extra.slice(offset, offset + 32) }, node);
page = (await call(endpoint + '?limit=2&level=info', undefined, owner)).data;
assert.equal(page.events.length, 2); assert.ok(page.nextCursor); assert.ok(page.events.every((value: any) => value.level === 'info'));
const tail = (await call(endpoint + '?limit=2&level=info&cursor=' + encodeURIComponent(page.nextCursor), undefined, owner)).data;
assert.equal(tail.events.length, 2); assert.equal(new Set([...page.events, ...tail.events].map((value: any) => value.id)).size, 4);
await call(endpoint + '?limit=2&level=error&cursor=' + encodeURIComponent(page.nextCursor), undefined, owner, 400);
await call(endpoint + '?cursor=' + Buffer.from(JSON.stringify({ id: 'id', at: null })).toString('base64url'), undefined, owner, 400);
assert.equal((await call(endpoint, undefined, other)).data.events.length, 0);
await call(endpoint, { action: 'settings', enabled: false }, owner);
assert.equal((await call(nodeEndpoint, { action: 'status' }, node)).data.enabled, false);
const disabled = (await call(nodeEndpoint, { action: 'append', events: [{ ...event, eventId: randomUUID() }] }, node)).data;
assert.equal(disabled.enabled, false); assert.deepEqual(disabled.acknowledgedEventIds, []);
assert.equal((await call(endpoint + '?limit=100', undefined, owner)).data.events.length, 100);
await call(endpoint, { action: 'settings', enabled: true }, owner);
await call('/api/v1/things?id=' + eventThingId, undefined, owner, 200, 'DELETE');
await call('/api/v1/things?id=' + eventThingId, undefined, owner, 404);
const usedBeforeClear = await used();
const clearRequestId = randomUUID();
const throughSequence = (await call(endpoint, undefined, owner)).data.throughSequence;
const clearRequest = { action: 'clear', requestId: clearRequestId, throughSequence };
const cleared = (await call(endpoint, clearRequest, owner)).data;
assert.equal(cleared.deleted, 100); assert.equal(cleared.hasMore, true); assert.ok(await used() < usedBeforeClear);
const arriving = { ...event, eventId: randomUUID() };
await call(nodeEndpoint, { action: 'append', events: [arriving] }, node);
const continued = (await call(endpoint, clearRequest, owner)).data;
assert.equal(continued.deleted, 5); assert.equal(continued.hasMore, false);
assert.equal((await call(endpoint, clearRequest, owner)).data.deleted, 0);
assert.equal((await call(endpoint, undefined, owner)).data.events[0].eventId, arriving.eventId);
const laterClear = { action: 'clear', requestId: randomUUID(), throughSequence: (await call(endpoint, undefined, owner)).data.throughSequence };
await call(endpoint, laterClear, owner);
const afterLaterClear = { ...event, eventId: randomUUID() };
await call(nodeEndpoint, { action: 'append', events: [afterLaterClear] }, node);
assert.equal((await call(endpoint, clearRequest, owner)).data.deleted, 0);
assert.equal((await call(endpoint, undefined, owner)).data.events[0].eventId, afterLaterClear.eventId);
await call('/api/v1/devices/disconnect', { deviceId: node.deviceId }, owner);
await call(nodeEndpoint, { action: 'append', events: [event] }, node, 401);
await call(nodeEndpoint, { action: 'status' }, node, 401);
if (process.env.THINGTIME_DIAGNOSTICS_RECEIPT) await writeFile(process.env.THINGTIME_DIAGNOSTICS_RECEIPT,
    JSON.stringify({ origin: account.base, ownerId: account.userId, folderId: first.folder.id, deviceId: node.deviceId, result: 'PASS',
        boundaries: ['built-manifest', 'concurrent-provisioning', 'paired-authority', 'root-hidden', 'private-exact-things', 'private-PAT-read-public-PAT-refusal', 'immutable-replay-accounting', 'malformed-redaction', 'filtered-pagination', 'opt-out', 'normal-delete', 'clear-refund', 'revocation'] }, null, 2) + '\n');
console.log('PASS built private diagnostics: provisioning, ACLs, immutable replay/accounting, safe fields, filtered pages, opt-out, delete/clear, revocation');
