import assert from 'node:assert/strict';
import test from 'node:test';
import { runLibraryRequest } from './request';
import type { LibraryExample } from '../../../library/types';
import { buildExampleRequest } from '../../../library/request';
const stripe: LibraryExample = {
	id: 'fixture',
	provider: 'Stripe',
	title: 'Fixture',
	description: 'Test transport',
	docs: 'https://docs.stripe.com/api',
	category: 'Test',
	kind: 'thing',
	input: {},
	request: { url: 'https://api.stripe.com/v1/balance', auth: { type: 'bearer' } }
};
test('private credentials only reach their fixed upstream over a nonredirecting GET', async () => {
	const result = await runLibraryRequest(stripe, {}, 'sk_test_fixture', (async (url, init) => {
		assert.equal(String(url), 'https://api.stripe.com/v1/balance');
		assert.equal(init?.method, 'GET');
		assert.equal(init?.redirect, 'error');
		assert.equal(init?.credentials, 'omit');
		assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer sk_test_fixture');
		assert.ok(init?.signal);
		return new Response(JSON.stringify({ balance: 10, echo: 'sk_test_fixture' }));
	}) as typeof fetch);
	assert.deepEqual(result, { balance: 10, echo: '[redacted]' });
});
test('live Stripe keys and header injection are refused before transport', () => {
	for (const key of ['sk_live_example', 'rk_live_example', 'sk_test_a\r\nX-Evil: 1', '']) assert.throws(() => buildExampleRequest(stripe, {}, key));
});
test('provider failures never return response bodies', async () => {
	await assert.rejects(
		runLibraryRequest(stripe, {}, 'sk_test_fixture', (async () => new Response('private provider diagnostics', { status: 500 })) as typeof fetch),
		(error) => !String(error).includes('private provider')
	);
});
