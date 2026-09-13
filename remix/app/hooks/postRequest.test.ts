import assert from 'node:assert/strict';
import test from 'node:test';
import { withPostRequestDeadline } from './postRequest';
import { hasUnknownMutationOutcome } from './apiFailure';

test('a stalled post releases the composer with an unknown outcome and aborts transport', async () => {
	let signal: AbortSignal | undefined;
	await assert.rejects(withPostRequestDeadline(s => { signal = s; return new Promise(() => {}); }, 5), hasUnknownMutationOutcome);
	assert.equal(signal?.aborted, true);
});
test('a timely response is returned and its request is not aborted later', async () => {
	let signal: AbortSignal | undefined;
	assert.equal(await withPostRequestDeadline(async s => { signal = s; return 'saved'; }, 5), 'saved');
	await new Promise(resolve => setTimeout(resolve, 10));
	assert.equal(signal?.aborted, false);
});
