import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiFailure } from '~/hooks/apiFailure';
import {
	SENSITIVE_REVEAL_FALLBACK_MESSAGE,
	sensitiveRevealErrorMessage,
	sensitiveRevealFailure
} from './sensitiveRevealError';

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
	assert.equal(sensitiveRevealFailure(mismatch).recovery, 'password');
	assert.equal(sensitiveRevealFailure(expired).recovery, 'login');
});

test('sensitive reveal classifies fixed non-password recovery paths', () => {
	const missing = createApiFailure({ payload: { ok: false, error: 'Sensitive value not found' }, status: 404, method: 'POST' });
	const limited = createApiFailure({
		payload: { ok: false, error: 'Too many reveal confirmation attempts' },
		status: 429,
		retryAfter: '17',
		method: 'POST'
	});
	const unavailable = createApiFailure({
		payload: { ok: false, error: 'Sensitive reveal is temporarily unavailable' },
		status: 503,
		method: 'POST'
	});

	assert.deepEqual(sensitiveRevealFailure(missing), {
		message: 'This protected value is missing, expired, or no longer available. Refresh this Thing.',
		recovery: 'refresh'
	});
	assert.deepEqual(sensitiveRevealFailure(limited), {
		message: 'Too many reveal confirmation attempts. Try again in 17 seconds.',
		recovery: 'wait'
	});
	assert.deepEqual(sensitiveRevealFailure(unavailable), {
		message: 'Protected-value confirmation is temporarily unavailable. Please wait and try again.',
		recovery: 'retry'
	});
});

test('sensitive reveal never reflects unexpected authored error text', () => {
	const rawValue = '507f1f77bcf86cd799439011';
	const unexpected = createApiFailure({
		payload: { ok: false, error: `Internal selector failed for ${rawValue}` },
		status: 400,
		method: 'POST'
	});

	for (const error of [unexpected, { error: `Leaked value: ${rawValue}` }, new Error(`Leaked value: ${rawValue}`)]) {
		const failure = sensitiveRevealFailure(error);
		assert.equal(failure.message, SENSITIVE_REVEAL_FALLBACK_MESSAGE);
		assert.equal(failure.recovery, 'dismiss');
		assert.doesNotMatch(failure.message, new RegExp(rawValue));
	}
});
