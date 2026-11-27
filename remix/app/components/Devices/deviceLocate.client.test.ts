import assert from 'node:assert/strict';
import test from 'node:test';
import { LocateRequestRefused, locateReceiptLabel, locateResponseError } from './deviceLocate.client';

test('only confirmed pre-admission refusals release an alert attempt; conflicts and ambiguous failures retain it', () => {
	for (const status of [400, 401, 403, 404, 429]) assert.ok(locateResponseError(status, { ok: false, error: 'Refused' }) instanceof LocateRequestRefused);
	for (const status of [409, 500, 502]) assert.ok(!(locateResponseError(status, { ok: false }) instanceof LocateRequestRefused));
	assert.ok(!(locateResponseError(400, {}) instanceof LocateRequestRefused));
});

test('push provider acceptance never claims playback and uncertain native effects never promise automatic replay', () => {
	const command = { id: 'test', requestId: 'request', status: 'succeeded' };
	assert.match(locateReceiptLabel({ command, delivery: { channel: 'apns', status: 'provider-accepted', played: 'not-observed' } }), /Playback has not been confirmed/);
	assert.match(locateReceiptLabel({ command: { ...command, status: 'needs-review' } }), /will not play again automatically/);
	assert.equal(locateReceiptLabel(null), '');
});
