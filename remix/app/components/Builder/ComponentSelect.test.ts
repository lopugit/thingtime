import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionOptions, selectionPatch } from './ComponentSelect';
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

test('selection fills preserve typed drafts and resolve only safe scalar fields', () => {
	const item = { title: 'Trim hedges', details: { minutes: 45 } };
	assert.deepEqual(selectionPatch([{ key: 'titleDraft', path: 'title', whenEmpty: true, current: '' }], item), { titleDraft: 'Trim hedges' });
	assert.deepEqual(selectionPatch([{ key: 'titleDraft', path: 'title', whenEmpty: true, current: 'My visit' }], item), {});
	assert.deepEqual(selectionPatch([{ key: 'durationDraft', path: 'details.minutes' }], item), { durationDraft: 45 });
	assert.deepEqual(
		selectionPatch(
			[
				{ key: 'constructor', path: 'title' },
				{ key: 'bad', path: 'constructor.name' },
				{ key: 'object', path: 'details' }
			],
			item
		),
		{}
	);
});
