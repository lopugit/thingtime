import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { wishSlotMusing } from './fallbacks.ts';

test('11:11 hits the make-a-wish slot morning and night', () => {
	assert.match(wishSlotMusing('11:11 AM') || '', /wish/i);
	assert.match(wishSlotMusing('11:11 PM') || '', /wish/i);
});

test('midnight exactly gets its own slot', () => {
	assert.match(wishSlotMusing('12:00 AM') || '', /midnight/i);
});

test('every other minute stays on the normal rotation', () => {
	for (const time of ['11:10 AM', '11:12 PM', '12:00 PM', '12:01 AM', '1:11 AM', '3:33 PM']) {
		assert.equal(wishSlotMusing(time), null, time);
	}
});
