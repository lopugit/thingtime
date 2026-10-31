import assert from 'node:assert/strict';
import test from 'node:test';
import { componentDragData, componentDropInputs } from './componentDragInputs';

test('drops forward only configured scalar source fields inside the same group', () => {
	const drag = componentDragData('visits', { id: 'v', revision: 'stamp', ignored: 'keep private' });
	assert.deepEqual(componentDropInputs(drag, 'visits', ['id', 'revision'], { date: '2026-09-23', id: 'target' }), {
		date: '2026-09-23',
		id: 'v',
		revision: 'stamp'
	});
	for (const allowed of [['unknown'], ['constructor'], Array(17).fill('id')]) assert.equal(componentDropInputs(drag, 'visits', allowed, {}), null);
	assert.equal(componentDropInputs(drag, 'another', ['id'], {}), null);
	assert.equal(componentDropInputs(null, 'visits', ['id'], {}), null);
});
test('drag values reject executable, nested, oversized and prototype-shaped input', () => {
	for (const inputs of [{ nested: {} }, { list: [] }, { value: Infinity }, { value: 'x'.repeat(2001) }, JSON.parse('{"__proto__":"x"}')])
		assert.equal(componentDragData('visits', inputs), null);
	assert.equal(componentDragData('', { id: 'x' }), null);
});
