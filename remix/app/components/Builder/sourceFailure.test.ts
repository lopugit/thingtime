import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFailure } from './sourceFailure';

test('revoked, private, missing and expired source access discard prior rendered data', () => {
	for (const status of [401, 403, 404]) {
		assert.equal(sourceFailure({ status, error: 'Access changed' }).clear, true);
		assert.equal(sourceFailure({ status: 'error', errorStatus: status, error: 'Access changed' }).clear, true);
	}
	assert.equal(sourceFailure(new Error('The active account changed. Run the action again.')).clear, true);
});
test('transient failures keep the last known authorized result', () => {
	for (const status of [0, 429, 500, 502, 503]) assert.equal(sourceFailure({ status, error: 'Try again' }).clear, false);
	assert.equal(sourceFailure(new Error('Network unavailable')).clear, false);
});
test('a shared browser Action shows the copy state without granting execution', () => {
	assert.deepEqual(sourceFailure(new Error('Browser flows require your own Action and a first-party session'), true), { status: 'not-installed', error: null, clear: true });
	assert.equal(sourceFailure(new Error('No action you own matches')).status, 'not-installed');
	assert.equal(sourceFailure({ status: 403, error: 'Another permission failure' }, true).status, 'error');
});
