import assert from 'node:assert/strict';
import test from 'node:test';

import { METER_COMMIT_KEYS, isMeterCommitKey, shouldSubmitMeterPercent } from './meterCommit';

test('every range-navigation key commits, other keys do not', () => {
	for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])
		assert.equal(isMeterCommitKey(key), true, `${key} should commit`);
	assert.equal(METER_COMMIT_KEYS.length, 8);
	for (const key of ['Tab', 'Enter', ' ', 'Escape', 'a', 'Shift', 'ArrowRightExtra'])
		assert.equal(isMeterCommitKey(key), false, `${key} should not commit`);
});

test('a first submission is sent', () => {
	assert.equal(shouldSubmitMeterPercent(null, { key: 'token-1', percent: 51 }), true);
});

test('the boundary percents are sent and out-of-range values are rejected', () => {
	assert.equal(shouldSubmitMeterPercent(null, { key: 'token-1', percent: 0 }), true);
	assert.equal(shouldSubmitMeterPercent(null, { key: 'token-1', percent: 100 }), true);
	for (const percent of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
		assert.equal(shouldSubmitMeterPercent(null, { key: 'token-1', percent }), false, `${percent} should be rejected`);
});

test('a missing idempotency token is never submitted', () => {
	assert.equal(shouldSubmitMeterPercent(null, { key: '', percent: 51 }), false);
});

test('the same percent under the same token is suppressed as a duplicate', () => {
	const last = { key: 'token-1', percent: 51 };
	assert.equal(shouldSubmitMeterPercent(last, { key: 'token-1', percent: 51 }), false);
});

test('a different percent under the same token is still submitted', () => {
	const last = { key: 'token-1', percent: 51 };
	assert.equal(shouldSubmitMeterPercent(last, { key: 'token-1', percent: 52 }), true);
});

test('the same percent under a rotated token is submitted again', () => {
	// Dispatching an action rotates the token, so re-selecting a previously sent
	// value (50 -> 30 -> 50) must not be swallowed by duplicate suppression.
	const last = { key: 'token-1', percent: 50 };
	assert.equal(shouldSubmitMeterPercent(last, { key: 'token-2', percent: 50 }), true);
});

test('a repeated keyboard ramp submits once per step', () => {
	let last: { key: string; percent: number } | null = null;
	const sent: number[] = [];
	// One token rotation per dispatched command, mirroring useDeviceStore.
	for (const percent of [51, 52, 53]) {
		const next = { key: `token-${sent.length}`, percent };
		if (!shouldSubmitMeterPercent(last, next)) continue;
		last = next;
		sent.push(percent);
	}
	assert.deepEqual(sent, [51, 52, 53]);
});

test('pointer end and key up for one interaction send a single command', () => {
	let last: { key: string; percent: number } | null = null;
	let sent = 0;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const next = { key: 'token-1', percent: 51 };
		if (!shouldSubmitMeterPercent(last, next)) continue;
		last = next;
		sent += 1;
	}
	assert.equal(sent, 1);
});
