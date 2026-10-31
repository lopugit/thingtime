import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRunInputs } from './actionInputs';
import { copyActionJson, parseActionJson } from '../../../schemas/actionJsonInput';
import { sanitizeActionCrystal } from '../../../schemas/registry';

test('JSON inputs preserve structured form values, literals and explicit null', () => {
	const descriptors = [{ name: 'program', type: 'json', required: true }];
	const value = { steps: [{ op: 'return', value: '$input.private' }], values: [null, false, 0, '', { ttExpr: ['not', true] }] };
	for (const provided of [value, parseActionJson(JSON.stringify(value))]) {
		assert.deepEqual(validateRunInputs(descriptors, { program: provided }), { ok: true, inputs: { program: value } });
	}
	for (const value of [null, false, 0, '', 'literal']) {
		assert.deepEqual(validateRunInputs(descriptors, { program: value }), { ok: true, inputs: { program: value } });
		assert.deepEqual(validateRunInputs(descriptors, { program: parseActionJson(JSON.stringify(value)) }), { ok: true, inputs: { program: value } });
		assert.deepEqual(validateRunInputs([{ ...descriptors[0], default: value }], {}), { ok: true, inputs: { program: value } });
	}
	assert.deepEqual(validateRunInputs(descriptors, { program: null }), { ok: true, inputs: { program: null } });
	assert.deepEqual(validateRunInputs([{ name: '__proto__', type: 'json' }], JSON.parse('{"__proto__":{"inert":true}}')), { ok: true, inputs: JSON.parse('{"__proto__":{"inert":true}}') });
	for (const provided of [{}, { program: '{}', undeclared: true }]) assert.equal(validateRunInputs(descriptors, provided).ok, false);
	assert.deepEqual(validateRunInputs(descriptors, { program: '{' }), { ok: true, inputs: { program: '{' } }, 'API strings stay literal');
});

test('JSON parsing and defaults reject executable objects, cycles and excessive work', () => {
	let accessed = false;
	const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { accessed = true; throw new Error('getter ran'); } });
	const cycle: any = {}; cycle.self = cycle;
	let deep: unknown = null;
	for (let i = 0; i < 66; i++) deep = [deep];
	for (const value of [getter, cycle, deep, new Date(), new Map(), undefined, Infinity, BigInt(1), () => 1, Array(2), Array(4001).fill(0), 'x'.repeat(65537), '🌈'.repeat(20000)]) {
		assert.throws(() => copyActionJson(value));
	}
	assert.equal(accessed, false);
	assert.throws(() => parseActionJson(' '.repeat(65537)));
	const keys = JSON.parse('{"__proto__":{"polluted":true},"constructor":"text","prototype":0}');
	assert.deepEqual(parseActionJson(JSON.stringify(keys)), keys);
	assert.equal(Object.getPrototypeOf(copyActionJson(keys)), Object.prototype);
	assert.equal(({} as any).polluted, undefined);
	const shared = { value: false };
	assert.deepEqual(copyActionJson([shared, shared]), [{ value: false }, { value: false }]);
});

test('saved JSON defaults retain objects, arrays and null through the Action grammar', () => {
	for (const value of [{ title: 'Draft', parameters: [{ default: null }] }, [0, false, ''], null, 'literal']) {
		const result = sanitizeActionCrystal({ name: 'JSON input', inputs: [{ name: 'data', type: 'json', default: value }], steps: [{ op: 'return', value: '$input.data' }] });
		assert.ok(result.ok, result.ok === false ? result.error : '');
		if (result.ok) assert.deepEqual((result.crystal.inputs as any[])[0].default, value);
	}
	const bad = sanitizeActionCrystal({ name: 'Invalid default', inputs: [{ name: 'data', type: 'json', default: { fn: () => 1 } }], steps: [{ op: 'return', value: '$input.data' }] });
	assert.equal(bad.ok, false);
});
