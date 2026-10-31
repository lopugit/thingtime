import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countdownDuration, countdownRemaining } from './nativeControlClock';

test('countdown inputs are finite and bounded', () => {
	assert.equal(countdownDuration(Infinity), 60);
	assert.equal(countdownDuration('bad'), 60);
	assert.equal(countdownDuration(-3), 1);
	assert.equal(countdownDuration(1e9), 604800);
});
test('countdown catches up after a delayed tick and stops at zero', () => {
	assert.equal(countdownRemaining(10000, 1500), 9);
	assert.equal(countdownRemaining(10000, 9900), 1);
	assert.equal(countdownRemaining(10000, 10000), 0);
	assert.equal(countdownRemaining(10000, 30000), 0);
});
