import assert from 'node:assert/strict';
import test from 'node:test';
import { parseThemeHomeContext } from './themeHomeContext';
test('home context accepts only a home destination and bounded receipt plane', () => {
	for (const receiptPlane of ['home', 'custom-' + 'a'.repeat(64)]) {
		const input = { storagePlane: 'home', receiptPlane };
		assert.deepEqual(parseThemeHomeContext(input), input);
		assert.notEqual(parseThemeHomeContext(input), input);
	}
	for (const input of [
		null,
		undefined,
		[],
		{},
		{ storagePlane: 'home' },
		{ storagePlane: 'custom-' + 'a'.repeat(64), receiptPlane: 'home' },
		...['', 'custom-a', 'custom-' + 'A'.repeat(64), 'https://private.example', '../home', 1, null].map((receiptPlane) => ({
			storagePlane: 'home',
			receiptPlane
		})),
		{ storagePlane: 'home', receiptPlane: 'home', ownerId: 'other' },
		{ storagePlane: 'home', receiptPlane: 'home', uri: 'mongodb://other' }
	]) {
		assert.throws(() => parseThemeHomeContext(input), /Invalid home theme context/);
	}
});
