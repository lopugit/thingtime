import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWatchCodeInput, watchCodeSlotCount } from './watchCodeInputCore';

test('Watch code input keeps leading zeros and whole pasted codes', () => {
	assert.equal(normalizeWatchCodeInput(' 01 23\n'), '0123');
	assert.equal(normalizeWatchCodeInput('abcd-2345'), 'ABCD2345');
	assert.equal(normalizeWatchCodeInput('123456789'), '12345678');
	assert.equal(normalizeWatchCodeInput(''), '');
});

test('Watch code input presents four squares, expanding for legacy codes', () => {
	for (const value of ['', '0', '0123']) assert.equal(watchCodeSlotCount(value), 4);
	for (const value of ['A', 'ABCD2345', '12345678']) assert.equal(watchCodeSlotCount(value), 8);
});
