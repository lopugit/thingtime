import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { filterListV2ChecklistToolbox } from './editorJsToolbox.ts';

test('removes only List v2 checklist toolbox entries', () => {
	const unordered = { title: 'Unordered List', data: { style: 'unordered' } };
	const checklist = { title: 'Checklist', data: { style: 'checklist' } };
	const ordered = { title: 'Ordered List', data: { style: 'ordered' } };
	const checklistWithExtraData = { title: 'Another checklist alias', data: { style: 'checklist', preserved: true } };
	const titleOnly = { title: 'Checklist' };
	const topLevelStyle = { title: 'Not List v2 data', style: 'checklist' };
	const wrongCase = { title: 'Case-sensitive style', data: { style: 'Checklist' } };
	const input = [unordered, checklist, ordered, checklistWithExtraData, titleOnly, topLevelStyle, wrongCase, null, 'custom'];

	const filtered = filterListV2ChecklistToolbox(input);

	assert.deepEqual(filtered, [unordered, ordered, titleOnly, topLevelStyle, wrongCase, null, 'custom']);
	assert.equal(filtered[0], unordered);
	assert.equal(filtered[1], ordered);
});

test('preserves an array reference when it contains no checklist alias', () => {
	const toolbox = [{ data: { style: 'unordered' } }, { data: { style: 'ordered' } }];
	assert.equal(filterListV2ChecklistToolbox(toolbox), toolbox);
});

test('preserves non-array toolbox values exactly', () => {
	const objectValue = { data: { style: 'checklist' } };
	for (const value of [undefined, null, false, 0, 'checklist', objectValue]) {
		assert.equal(filterListV2ChecklistToolbox(value), value);
	}
});
