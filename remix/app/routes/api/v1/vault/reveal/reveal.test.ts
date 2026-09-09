import assert from 'node:assert/strict';
import test from 'node:test';
import { createVaultRevealAction, loader } from './_reveal';

const origin = 'https://thingtime.example';
const selection = { vault: 'ci', id: 'credential-example', action: 'reveal', password: 'synthetic-password' };
const account = { user: { id: 'owner', isAdmin: true, temporary: false }, claims: { jti: 'session', sub: 'owner' } };
const post = (body: unknown = selection, headers = {}) =>
	new Request(`${origin}/api/v1/vault/reveal`, {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
const fixture = (overrides: Record<string, unknown> = {}) => {
	const reads: string[] = [];
	const action = createVaultRevealAction({
		getAuthToken: async () => 'synthetic-session-token',
		resolveTokenUser: async () => account as any,
		confirmCurrentPassword: async () => 'confirmed',
		enforceFixedRateLimit: async () => ({ allowed: true } as any),
		revealLopuCredential: async (id) => {
			reads.push(id);
			return 'synthetic-secret';
		},
		revealAdminSecret: async (id) => {
			reads.push(id);
			return 'synthetic-secret';
		},
		revealUserVaultValue: async (owner, id) => {
			reads.push(`${owner}:${id}`);
			return 'synthetic-secret';
		},
		...overrides
	} as any);
	return { action, reads };
};
const privateResponse = (response: Response) => assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');

test('reveals exactly one value after fresh password verification, never a bundle', async () => {
	for (const vault of ['ci', 'admin', 'personal']) {
		const { action, reads } = fixture();
		const response = await action({ request: post({ ...selection, vault }) });
		assert.equal(response.status, 200);
		privateResponse(response);
		assert.deepEqual(await response.json(), { ok: true, vault, id: selection.id, value: 'synthetic-secret' });
		assert.deepEqual(reads, [vault === 'personal' ? `owner:${selection.id}` : selection.id]);
	}
});
test('denies unverified, missing, temporary, non-admin and revoked sessions before decrypting', async () => {
	for (const overrides of [
		{ confirmCurrentPassword: async () => 'mismatch' },
		{ confirmCurrentPassword: async () => 'unavailable' },
		{ resolveTokenUser: async () => null },
		{ resolveTokenUser: async () => ({ ...account, user: { ...account.user, temporary: true } }) },
		{ resolveTokenUser: async () => ({ ...account, user: { ...account.user, isAdmin: false } }) },
		{
			resolveTokenUser: (() => {
				let reads = 0;
				return async () => (++reads === 1 ? account : null);
			})()
		}
	]) {
		const { action, reads } = fixture(overrides);
		const response = await action({ request: post() });
		assert.ok([401, 403].includes(response.status));
		privateResponse(response);
		assert.deepEqual(reads, []);
	}
});
test('personal reveal is scoped to current owner, not a client-supplied owner', async () => {
	const { action, reads } = fixture({ resolveTokenUser: async () => ({ ...account, user: { ...account.user, isAdmin: false } }) });
	assert.equal((await action({ request: post({ ...selection, vault: 'personal', ownerId: 'victim' }) })).status, 400);
	assert.equal((await action({ request: post({ ...selection, vault: 'personal' }) })).status, 200);
	assert.deepEqual(reads, [`owner:${selection.id}`]);
});
test('rejects cross-origin/missing Origin/non JSON/unknown fields and mixed verification methods', async () => {
	for (const request of [
		post(selection, { Origin: 'https://attacker.example' }),
		post(selection, { Origin: '' }),
		post(selection, { 'Content-Type': 'text/plain' }),
		post({ ...selection, path: 'secure' }),
		post({ ...selection, vault: 'environment' }),
		post({ ...selection, ticket: 'mixed' }),
		post({ ...selection, id: { $ne: '' } })
	]) {
		const { action, reads } = fixture();
		const response = await action({ request });
		assert.ok(response.status >= 400);
		privateResponse(response);
		assert.deepEqual(reads, []);
	}
});
test('security limits are fixed and fail closed, including paid accounts', async () => {
	for (const unavailable of [true, false]) {
		const { action, reads } = fixture({
			enforceFixedRateLimit: async (_request: Request, bucket: string, identity: string, policy: any) => {
				assert.equal(bucket, 'auth.vaultReveal');
				assert.equal(identity, 'user:owner');
				assert.deepEqual(policy, { limit: 5, windowMs: 900000 });
				return { allowed: false, unavailable, retryAfterSeconds: 60, limit: 5, remaining: 0, resetAt: new Date().toISOString() };
			}
		});
		const response = await action({ request: post() });
		assert.equal(response.status, unavailable ? 503 : 429);
		privateResponse(response);
		assert.deepEqual(reads, []);
	}
});
test('passkey options and verification use the same session/item binding, options never decrypt', async () => {
	let binding = '';
	const { action, reads } = fixture({
		startVaultPasskeyVerification: async (_request: Request, user: string, scope: string) => {
			assert.equal(user, 'owner');
			binding = scope;
			return { ok: true, options: {}, ticket: 'synthetic-ticket' };
		},
		finishVaultPasskeyVerification: async (_request: Request, user: string, scope: string, ticket: string) => {
			assert.equal(user, 'owner');
			assert.equal(scope, binding);
			assert.equal(ticket, 'synthetic-ticket');
			return true;
		}
	});
	const base = { vault: 'ci', id: selection.id };
	assert.equal((await action({ request: post({ ...base, action: 'options' }) })).status, 200);
	assert.deepEqual(reads, []);
	assert.equal((await action({ request: post({ ...base, action: 'reveal', ticket: 'synthetic-ticket', response: {} }) })).status, 200);
	assert.equal(reads.length, 1);
});
test('missing entry, decrypt errors and unsupported methods never leak secrets or cache responses', async () => {
	for (const revealLopuCredential of [
		async () => null,
		async () => {
			throw new Error('synthetic-private-detail');
		}
	]) {
		const { action } = fixture({ revealLopuCredential });
		const response = await action({ request: post() });
		assert.ok([404, 503].includes(response.status));
		privateResponse(response);
		assert.ok(!(await response.text()).includes('synthetic-private-detail'));
	}
	const response = await loader();
	assert.equal(response.status, 405);
	privateResponse(response);
});
