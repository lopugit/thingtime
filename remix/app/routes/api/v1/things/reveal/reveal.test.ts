import assert from 'node:assert/strict';
import test from 'node:test';

import { action, createSensitiveRevealAction, loader } from './_reveal';

const endpoint = 'https://thingtime.example/api/v1/things/reveal';
const thingId = 'migration-diagnostic-89c5d4f2-b478-4aa1-b37d-755171dc3d90';
const reference = 'mongodb-object-id-1';
const rawValue = '507f1f77bcf86cd799439011';

const post = (body: unknown) =>
	new Request(endpoint, {
		method: 'POST',
		headers: { Origin: 'https://thingtime.example', 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

const admin = { id: 'admin-1', isAdmin: true } as any;

const testAction = (overrides: Record<string, unknown> = {}) =>
	createSensitiveRevealAction({
		requireAdmin: async () => ({ user: admin }),
		enforceRateLimit: async () => ({
			allowed: true,
			limit: 5,
			remaining: 4,
			resetAt: new Date(Date.now() + 60_000).toISOString()
		}),
		confirmPassword: async () => 'confirmed',
		revealValue: async () => ({ reference, kind: 'mongodb-object-id', label: 'MongoDB ObjectId #1', value: rawValue }),
		...(overrides as any)
	} as any);

test('sensitive reveal rejects cross-origin and non-JSON browser requests privately', async () => {
	const crossOrigin = await action({
		request: new Request(endpoint, {
			method: 'POST',
			headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
			body: '{}'
		})
	});
	assert.equal(crossOrigin.status, 403);
	assert.equal(crossOrigin.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	assert.equal(crossOrigin.headers.get('Pragma'), 'no-cache');

	const formPost = await action({
		request: new Request(endpoint, {
			method: 'POST',
			headers: { Origin: 'https://thingtime.example', 'Content-Type': 'text/plain' },
			body: '{}'
		})
	});
	assert.equal(formPost.status, 415);
	assert.equal(formPost.headers.get('Cache-Control'), 'private, no-store, max-age=0');
});

test('sensitive reveal requires a full current session before reading a password', async () => {
	const response = await action({
		request: new Request(endpoint, {
			method: 'POST',
			headers: { Origin: 'https://thingtime.example', 'Content-Type': 'application/json' },
			body: JSON.stringify({
				thingId: 'migration-diagnostic-89c5d4f2-b478-4aa1-b37d-755171dc3d90',
				reference: 'mongodb-object-id-1',
				password: 'not-read-without-a-session'
			})
		})
	});

	assert.equal(response.status, 401);
	assert.deepEqual(await response.json(), { ok: false, error: 'Unauthorized' });
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
});

test('sensitive reveal GET and HEAD method errors stay private', async () => {
	for (const method of ['GET', 'HEAD']) {
		const response = await loader();
		assert.equal(response.status, 405, method);
		assert.equal(response.headers.get('Allow'), 'POST');
		assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
		assert.equal(response.headers.get('Pragma'), 'no-cache');
	}
});

test('sensitive reveal returns exactly one raw value only after confirmation', async () => {
	const calls: string[] = [];
	const handler = testAction({
		confirmPassword: async (userId: string, password: unknown) => {
			calls.push(`confirm:${userId}:${String(password)}`);
			return 'confirmed';
		},
		revealValue: async (_user: unknown, requestedThingId: string, requestedReference: string) => {
			calls.push(`reveal:${requestedThingId}:${requestedReference}`);
			return { reference, kind: 'mongodb-object-id', label: 'MongoDB ObjectId #1', value: rawValue };
		}
	});
	const response = await handler({ request: post({ thingId, reference, password: 'current-password' }) });

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true, reveal: { reference, kind: 'mongodb-object-id', value: rawValue } });
	assert.deepEqual(calls, [`confirm:admin-1:current-password`, `reveal:${thingId}:${reference}`]);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
});

test('sensitive reveal keeps mismatch, verifier outage, and missing values contextual', async () => {
	let revealCalls = 0;
	const mismatch = testAction({
		confirmPassword: async () => 'mismatch',
		revealValue: async () => {
			revealCalls += 1;
			return null;
		}
	});
	const mismatchResponse = await mismatch({ request: post({ thingId, reference, password: 'wrong' }) });
	assert.equal(mismatchResponse.status, 401);
	assert.deepEqual(await mismatchResponse.json(), { ok: false, error: 'Password confirmation failed' });
	assert.equal(revealCalls, 0);

	const unavailable = testAction({ confirmPassword: async () => 'unavailable' });
	const unavailableResponse = await unavailable({ request: post({ thingId, reference, password: 'password' }) });
	assert.equal(unavailableResponse.status, 503);
	assert.deepEqual(await unavailableResponse.json(), { ok: false, error: 'Password confirmation is temporarily unavailable' });

	const missing = testAction({ revealValue: async () => null });
	const missingResponse = await missing({ request: post({ thingId, reference, password: 'password' }) });
	assert.equal(missingResponse.status, 404);
	assert.deepEqual(await missingResponse.json(), { ok: false, error: 'Sensitive value not found' });
});

test('sensitive reveal validates the body before consuming its fixed rate limit', async () => {
	let limitCalls = 0;
	const malformed = testAction({
		enforceRateLimit: async () => {
			limitCalls += 1;
			return { allowed: true, limit: 5, remaining: 4, resetAt: new Date().toISOString() };
		}
	});
	const malformedResponse = await malformed({
		request: post({ thingId, reference, password: 'password', path: 'secure.anything' })
	});
	assert.equal(malformedResponse.status, 400);
	assert.equal(limitCalls, 0);

	const blocked = testAction({
		enforceRateLimit: async () => ({
			allowed: false,
			limit: 5,
			remaining: 0,
			resetAt: new Date(Date.now() + 30_000).toISOString()
		})
	});
	const blockedResponse = await blocked({ request: post({ thingId, reference, password: 'password' }) });
	assert.equal(blockedResponse.status, 429);
	assert.match(blockedResponse.headers.get('Retry-After') || '', /^\d+$/);
	assert.deepEqual(await blockedResponse.json(), { ok: false, error: 'Too many reveal confirmation attempts' });

	const limiterOutage = testAction({
		enforceRateLimit: async () => ({
			allowed: false,
			limit: 5,
			remaining: 0,
			resetAt: new Date().toISOString(),
			unavailable: true
		})
	});
	const outageResponse = await limiterOutage({ request: post({ thingId, reference, password: 'password' }) });
	assert.equal(outageResponse.status, 503);
	assert.deepEqual(await outageResponse.json(), { ok: false, error: 'Sensitive reveal is temporarily unavailable' });
});

test('oversized reveal bodies keep private headers on thrown 413 responses', async () => {
	const handler = testAction();
	let thrown: unknown;
	try {
		await handler({ request: post({ thingId, reference, password: 'x'.repeat(9_000) }) });
	} catch (error) {
		thrown = error;
	}
	assert.ok(thrown instanceof Response);
	assert.equal(thrown.status, 413);
	assert.equal(thrown.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	assert.equal(thrown.headers.get('Pragma'), 'no-cache');
});
