import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePlatformProgram } from './compiler';
const compile = (steps: unknown[]) => compilePlatformProgram({ version: 1, title: 'Malformed structured language nodes', steps });
const returns = (value: unknown) => [{ op: 'return', value }];
test('structured language nodes reject malformed input and combined nesting budgets', () => {
	for (const steps of [
		[{ op: 'function-declaration', name: 'x);throw 1;//', params: [], body: [] }],
		[{ op: 'class', name: 'Example', members: [{ kind: 'field', private: true, name: 'x;throw 1;', value: 0 }] }],
		[{ op: 'class', name: 'Example', members: Array.from({ length: 41 }, (_, n) => ({ kind: 'field', name: 'field' + n })) }],
		[{ op: 'class', name: 'Example', members: [{ kind: 'field', private: true, name: 'constructor' }] }],
		[{ op: 'function-declaration', name: 'example', params: [{ name: 'rest', rest: true }, 'later'], body: [] }],
		[{ op: 'class', name: 'Example', members: [{ kind: 'get', name: 'value', params: ['unexpected'], body: [] }] }],
		returns({ op: 'assign-expression', target: { op: 'call', target: { op: 'global', name: 'Array' }, args: [] }, value: 0 }),
		returns({ op: 'template-literal', strings: ['one', 'two'], values: [] }),
		[
			{
				op: 'switch',
				value: 1,
				cases: [
					{ default: true, body: [] },
					{ default: true, body: [] }
				]
			}
		],
		returns({ op: 'class', extends: { op: 'global', name: 'Function' }, members: [] })
	])
		assert.throws(() => compile(steps));
	let deep: any = { op: 'class', members: [] };
	for (let n = 0; n < 40; n++) deep = { op: 'class', members: [{ kind: 'field', name: 'nested', value: deep }] };
	assert.throws(() => compile(returns(deep)), /complexity budget/);
	let nested: any = 1;
	for (let n = 0; n < 20; n++) nested = { op: 'function-expression', params: [], body: [{ op: 'return', value: nested }] };
	assert.throws(() => compile(returns(nested)), /complexity budget/);
	assert.throws(() => compile([null]), /statement/);
});
