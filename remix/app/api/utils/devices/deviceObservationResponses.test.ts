import assert from 'node:assert/strict';
import test from 'node:test';
import { StorageMutationError } from '../storage/storageCore';
import { observationResponse } from './deviceObservationResponses';
test('transient accounting refusal retains its stable retry code and private response boundary', async () => {
	const response = await observationResponse(async () => {
		throw new StorageMutationError(503, 'accounting_unavailable', 'Account storage accounting is being initialized — try again shortly');
	});
	assert.equal(response.status, 503);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(response.headers.get('Pragma'), 'no-cache');
	assert.deepEqual(await response.json(), {
		ok: false,
		error: 'Account storage accounting is being initialized — try again shortly',
		code: 'accounting_unavailable',
		retryable: true
	});
});
test('quota refusal preserves its non-retryable status without attempting or inventing a successful write', async () => {
	const response = await observationResponse(async () => {
		throw new StorageMutationError(507, 'quota_exceeded', 'Account storage is full');
	});
	assert.equal(response.status, 507);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	assert.deepEqual(await response.json(), { ok: false, error: 'Account storage is full', code: 'quota_exceeded', retryable: false });
});
