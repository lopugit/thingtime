import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchRootData, RootDataUnavailableError } from './rootDataRecovery';
import { changesRootIdentity, createRootIdentityState } from './rootIdentity';

const options = { timeoutMs: 100, retryDelayMs: 0 };
const signal = () => new AbortController().signal;
test('one network retry recovers using only an uncached credentialed read', async () => {
	let calls = 0;
	const result = await fetchRootData(
		'/api/root-data',
		signal(),
		async (_url, init) => {
			assert.equal(init?.credentials, 'include');
			assert.equal(init?.cache, 'no-store');
			assert.equal(init?.method, undefined);
			if (++calls === 1) throw new TypeError('private diagnostic');
			return Response.json({ ok: true });
		},
		options
	);
	assert.deepEqual(result, { ok: true });
	assert.equal(calls, 2);
});
test('persistent network failure stops after two attempts and sanitizes errors', async () => {
	let calls = 0;
	await assert.rejects(
		fetchRootData(
			'/api/root-data',
			signal(),
			async () => {
				calls++;
				throw new TypeError('private diagnostic');
			},
			options
		),
		(error: unknown) => {
			assert.ok(error instanceof RootDataUnavailableError);
			assert.equal(error.message, 'Could not refresh the current session');
			return true;
		}
	);
	assert.equal(calls, 2);
});
for (const status of [408, 502, 503, 504, 401, 403, 404, 429, 500]) {
	test(`HTTP ${status} has a bounded retry policy`, async () => {
		let calls = 0;
		await assert.rejects(
			fetchRootData(
				'/api/root-data',
				signal(),
				async () => {
					calls++;
					return new Response('', { status });
				},
				options
			),
			RootDataUnavailableError
		);
		assert.equal(calls, [408, 502, 503, 504].includes(status) ? 2 : 1);
	});
}
test('malformed JSON is not retried', async () => {
	let calls = 0;
	await assert.rejects(
		fetchRootData(
			'/api/root-data',
			signal(),
			async () => {
				calls++;
				return new Response('invalid');
			},
			options
		),
		RootDataUnavailableError
	);
	assert.equal(calls, 1);
});
test('aborted requests never start or retry', async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	await assert.rejects(
		fetchRootData(
			'/api/root-data',
			controller.signal,
			async () => {
				calls++;
				return Response.json({});
			},
			options
		),
		{ name: 'AbortError' }
	);
	assert.equal(calls, 0);
});
test('abort during backoff prevents the second attempt', async () => {
	const controller = new AbortController();
	let calls = 0;
	await assert.rejects(
		fetchRootData(
			'/api/root-data',
			controller.signal,
			async () => {
				calls++;
				setTimeout(() => controller.abort(), 5);
				throw new TypeError('network');
			},
			{ timeoutMs: 100, retryDelayMs: 50 }
		),
		{ name: 'AbortError' }
	);
	assert.equal(calls, 1);
});
test('hung reads time out with only one retry', async () => {
	let calls = 0;
	await assert.rejects(
		fetchRootData(
			'/api/root-data',
			signal(),
			async (_url, init) => {
				calls++;
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
				});
			},
			{ timeoutMs: 5, retryDelayMs: 0 }
		),
		RootDataUnavailableError
	);
	assert.equal(calls, 2);
});
test('identity generations reject stale confirmation without retaining account data', () => {
	const state = createRootIdentityState();
	let changes = 0;
	const unsubscribe = state.subscribe(() => changes++);
	state.changed();
	state.changed();
	state.confirm(1);
	assert.deepEqual(state.read(), { generation: 2, pending: true });
	state.confirm(2);
	assert.deepEqual(state.read(), { generation: 2, pending: false });
	assert.equal(changes, 3);
	unsubscribe();
	state.changed();
	assert.equal(changes, 3);
});
test('OTP challenges and failed or unrelated mutations do not reset the account', () => {
	assert.equal(changesRootIdentity('/api/v1/login', { ok: true, requiresOtp: true }), false);
	assert.equal(changesRootIdentity('/api/v1/login', { ok: false, user: {} }), false);
	assert.equal(changesRootIdentity('/api/v1/things/create', { ok: true, user: {} }), false);
	assert.equal(changesRootIdentity('/api/v1/login', { ok: true, user: {} }), true);
	assert.equal(changesRootIdentity('/api/v1/auth/accounts/switch', { ok: true, user: {} }), true);
	assert.equal(changesRootIdentity('/api/v1/auth/logout', { ok: true }), true);
});
