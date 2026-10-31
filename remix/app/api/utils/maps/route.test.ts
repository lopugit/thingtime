import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRoute } from './route';
import { mapboxBrowserConfig, MapsError } from './mapbox';
import { mapOperation } from '../../../routes/api/v1/maps/_maps';
import { sessionPurposeCanActAsAccount } from '../auth/credentialPurpose';

const request = (body: unknown, contentType = 'application/json') => new Request('https://thingtime.example/api/v1/maps', {
	method: 'POST', headers: { 'Content-Type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body)
});
const allowed = async () => ({ allowed: true, limit: 60, remaining: 59, resetAt: new Date().toISOString() });
const user = { id: 'owner-1', temporary: false } as any;
const dependencies = { getCurrentUser: async () => user, enforceRateLimit: allowed as any };

test('maps requires a full account before any Vault or provider work', async () => {
	let called = false;
	const operation = async () => { called = true; return { ok: true }; };
	const anonymous = await mapRoute(request({ operation: 'browser-config', vaultId: 'vault-1' }), operation, { ...dependencies, getCurrentUser: async () => null });
	assert.equal(anonymous.status, 401);
	const guest = await mapRoute(request({ operation: 'browser-config', vaultId: 'vault-1' }), operation, { ...dependencies, getCurrentUser: async () => ({ ...user, temporary: true }) });
	assert.equal(guest.status, 401);
	assert.equal(called, false);
	// The real getCurrentUser resolver excludes PAT and app-scoped token
	// purposes; route admission depends on that full-account resolver.
	for (const purpose of ['pat', 'app', 'sandbox', 'device']) assert.equal(sessionPurposeCanActAsAccount(purpose), false);
});

test('maps refuses form MIME, malformed JSON and unknown operations', async () => {
	let called = false;
	const operation = async () => { called = true; return { ok: true }; };
	const form = await mapRoute(request('operation=optimize', 'application/x-www-form-urlencoded'), operation, dependencies);
	assert.equal(form.status, 415);
	assert.equal(form.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(called, false);
	const invalid = await mapRoute(request('{bad json'), mapOperation, dependencies);
	assert.equal(invalid.status, 400);
	const unknown = await mapRoute(request({ operation: 'other' }), mapOperation, dependencies);
	assert.equal(unknown.status, 400);
	assert.equal(unknown.headers.get('Cache-Control'), 'private, no-store');
});

test('maps uses owner identity for Vault lookup, rejects another owner ID and redacts errors', async () => {
	const seen: string[] = [];
	const reveal = async (owner: string, id: string) => {
		seen.push(`${owner}:${id}`);
		return id === 'owner-vault' ? 'pk.synthetic' : null;
	};
	const operation = (ownerId: string, input: any) => mapboxBrowserConfig(ownerId, input, reveal);
	const success = await mapRoute(request({ operation: 'browser-config', vaultId: 'owner-vault', ownerId: 'victim' }), operation, dependencies);
	assert.equal(success.status, 200);
	assert.deepEqual(seen, ['owner-1:owner-vault']);
	const refused = await mapRoute(request({ operation: 'browser-config', vaultId: 'victim-vault' }), operation, dependencies);
	assert.equal(refused.status, 409);
	assert.doesNotMatch(JSON.stringify(await refused.json()), /pk\.synthetic|victim-vault/);
	const sanitized = await mapRoute(request({ operation: 'browser-config' }), async () => { throw new Error('SECRET provider URL https://api.mapbox.com/?access_token=sk.secret'); }, dependencies);
	assert.equal(sanitized.status, 502);
	assert.doesNotMatch(JSON.stringify(await sanitized.json()), /SECRET|access_token|sk\.secret/);
});

test('maps operation dispatch rejects unsupported operation without provider call', async () => {
	assert.throws(() => mapOperation('owner-1', { operation: 'forbidden' }, new AbortController().signal), (error: any) => error instanceof MapsError && error.status === 400);
});
