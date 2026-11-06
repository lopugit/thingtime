import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackupDestinationRegistry, parseBackupDestinations } from './backupDestinations';
import { createBackupDestinationHandlers } from '../../../routes/api/v1/backups/destinations/_destinations';
import { createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { thingtimeCapabilityManifest, capabilitySatisfies } from '../capabilities/thingtimeCapabilities';
import { BACKUP_DESTINATIONS_REQUIREMENTS } from '../../../backups/destinations';

const origin = 'https://backup.test';
const destination = { id: 'independent', label: 'Independent archive', provider: 'aws-s3-oidc',
	roleArn: 'arn:aws:iam::123456789012:role/backup-only', bucket: 'independent-archive', region: 'eu-central-1',
	expectedBucketOwner: '123456789012', prefix: 'portable' };
const config = (value: any = [destination]) => JSON.stringify({ schemaVersion: 1, environments: { isolated: { origins: { [origin]: { destinations: value } } } } });
function registry(extra: Parameters<typeof createBackupDestinationRegistry>[0] = {}) {
	return createBackupDestinationRegistry({ environment: () => 'isolated', primaryBucket: () => 'primary-live-files', read: async () => config(),
		credentials: (() => async () => ({ accessKeyId: 'test-only', secretAccessKey: 'test-only' })) as any, ...extra });
}
test('fixed origin/environment registration never falls back or accepts the live attachment bucket', () => {
	assert.equal(parseBackupDestinations(config(), 'isolated', origin, 'primary-live-files')[0].id, destination.id);
	assert.throws(() => parseBackupDestinations(config(), 'production', origin, 'primary-live-files'));
	assert.throws(() => parseBackupDestinations(config(), 'isolated', 'https://other.test', 'primary-live-files'));
	assert.throws(() => parseBackupDestinations(config(), 'isolated', origin + '/', 'primary-live-files'));
	assert.throws(() => parseBackupDestinations(config(), 'isolated', origin, destination.bucket));
	assert.throws(() => parseBackupDestinations(config().replace('"schemaVersion":1', '"schemaVersion":2'), 'isolated', origin, 'primary-live-files'));
});
test('destination registration refuses request-like endpoints, duplicate IDs/namespaces and account-role mismatch', () => {
	for (const rows of [
		[{ ...destination, endpoint: 'https://unexpected.test' }], [destination, destination],
		[destination, { ...destination, id: 'second' }], [{ ...destination, expectedBucketOwner: '999999999999' }],
		[{ ...destination, provider: 'arbitrary-url' }], [{ ...destination, region: 'example.com/path' }]
	]) assert.throws(() => parseBackupDestinations(config(rows), 'isolated', origin, 'primary-live-files'));
});
test('discovery projects only opaque metadata and separates configured from execution/provider proof', async () => {
	const result = await registry().discover(origin);
	assert.deepEqual(result, { ok: true, destinations: [{ id: destination.id, label: destination.label,
		provider: 'aws-s3-oidc', state: 'configured-unverified' }], availability: 'configured', reason: null, executionAvailable: false });
	const publicText = JSON.stringify(result);
	for (const hidden of [destination.roleArn, destination.bucket, destination.region, destination.prefix, 'secretAccessKey']) assert.ok(!publicText.includes(hidden));
});
test('unavailable configuration never leaks vault errors or borrows default credentials', async () => {
	let credentials = 0;
	const r = registry({ read: async () => { throw Error('private-vault-diagnostic'); }, credentials: (() => { credentials++; throw Error(); }) as any });
	assert.deepEqual(await r.discover(origin), { ok: true, destinations: [], availability: 'unavailable', reason: 'invalid-configuration', executionAvailable: false });
	await assert.rejects(r.open(destination.id, { scope: { apiOrigin: origin, ownerId: 'owner', dataPlane: 'home' }, authorize: async () => {} }), /unavailable/);
	assert.equal(credentials, 0);
	assert.equal((await registry({ read: async () => null }).discover(origin)).reason, 'not-configured');
	assert.equal((await registry({ environment: () => null }).discover(origin)).reason, 'environment-unavailable');
	assert.equal((await registry({ primaryBucket: () => { throw Error(); } }).discover(origin)).reason, 'primary-storage-unavailable');
	await assert.rejects(registry({ customPlane: () => true }).open(destination.id, { scope: { apiOrigin: origin, ownerId: 'owner', dataPlane: 'home' }, authorize: async () => {} }), /home storage/);
});
test('worker opener rechecks owning access and exact registration before provider use', async () => {
	let raw = config(), permitted = true, credentialProviders = 0;
	const r = registry({ read: async () => raw, credentials: (() => { credentialProviders++; return async () => { throw Error('No provider network in fixture'); }; }) as any });
	const access = { scope: { apiOrigin: origin, ownerId: 'owner', dataPlane: 'home' }, authorize: async () => { if (!permitted) throw Error('Session revoked'); } };
	const opened = await r.open(destination.id, access);
	assert.equal(credentialProviders, 1);
	assert.equal(opened.binding.length, 64);
	permitted = false;
	await assert.rejects(opened.store.read('chunks/' + 'a'.repeat(64), 1), /revoked/);
	permitted = true; raw = config([{ ...destination, prefix: 'changed' }]);
	await assert.rejects(opened.store.read('chunks/' + 'a'.repeat(64), 1), /changed/);
	await assert.rejects(r.open(destination.id, access, opened.binding), /changed/);
	opened.store.close();
});
test('discovery route fences identity/origin/plane before reading any registration', async () => {
	let who: any = { id: 'owner', accountKind: 'user' }, plane = 'home', reads = 0;
	const handlers = createBackupDestinationHandlers({ user: async () => who, plane: () => plane as any,
		limit: (async () => ({ allowed: true })) as any, discover: async value => { reads++; return registry().discover(value); } });
	const invoke = (headers: Record<string, string> = {}, path = '', method = 'GET') => handlers.loader({ request: new Request(origin + '/api/v1/backups/destinations' + path, { method, headers }) });
	for (const [headers, path, method, status] of [
		[{ Origin: 'https://other.test' }, '', 'GET', 403], [{ 'Sec-Fetch-Site': 'cross-site' }, '', 'GET', 403],
		[{ 'X-Thingtime-Expected-Actor': 'other' }, '', 'GET', 409], [{}, '?endpoint=https://other.test', 'GET', 400], [{}, '', 'POST', 405]
	] as const) assert.equal((await invoke(headers, path, method)).status, status);
	who = null; assert.equal((await invoke()).status, 401);
	who = { id: 'owner', accountKind: 'user', isCharacter: true }; assert.equal((await invoke()).status, 403);
	who = { id: 'owner', accountKind: 'user' }; plane = 'custom'; assert.equal((await invoke()).status, 409);
	assert.equal(reads, 0); plane = 'home';
	const response = await invoke({ 'X-Thingtime-Expected-Actor': 'owner' });
	assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.equal(reads, 1);
});
test('both public manifests register destination discovery and reject incompatible client contracts', () => {
	const publicManifest = createApiCapabilitiesManifest();
	const runtimeManifest = thingtimeCapabilityManifest(origin);
	for (const [feature, minimum] of Object.entries(BACKUP_DESTINATIONS_REQUIREMENTS)) {
		assert.ok(capabilitySatisfies(publicManifest.features[feature], minimum));
		assert.ok(capabilitySatisfies(runtimeManifest.features[feature].version, minimum));
		assert.equal(capabilitySatisfies('2.0.0', minimum), false);
		assert.equal(capabilitySatisfies('', minimum), false);
	}
	assert.ok(runtimeManifest.operations.some(operation => operation.path === '/api/v1/backups/destinations' && operation.methods.includes('GET')));
});
