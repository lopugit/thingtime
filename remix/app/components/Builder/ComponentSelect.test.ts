import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionOptions } from './ComponentSelect';
test('reference choices retain values beyond the template repetition limit', () => {
	const data = Array.from({ length: 5000 }, (_, i) => ({ id: `id-${i}`, profile: { label: `Choice ${i}` } }));
	const options = selectionOptions(data, 'id', 'profile.label');
	assert.equal(options.length, 5000);
	assert.deepEqual(options.at(-1), { value: 'id-4999', label: 'Choice 4999' });
});
test('selection paths never read inherited values and excessive lists fail visibly', () => {
	assert.deepEqual(selectionOptions([Object.create({ id: 'inherited', title: 'hidden' })]), []);
	assert.deepEqual(selectionOptions([{ id: 'x', title: 'X' }], 'constructor'), []);
	assert.throws(() => selectionOptions(Array(10001).fill({ id: 'x' })), /10,000/);
});
