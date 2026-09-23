import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { compilePlatformWorker } from './workerSource';
const v = (name: string) => ({ op: 'variable', name });
const get = (target: unknown, key: unknown) => ({ op: 'get', target, key });
const call = (target: unknown, args: unknown[] = []) => ({ op: 'call', target, args });
const method = (target: unknown, key: string, args: unknown[] = []) => ({ op: 'method', target, key, args });
const make = (target: unknown, args: unknown[] = []) => ({ op: 'new', target, args });
const assign = (target: unknown, value: unknown, operator = '=') => ({ op: 'assign-expression', target, value, operator });
const act = (value: unknown) => ({ op: 'expression', value });
const decl = (name: string, value: unknown) => ({ op: 'let', name, value });
const ret = (value: unknown) => ({ op: 'return', value });
const obj = (entries: Record<string, unknown>) => ({ op: 'object', entries: Object.entries(entries) });
const arr = (...items: unknown[]) => ({ op: 'array', items });
const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const self = { op: 'this' };
const priv = (name: string, target: unknown = self) => ({ op: 'private-get', name, target });
const awaited = (value: unknown) => ({ op: 'await', value });
async function run(steps: unknown[]) {
	let result: any;
	const source = compilePlatformWorker({ version: 1, title: 'Language primitive scratch check', steps });
	await vm.runInNewContext(source + ';onmessage({data:{}})', { postMessage: (value: unknown) => (result = value) }, { timeout: 1000 });
	assert.equal(result.ok, true, JSON.stringify(result));
	return JSON.parse(JSON.stringify(result.result));
}
test('structured class, function and control flow nodes preserve native language semantics', async () => {
	const classes = [
		{
			op: 'class',
			name: 'Base',
			members: [
				{ kind: 'constructor', params: ['value'], body: [act(assign(get(self, 'value'), v('value')))] },
				{ kind: 'method', name: 'describe', params: [], body: [ret(binary('+', 'value=', get(self, 'value')))] }
			]
		},
		{
			op: 'class',
			name: 'Example',
			extends: v('Base'),
			members: [
				{ kind: 'field', name: 'secret', private: true, value: 2 },
				{ kind: 'field', name: 'count', static: true, value: 0 },
				{ kind: 'static-block', body: [act(assign(get(self, 'count'), 1))] },
				{
					kind: 'constructor',
					params: [{ name: 'value', default: 3 }],
					body: [act({ op: 'super-call', args: [v('value')] }), act(assign(priv('secret'), v('value')))]
				},
				{ kind: 'get', name: 'doubled', params: [], body: [ret(binary('*', priv('secret'), 2))] },
				{ kind: 'set', name: 'doubled', params: ['value'], body: [act(assign(priv('secret'), binary('/', v('value'), 2)))] },
				{ kind: 'method', name: 'describe', params: [], body: [ret(binary('+', call({ op: 'super-get', key: 'describe' }), '!'))] },
				{ kind: 'method', name: 'hasSecret', static: true, params: ['other'], body: [ret({ op: 'private-in', name: 'secret', target: v('other') })] },
				{
					kind: 'method',
					name: 'values',
					generator: true,
					params: [],
					body: [act({ op: 'yield', value: priv('secret') }), act({ op: 'yield', value: arr(4, 5), delegate: true })]
				}
			]
		},
		decl('item', make(v('Example'), [7])),
		act(assign(get(v('item'), 'doubled'), 20)),
		ret(
			obj({
				value: get(v('item'), 'value'),
				doubled: get(v('item'), 'doubled'),
				description: method(v('item'), 'describe'),
				count: get(v('Example'), 'count'),
				brand: method(v('Example'), 'hasSecret', [v('item')]),
				otherBrand: method(v('Example'), 'hasSecret', [obj({})]),
				values: method(v('Array'), 'from', [method(v('item'), 'values')])
			})
		)
	];
	assert.deepEqual(await run(classes), {
		value: 7,
		doubled: 20,
		description: 'value=7!',
		count: 1,
		brand: true,
		otherBrand: false,
		values: [10, 4, 5]
	});
	assert.deepEqual(
		await run([
			{
				op: 'function-declaration',
				name: 'collect',
				params: [
					{ name: 'prefix', default: 'default' },
					{ name: 'items', rest: true }
				],
				body: [ret(obj({ prefix: v('prefix'), items: v('items') }))]
			},
			ret(call(v('collect'), ['custom', 1, 2]))
		]),
		{ prefix: 'custom', items: [1, 2] }
	);
	assert.equal(
		await run([
			{ op: 'function-declaration', name: 'Example', params: [], body: [act(assign(get(self, 'newTarget'), get({ op: 'new-target' }, 'name')))] },
			ret(get(make(v('Example')), 'newTarget'))
		]),
		'Example'
	);
	assert.deepEqual(
		await run([
			decl(
				'generator',
				call({
					op: 'function-expression',
					generator: true,
					async: true,
					params: [],
					body: [act({ op: 'yield', value: awaited(method(v('Promise'), 'resolve', [8])) }), ret(9)]
				})
			),
			decl('first', awaited(method(v('generator'), 'next'))),
			decl('second', awaited(method(v('generator'), 'next'))),
			ret(obj({ first: v('first'), second: v('second') }))
		]),
		{ first: { value: 8, done: false }, second: { value: 9, done: true } }
	);
	assert.equal(
		await run([
			decl('Holder', {
				op: 'class',
				members: [
					{ kind: 'field', name: 'x', value: 4 },
					{ kind: 'method', name: 'speak', params: [], body: [ret(get(self, 'x'))] }
				]
			}),
			ret(method(make(v('Holder')), 'speak'))
		]),
		4
	);
	assert.deepEqual(
		await run([
			decl('values', arr()),
			{
				op: 'for',
				init: decl('i', 0),
				test: binary('<', v('i'), 3),
				update: { op: 'update', target: v('i'), operator: '++' },
				body: [act(method(v('values'), 'push', [v('i')]))]
			},
			decl('sum', 0),
			{
				op: 'for-await-of',
				name: 'item',
				value: arr(method(v('Promise'), 'resolve', [2]), method(v('Promise'), 'resolve', [3])),
				body: [act(assign(v('sum'), v('item'), '+='))]
			},
			ret(obj({ values: v('values'), sum: v('sum') }))
		]),
		{ values: [0, 1, 2], sum: 5 }
	);
	assert.deepEqual(
		await run([
			decl('value', 1),
			decl('postfix', { op: 'update', target: v('value'), operator: '++' }),
			decl('prefix', { op: 'update', target: v('value'), operator: '++', prefix: true }),
			decl('object', obj({ remove: true, keep: true })),
			decl('removed', { op: 'delete', target: get(v('object'), 'remove') }),
			ret(obj({ postfix: v('postfix'), prefix: v('prefix'), final: v('value'), removed: v('removed'), object: v('object') }))
		]),
		{ postfix: 1, prefix: 3, final: 3, removed: true, object: { keep: true } }
	);
	assert.deepEqual(
		await run([
			decl('visits', arr()),
			{
				op: 'label',
				name: 'outer',
				body: {
					op: 'for-of',
					name: 'value',
					value: arr(1, 2, 3),
					body: [
						{
							op: 'switch',
							value: v('value'),
							cases: [
								{ test: 1, body: [act(method(v('visits'), 'push', ['one'])), { op: 'break' }] },
								{ test: 2, body: [act(method(v('visits'), 'push', ['two'])), { op: 'break', label: 'outer' }] },
								{ default: true, body: [act(method(v('visits'), 'push', ['other']))] }
							]
						}
					]
				}
			},
			decl('count', 0),
			{ op: 'do-while', test: false, body: [act(assign(v('count'), 1, '+='))] },
			ret(obj({ visits: v('visits'), count: v('count') }))
		]),
		{ visits: ['one', 'two'], count: 1 }
	);
	assert.equal(
		await run([ret({ op: 'template-literal', strings: ['a` ${literal}\\ newline\n', ' end'], values: [null] })]),
		'a` ${literal}\\ newline\nnull end'
	);
	assert.deepEqual(
		await run([
			ret({
				op: 'tagged-template',
				strings: ['first\n', 'last'],
				values: [4],
				tag: {
					op: 'function-expression',
					params: ['strings', 'value'],
					body: [ret(obj({ cooked: v('strings'), raw: get(v('strings'), 'raw'), value: v('value') }))]
				}
			})
		]),
		{ cooked: ['first\n', 'last'], raw: ['first\\n', 'last'], value: 4 }
	);
});
