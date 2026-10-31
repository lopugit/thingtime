import assert from 'node:assert/strict';
import test from 'node:test';
import { withAttachmentRateLimitRetry } from './attachmentRateLimitRetry';
import { createApiFailure } from '~/hooks/apiFailure';
import { attachmentUploadError } from './attachmentUiCore';

const limited = (retryAfter = '60') => createApiFailure({ status: 429, retryAfter, method: 'POST' });

test('an actual HTTP 429 failure waits for Retry-After and reuses the exact upload request', async () => {
	const body = Object.freeze({ requestId: 'stable-selection', filename: 'photo.jpeg', sizeBytes: 520397 });
	const requests: unknown[] = [];
	const waits: number[] = [];
	const result = await withAttachmentRateLimitRetry(async () => {
		requests.push(body);
		if (requests.length === 1) throw limited();
		return { upload: { id: 'same-reservation' } };
	}, undefined, async (ms) => { waits.push(ms); });
	assert.deepEqual(waits, [60_000]);
	assert.equal(requests.length, 2);
	assert.equal(requests[0], requests[1]);
	assert.equal(result.upload.id, 'same-reservation');
});

test('persistent throttling is bounded to two retries, then keeps actionable wait guidance', async () => {
	let calls = 0;
	const failure = limited('45');
	await assert.rejects(withAttachmentRateLimitRetry(async () => { calls++; throw failure; }, undefined, async () => {}), (error) => error === failure);
	assert.equal(calls, 3);
	assert.match(attachmentUploadError(failure, 'prepare'), /45 seconds/);
	assert.match(attachmentUploadError(failure, 'prepare'), /selection is kept/i);
});

test('long, absent, malformed waits and ambiguous failures never trigger automatic retries', async () => {
	for (const failure of [limited('3600'), limited('invalid'), { status: 429, retryAfterSeconds: Infinity },
		{ status: 429, retryAfterSeconds: -1 }, createApiFailure({ status: 503, retryAfter: '1', method: 'POST' }),
		createApiFailure({ cause: new Error('offline'), method: 'POST' })]) {
		let calls = 0;
		await assert.rejects(withAttachmentRateLimitRetry(async () => { calls++; throw failure; }, undefined,
			async () => { assert.fail('must not wait'); }), (error) => error === failure);
		assert.equal(calls, 1);
	}
	assert.match(attachmentUploadError(limited('3600'), 'prepare'), /60 minutes/);
	assert.doesNotMatch(attachmentUploadError(limited('invalid'), 'prepare'), /NaN|undefined/);
});

test('cancellation during a real wait prevents a late upload after removal or account switch', async () => {
	const controller = new AbortController();
	let calls = 0;
	const pending = withAttachmentRateLimitRetry(async () => { calls++; throw limited(); }, controller.signal);
	await Promise.resolve();
	controller.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(calls, 1);
	await assert.rejects(withAttachmentRateLimitRetry(async () => { assert.fail('aborted request'); }, controller.signal), { name: 'AbortError' });
});

test('zero retry delay still waits one second and cancellation after wait fences the request', async () => {
	const controller = new AbortController();
	let calls = 0;
	await assert.rejects(withAttachmentRateLimitRetry(async () => { calls++; throw limited('0'); }, controller.signal, async (ms) => {
		assert.equal(ms, 1000);
		controller.abort();
	}), { name: 'AbortError' });
	assert.equal(calls, 1);
});
