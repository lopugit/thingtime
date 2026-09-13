import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let user: any;
let writes = 0;
let expires = 0;
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
	namedExports: {
		enforceRateLimit: async () => ({ allowed: true }),
		rateLimitedResponseInit: () => ({ status: 429 })
	}
});
mock.module(new URL('./invites.ts', import.meta.url).href, {
	namedExports: {
		createInvite: async () => {
			writes++;
			return { id: 'invite', token: 'a'.repeat(43), credits: 1, expiresAt: '2026-10-13T00:00:00Z' };
		},
		closeInvite: async () => {
			writes++;
		},
		listInvites: async () => [],
		previewInvite: async () => ({ credits: 1 }),
		expireInvites: async () => {
			expires++;
		}
	}
});
const { action } = await import('../../../routes/api/v1/auth/invites/_invites');
const { loader } = await import('../../../routes/api/v1/auth/invites/expire/_expire');
beforeEach(() => {
	user = { id: 'creator', accountKind: 'user' };
	writes = 0;
	expires = 0;
});
const call = (origin = 'http://127.0.0.1:11000', type = 'application/json') =>
	action({
		request: new Request('http://127.0.0.1:11002/api/v1/auth/invites', {
			method: 'POST',
			headers: { Origin: origin, 'X-Forwarded-Host': '127.0.0.1:11000', 'X-Forwarded-Proto': 'http', 'Content-Type': type },
			body: JSON.stringify({ intent: 'create' })
		})
	});
test('invite management rejects guests, temporary accounts, service accounts and cross-origin writes', async () => {
	for (const actor of [null, { id: 'guest', temporary: true, accountKind: 'user' }, { id: 'service', accountKind: 'service' }]) {
		user = actor;
		assert.equal((await call()).status, 401);
	}
	user = { id: 'creator', accountKind: 'user' };
	assert.equal((await call('https://attacker.invalid')).status, 403);
	assert.equal((await call(undefined, 'text/plain')).status, 415);
	assert.equal(writes, 0);
});
test('created links use the trusted browser origin behind the local API proxy and remain no-store', async () => {
	const saved = { APP_URL: process.env.APP_URL, VERCEL_URL: process.env.VERCEL_URL, PUBLIC_APP_URL: process.env.PUBLIC_APP_URL };
	for (const key of Object.keys(saved)) delete process.env[key];
	try {
		const response = await call();
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('Cache-Control'), 'no-store');
		const body = await response.json();
		assert.equal(body.url, `http://127.0.0.1:11000/invite#${'a'.repeat(43)}`);
		assert.equal(writes, 1);
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
test('expiry fails closed without its secret and requires the exact bearer before refunding', async () => {
	const previous = process.env.CRON_SECRET;
	const run = (authorization?: string) =>
		loader({
			request: new Request('https://thingtime.com/api/v1/auth/invites/expire', { headers: authorization ? { Authorization: authorization } : {} })
		});
	try {
		delete process.env.CRON_SECRET;
		assert.equal((await run()).status, 503);
		process.env.CRON_SECRET = 'test-only-cron-secret';
		assert.equal((await run()).status, 401);
		assert.equal((await run('Bearer incorrect')).status, 401);
		assert.equal(expires, 0);
		assert.equal((await run('Bearer test-only-cron-secret')).status, 200);
		assert.equal(expires, 1);
	} finally {
		if (previous === undefined) delete process.env.CRON_SECRET;
		else process.env.CRON_SECRET = previous;
	}
});
