import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiFailure } from '~/hooks/apiFailure';
import { sensitiveRevealErrorMessage } from './sensitiveRevealError';

test('sensitive reveal distinguishes a password mismatch from an expired session', () => {
	const mismatch = createApiFailure({
		payload: { ok: false, error: 'Password confirmation failed' },
		status: 401,
		action: 'reveal this protected value',
		method: 'POST'
	});
	const expired = createApiFailure({
		payload: { ok: false, error: 'Unauthorized' },
		status: 401,
		action: 'reveal this protected value',
		method: 'POST'
	});

	assert.match(sensitiveRevealErrorMessage(mismatch), /confirm your password/i);
	assert.doesNotMatch(sensitiveRevealErrorMessage(mismatch), /session expired/i);
	assert.match(sensitiveRevealErrorMessage(expired), /session expired/i);
	assert.doesNotMatch(sensitiveRevealErrorMessage(expired), /confirm your password/i);
});
