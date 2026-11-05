// Run only inside the task-owned network-none native acceptance fixture. All
// application setup/mutations use the real API; Mongo driver access is absent.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { ALL_SUITES } from '../app/schemas/appSuites';
import { suiteBundleVersion, type InstallSuiteResult } from '../app/schemas/suiteInstallation';

const base = process.env.TT_SUITE_TEST_ORIGIN, sessionId = process.env.TT_SUITE_TEST_SESSION;
assert.equal(base, 'http://127.0.0.1:18724', 'Use the task-owned native fixture loopback origin');
assert.ok(sessionId && /^[a-zA-Z0-9._:-]+$/.test(sessionId), 'Require the current native manager session');
assert.ok(Object.values(networkInterfaces()).flat().every(address => address?.internal), 'A network-none runtime is required');
const suite = ALL_SUITES.find(suite => suite.key === 'guestbook')!, bundleVersion = await suiteBundleVersion(suite);
const resultPath = process.env.TT_SUITE_TEST_RESULT || '/tmp/native-artifacts/suite-install-result.json';
const start = Date.now();
type Identity = { id: string; cookie: string };
async function call(identity: Identity | null, path: string, body?: unknown, extras: { method?: string; headers?: Record<string, string> } = {}) {
	const url = new URL(path, base); assert.equal(url.origin, base);
	const response = await fetch(url, { method: extras.method || (body === undefined ? 'GET' : 'POST'), redirect: 'error', signal: AbortSignal.timeout(45_000),
		headers: { Origin: base!, 'Content-Type': 'application/json', ...(identity ? { Cookie: identity.cookie } : {}), ...extras.headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	const data = await response.json(); return { status: response.status, data, headers: response.headers };
}
const health = await call(null, '/api/v1/health/nitro');
assert.equal(health.data.state, 'ready'); assert.equal(health.data.testEnvironment?.sessionId, sessionId); assert.equal(health.data.storageAccounting?.state, 'ready');
const status = await call(null, '/api/v1/mongodb/status');
assert.equal(status.data.host, '127.0.0.1:27017'); assert.equal(status.data.replicaSet, `tt-agent-${sessionId}`); assert.equal(status.data.custom, false); assert.equal(status.data.connected, true);
const manifest = await call(null, '/.well-known/thingtime-capabilities.json');
assert.equal(manifest.data.origin, base); assert.equal(manifest.data.features['api.webpages-suites-install'].version, '1.7.0');
async function register(): Promise<Identity> {
	const username = `suite-${randomUUID().slice(0, 8)}`, password = `Fixture-${randomBytes(32).toString('base64url')}-9a!`;
	const response = await call(null, '/api/v1/auth/register', { username, password, email: username + '@example.test' });
	assert.equal(response.status, 200, 'Disposable synthetic registration must succeed'); assert.equal(response.data.ok, true);
	return { id: response.data.user.id, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
async function install(identity: Identity, requestId: string, headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
	return call(identity, '/api/v1/webpages/suites/install', { key: suite.key, onlyMissing: true, requestId, bundleVersion, ...body }, {
		headers: { 'X-Thingtime-Expected-Actor': identity.id, 'X-Thingtime-Expected-Data-Plane': 'home', ...headers }
	});
}
async function read(identity: Identity, id: string) {
	const result = await call(identity, '/api/v1/things?id=' + encodeURIComponent(id)); assert.equal(result.status, 200); assert.equal(result.data.ok, true); return result.data.thing;
}
async function usage(identity: Identity) {
	const response = await call(identity, '/api/v1/auth/me'); assert.equal(response.data.user.id, identity.id); assert.equal(response.data.user.storage.status, 'ready'); return response.data.user.storage;
}
const ids = (result: InstallSuiteResult) => [...new Set([...Object.values(result.schemaIds), ...Object.values(result.componentIds), ...Object.values(result.actionIds), ...Object.values(result.pageIds), ...result.dataIds])];
async function list(identity: Identity, kind: string) {
	const out: any[] = []; let cursor: string | undefined;
	do { const response = await call(identity, `/api/v1/things?thingtime=${kind}&limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`); assert.equal(response.status, 200); assert.equal(response.data.ok, true); out.push(...response.data.things); cursor = response.data.nextCursor || undefined; } while (cursor);
	return out;
}
const owner = await register(), requestId = randomUUID(), before = (await usage(owner)).usedBytes;
const pair = await Promise.all([install(owner, requestId), install(owner, randomUUID())]);
for (const result of pair) { assert.equal(result.status, 200, 'Concurrent real transaction must commit'); assert.equal(result.data.ok, true); assert.equal(result.headers.get('Cache-Control'), 'private, no-store'); }
const result = pair[0].data as InstallSuiteResult, other = pair[1].data as InstallSuiteResult;
for (const key of ['schemaIds', 'componentIds', 'actionIds', 'pageIds', 'dataIds'] as const) assert.deepEqual(result[key], other[key]);
assert.equal(result.created + other.created, ids(result).length, 'Only one of each part is committed');
for (const [kind, map] of [['schema', result.schemaIds], ['component', result.componentIds], ['action', result.actionIds], ['webpage', result.pageIds]] as const) assert.equal((await list(owner, kind)).length, Object.keys(map).length, `No duplicate ${kind} keys`);
for (const snapshot of result.receipt!.snapshots) { const actual = await read(owner, snapshot.id); assert.equal(actual.author.id, owner.id); assert.equal(snapshot.updatedAt, actual.updatedAt); assert.deepEqual(snapshot.crystal, actual.crystal); assert.deepEqual(snapshot.acl, actual.acl); assert.equal('linkKey' in snapshot, false); assert.equal('tokenAcl' in snapshot, false); }
const baselineBytes = (await usage(owner)).usedBytes, baselineReceipt = structuredClone(result);
assert.ok(baselineBytes > before);
const componentId = Object.values(result.componentIds)[0], component = await read(owner, componentId);
const edited = await call(owner, '/api/v1/things', { id: componentId, expectedUpdatedAt: component.updatedAt, crystal: { name: 'Retained customized account control' }, visibility: 'hidden' }, { method: 'PATCH' });
assert.equal(edited.status, 200); assert.equal(edited.data.ok, true);
const replay = await install(owner, requestId); assert.equal(replay.status, 200); assert.deepEqual(replay.data, baselineReceipt, 'Lost-response retry replays exact original snapshots');
const customized = await install(owner, randomUUID()); assert.equal(customized.status, 200); assert.equal(customized.data.created, 0); assert.equal(customized.data.updated, 0);
const customizedSnapshot = customized.data.receipt.snapshots.find((row: any) => row.id === componentId);
assert.equal(customizedSnapshot.crystal.name, 'Retained customized account control'); assert.equal(customizedSnapshot.visibility, 'hidden'); assert.equal('linkKey' in customizedSnapshot, false); assert.equal('tokenAcl' in customizedSnapshot, false);
for (const headers of [{ Origin: 'https://foreign.invalid' }, { 'X-Thingtime-Expected-Actor': 'foreign-owner' }, { 'X-Thingtime-Expected-Data-Plane': 'custom-' + 'a'.repeat(64) }]) assert.ok([403, 409].includes((await install(owner, randomUUID(), headers)).status));
assert.equal((await install(owner, requestId, {}, { key: 'media-tools' })).status, 409, 'A durable operation cannot change suite');
assert.equal((await install(owner, randomUUID(), {}, { bundleVersion: 'suite-bundle-v1:' + '0'.repeat(64) })).status, 409, 'A new operation cannot install a changed bundle');
const restored = await call(owner, '/api/v1/webpages/suites/install', { key: suite.key });
assert.equal(restored.status, 200); assert.equal(restored.data.ok, true); assert.ok(restored.data.updated >= 1, 'Legacy reinstall uses composed canonical updates');
assert.equal((await read(owner, componentId)).crystal.name, component.crystal.name);
const outsider = await register(); assert.equal((await call(outsider, '/api/v1/things?id=' + Object.values(result.actionIds)[0])).status, 404);
const foreign = await install(outsider, requestId); assert.equal(foreign.status, 200); assert.notDeepEqual(foreign.data.pageIds, result.pageIds);
// A second selected plane shares only home identity, never suite content or
// transaction sessions. Its account ledger must remain unchanged.
const customUrl = `mongodb://127.0.0.1:27017/suite_${randomUUID().replaceAll('-', '')}?replicaSet=tt-agent-${sessionId}`;
const planeDiscovery = await call(outsider, `/api/v1/timeline?ownerId=${outsider.id}`, undefined, { headers: { 'x-tt-mongo-url': customUrl } });
assert.equal(planeDiscovery.status, 200); const plane = planeDiscovery.data.dataPlane; assert.match(plane, /^custom-[a-f0-9]{64}$/);
const homeUsage = (await usage(outsider)).usedBytes;
const custom = await install(outsider, randomUUID(), { 'x-tt-mongo-url': customUrl, 'X-Thingtime-Expected-Data-Plane': plane });
assert.equal(custom.status, 200, 'Schema provenance and content transactions use the custom data-plane client'); assert.equal(custom.data.receipt.dataPlane, plane); assert.notDeepEqual(custom.data.pageIds, foreign.data.pageIds); assert.equal((await usage(outsider)).usedBytes, homeUsage);
// The runner provisions this disposable administrator through real auth APIs
// before restart. No credentials leave the same network-none runtime.
const adminPath = process.env.TT_SUITE_TEST_ADMIN_FIXTURE;
assert.equal(adminPath, '/home/pwuser/continuation-admin-fixture.json', 'Private fixture is required for quota acceptance');
const adminFixture = JSON.parse(await readFile(adminPath!, 'utf8')); assert.equal(adminFixture.base, base); assert.equal(adminFixture.sessionId, sessionId); assert.match(adminFixture.username, /^tt-fixture-admin-/);
const login = await call(null, '/api/v1/login', { username: adminFixture.username, password: adminFixture.password });
assert.equal(login.status, 200); assert.equal(login.data.user.id, adminFixture.ownerId); assert.equal(login.data.user.isAdmin, true);
const admin = { id: login.data.user.id, cookie: login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
const quota = await register(), quotaBaseline = (await usage(quota)).usedBytes;
async function allowance(bytes: number) {
	const response = await call(admin, '/api/v1/admin/subscriptions', { subjectType: 'user', subjectId: quota.id, tier: 'free', overrides: { userStorageBytes: bytes }, note: 'Disposable suite transaction acceptance' }); assert.equal(response.status, 200); assert.equal(response.data.ok, true); assert.equal((await usage(quota)).allowanceBytes, bytes);
}
await allowance(quotaBaseline + Math.max(1, Math.floor((baselineBytes - before) / 2)));
const failedId = randomUUID(), denied = await install(quota, failedId); assert.equal(denied.status, 507, 'Quota refusal is the canonical storage error'); assert.equal((await usage(quota)).usedBytes, quotaBaseline);
for (const kind of ['schema', 'component', 'action', 'webpage', 'data']) assert.equal((await list(quota, kind)).length, 0, 'Failed transaction leaves no suite parts');
await allowance(quotaBaseline + (baselineBytes - before) * 4);
const retried = await install(quota, failedId); assert.equal(retried.status, 200); assert.equal(retried.data.created, ids(retried.data).length, 'Failed receipt was rolled back with content');
await writeFile(resultPath, JSON.stringify({ ok: true, origin: base, sessionId, capability: 'api.webpages-suites-install@1.7.0', productionAccess: false, elapsedMs: Date.now() - start,
	checks: ['real concurrent replica-set transactions', 'canonical map and exact readback', 'lost-response receipt replay after later edits', 'onlyMissing custom content and hidden bearer redaction', 'origin actor plane and bundle guards', 'legacy composed canonical update', 'cross-account privacy', 'custom data-plane session and home-ledger isolation', 'quota rollback content receipt and ledger', 'same-operation retry after refusal'] }, null, 2));
console.log('Suite installation API acceptance passed.');
