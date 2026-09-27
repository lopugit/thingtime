import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { callbackData, createSynchronousCallback, SYNC_CALLBACK_LIMITS } from './synchronousCallback';
import { compilePlatformProgram } from './compiler';
import { variable as v, input, get, method, returns } from './programBuilders';

const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const create = (
	definition: unknown,
	inputs: unknown = {},
	dom: (request: any) => unknown = () => {
		throw Error('Unexpected DOM request');
	}
) => {
	let charged = 0;
	return createSynchronousCallback(definition, inputs, {
		dom,
		charge: () => {
			if (++charged > SYNC_CALLBACK_LIMITS.totalSteps) throw Error('Total budget');
		}
	});
};
test('synchronous callback data uses the same local bindings, loops and catch grammar as worker programs', () => {
	const body = [
		{ op: 'let', name: 'total', value: 0 },
		{
			op: 'for-of',
			name: 'item',
			value: input('values'),
			body: [
				{ op: 'if', test: binary('<', v('item'), 0), then: [{ op: 'continue' }] },
				{ op: 'assign', name: 'total', value: binary('+', v('total'), v('item')) }
			]
		},
		{
			op: 'try',
			body: [{ op: 'throw', value: 'deliberate' }],
			error: 'caught',
			catch: [{ op: 'if', test: binary('===', v('caught'), 'deliberate'), then: returns(v('total')) }]
		}
	];
	const definition = { op: 'function', params: [], body };
	const inputs = { values: [1, -10, 3, 8] };
	const workerValue = vm.runInNewContext('(function(){' + compilePlatformProgram({ version: 1, title: 'grammar', steps: body }) + '})()', {
		input: inputs
	});
	assert.equal(create(definition, inputs).invoke([], null), workerValue);
});
test('callback branches short-circuit, retain native DOM identity and propagate errors through finally', () => {
	const dom = { op: 'dom', action: 'get', target: v('node'), key: 'nodeName' };
	const fn = create(
		{ op: 'function', params: ['node'], value: { op: 'conditional', test: input('enabled'), then: dom, else: 'disabled' } },
		{ enabled: false },
		() => {
			throw new TypeError('native');
		}
	);
	assert.equal(fn.invoke([{ $dom: 'owned', type: 'Element' }], null), 'disabled');
	fn.setInputs({ enabled: true });
	assert.throws(() => fn.invoke([], null), TypeError);
	const handled = create({ op: 'function', params: [], body: [{ op: 'try', body: [{ op: 'throw', value: 'x' }], catch: [], finally: returns(3) }] });
	assert.equal(handled.invoke([], null), 3);
	const identity = create(
		{ op: 'function', params: ['node'], value: binary('===', v('node'), input('node')) },
		{ node: { $dom: 'a', type: 'Element' } }
	);
	assert.equal(identity.invoke([{ $dom: 'a', type: 'Element' }], null), true);
});
test('callback registration copies definitions and bindings without invoking accessors', () => {
	const definition = { op: 'function', params: [], value: input('name') },
		data = { name: 'before' };
	const fn = create(definition, data);
	data.name = 'after';
	definition.value.name = 'other';
	assert.equal(fn.invoke([], null), 'before');
	let read = false;
	assert.throws(
		() =>
			callbackData({
				get secret() {
					read = true;
					return 1;
				}
			}),
		/accessors/
	);
	assert.equal(read, false);
	assert.throws(() => callbackData({ ['k'.repeat(4097)]: 1 }), /text budget/);
	assert.throws(() => callbackData(Object.fromEntries(Array.from({ length: 64 }, (_, i) => ['k'.repeat(1100) + i, 1]))), /text budget/);
	for (const unsafe of [JSON.parse('{"__proto__":{}}'), new Date(), { v: () => 1 }, 'a'.repeat(4097), Array(65).fill(1)])
		assert.throws(() => callbackData(unsafe));
	assert.throws(() => create({ op: 'function', params: [], value: { op: 'global', name: 'fetch' } }), /Unsupported/);
	assert.throws(() => create({ op: 'function', params: [], value: get(input('data'), 'constructor') }, { data: {} }).invoke([], null), /prototype/);
});
test('loops and recursive array output cannot evade callback budgets', () => {
	const loop = create({ op: 'function', params: [], body: [{ op: 'while', test: true, body: [] }] });
	assert.throws(() => loop.invoke([], null), /execution budget/);
	const growth = create({
		op: 'function',
		params: [],
		body: [
			{ op: 'let', name: 'list', value: { op: 'array', items: [] } },
			{ op: 'expression', value: method(v('list'), 'push', [v('list')]) },
			...returns(method(v('list'), 'join', ['']))
		]
	});
	assert.throws(() => growth.invoke([], null), /primitive items/);
	const cyclicReturn = create({
		op: 'function',
		params: [],
		body: [
			{ op: 'let', name: 'list', value: { op: 'array', items: [] } },
			{ op: 'expression', value: method(v('list'), 'push', [v('list')]) },
			...returns(v('list'))
		]
	});
	assert.throws(() => cyclicReturn.invoke([], null), /data budget/);
	const caught = create({
		op: 'function',
		params: [],
		body: [{ op: 'while', test: true, body: [{ op: 'try', body: [{ op: 'while', test: true, body: [] }], catch: [] }] }]
	});
	assert.throws(() => caught.invoke([], null), /budget/);
});
