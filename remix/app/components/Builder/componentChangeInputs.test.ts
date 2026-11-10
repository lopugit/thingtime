import assert from 'node:assert/strict';
import test from 'node:test';
import { componentChangeInputs } from './componentChangeInputs';

test('change fills only its declared input path without altering saved inputs', () => {
	const inputs = { op: 'query', params: { view: 'planner', date: 'old' } };
	assert.deepEqual(componentChangeInputs(inputs, 'params.date', '2026-09-24'), { op: 'query', params: { view: 'planner', date: '2026-09-24' } });
	assert.equal(inputs.params.date, 'old');
	assert.deepEqual(componentChangeInputs({}, 'checked', false), { checked: false });
});
test('change paths cannot mutate prototypes or descend into scalar/array inputs', () => {
	for (const path of ['__proto__.x', 'constructor.x', 'params.prototype', 'params..date', 'a.b.c.d.e'])
		assert.equal(componentChangeInputs({}, path, 'value'), null);
	assert.equal(componentChangeInputs({ params: [] }, 'params.date', 'value'), null);
	assert.equal(componentChangeInputs({ params: 'text' }, 'params.date', 'value'), null);
});
