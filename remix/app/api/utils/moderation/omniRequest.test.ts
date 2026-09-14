import assert from 'node:assert/strict';
import test from 'node:test';
import { ModerationRequestError, requestOmniModeration } from './omniRequest';

test('temporary throttling retries once, preserving the actual moderation verdict', async () => {
	let calls = 0; const delays: number[] = [];
	const verdict = { results: [{ flagged: true }] };
	const fetcher = async () => ++calls === 1 ? Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429, headers: { 'retry-after': '1' } }) : Response.json(verdict);
	assert.deepEqual(await requestOmniModeration('https://example.test', {}, fetcher as typeof fetch, async ms => { delays.push(ms); }), verdict);
	assert.equal(calls, 2); assert.deepEqual(delays, [1000]);
});
test('exhausted quota and long cooldowns fail closed without retry or raw provider text', async () => {
	for (const [code, retryAfter] of [['insufficient_quota', '1'], ['rate_limit_exceeded', '120']]) {
		let calls = 0;
		const fetcher = async () => { calls++; return Response.json({ error: { code, message: 'private provider details' } }, { status: 429, headers: { 'retry-after': retryAfter } }); };
		await assert.rejects(requestOmniModeration('https://example.test', {}, fetcher as typeof fetch), (error: any) => error instanceof ModerationRequestError && error.status === 429 && !error.message.includes('private'));
		assert.equal(calls, 1);
	}
});
test('repeated throttling is bounded to two attempts', async () => {
	let calls = 0;
	const fetcher = async () => { calls++; return Response.json({ error: { code: 'rate_limit_exceeded' } }, { status: 429 }); };
	await assert.rejects(requestOmniModeration('https://example.test', {}, fetcher as typeof fetch, async () => {}), ModerationRequestError);
	assert.equal(calls, 2);
});

test('non-JSON outages remain bounded and never expose upstream text', async () => {
 let calls = 0;
 await assert.rejects(requestOmniModeration('https://test.invalid', {}, async () => { calls++; return new Response('private upstream diagnostic', { status: 503 }); }, async () => {}), /503; provider_error/);
 assert.equal(calls, 2);
});
