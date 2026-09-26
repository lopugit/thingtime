import type { Feature, Recipe } from './types';
import { parameter, global, input, get, method, make, returns, base, recipe } from './programBuilders';
import { javascriptFixture } from './javascriptFixtures';
import { javascriptSymbolRecipe } from './javascriptSymbols';
import { javascriptSyntaxRecipe } from './javascriptSyntax';
import { javascriptDefinitionsRecipe } from './javascriptDefinitions';
import { javascriptControlRecipe } from './javascriptControl';
import { javascriptReceiverRecipe } from './javascriptReceiverFixtures';
import { javascriptPrototypeRecipe } from './javascriptPrototypeFixtures';
import { javascriptTypedArrayRecipe } from './javascriptTypedArrayFixtures';
import { javascriptIteratorRecipe } from './javascriptIteratorFixtures';
export function javascriptRecipe(f: Feature): Recipe {
	const p = base(f),
		name = f.name
			.replace(/^get |^set /, '')
			.split(' (')[0]
			.trim();
	const parts = name.split('.');
	const specialized =
		javascriptTypedArrayRecipe(f) ||
		javascriptIteratorRecipe(f) ||
		javascriptPrototypeRecipe(f) ||
		javascriptReceiverRecipe(f) ||
		javascriptDefinitionsRecipe(f) ||
		javascriptControlRecipe(f) ||
		javascriptSyntaxRecipe(f) ||
		javascriptSymbolRecipe(f) ||
		javascriptFixture(f, name);
	if (specialized) return specialized;
	if (
		f.kind === 'built-in' &&
		parts.length >= 2 &&
		!['[', ']', '%', ' '].some((char) => name.includes(char)) &&
		parts.every((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v))
	) {
		p.requires = [[parts[0]]];
		const root = parts[0],
			member = parts.at(-1)!;
		if (['constructor', '__proto__'].includes(member) || ['Function', 'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(root))
			return recipe(
				{
					...p,
					steps: returns({ op: 'unary', operator: 'typeof', value: { op: 'function', params: ['value'], value: { op: 'variable', name: 'value' } } })
				},
				'inspection',
				'Functions are reusable declarative function nodes. Executable source strings are not accepted.'
			);
		p.requires = [parts];
		let target: any = global(root);
		const prototype = parts[1] === 'prototype';
		const receivers: Record<string, unknown> = {
			Array: [3, 1, 4, 1, 5],
			String: 'Hello Thingtime 🌈',
			Number: 123.456,
			Boolean: true,
			Object: { hello: 'world', count: 3 },
			BigInt: '123',
			Date: '2026-09-23T12:00:00Z',
			RegExp: '[a-z]+',
			Map: [
				['one', 1],
				['two', 2]
			],
			Set: [1, 2, 3],
			Uint8Array: [1, 2, 3, 255],
			Int8Array: [1, 2, 3],
			Int16Array: [1, 2, 3],
			Uint16Array: [1, 2, 3],
			Int32Array: [1, 2, 3],
			Uint32Array: [1, 2, 3],
			Float32Array: [1, 2, 3],
			Float64Array: [1, 2, 3],
			ArrayBuffer: 8,
			SharedArrayBuffer: 8
		};
		p.parameters = [];
		if (prototype) {
			if (!(root in receivers))
				return recipe(
					{ ...p, steps: returns({ op: 'unary', operator: 'typeof', value: get(get(global(root), 'prototype'), member) }) },
					'requires-context',
					'This method needs a suitable receiver. Edit the declarative program to construct one.'
				);
			p.parameters.push(
				parameter(
					'receiver',
					'Receiver',
					receivers[root],
					['String', 'Date', 'RegExp', 'BigInt'].includes(root) ? 'text' : typeof receivers[root] === 'number' ? 'number' : 'json'
				)
			);
			if (['Array', 'String', 'Number', 'Boolean', 'Object'].includes(root)) target = input('receiver');
			else if (root === 'BigInt') target = { op: 'call', target: global('BigInt'), args: [input('receiver')] };
			else target = make(root, [input('receiver')]);
		} else for (const part of parts.slice(1, -1)) target = get(target, part);
		const callable = /\(/.test(f.name);
		if (!callable) {
			p.steps = returns(get(target, member));
			return recipe(p);
		}
		let args: unknown[] = [];
		let values: unknown[] = [];
		const callbackMethods = [
			'map',
			'filter',
			'find',
			'findIndex',
			'findLast',
			'findLastIndex',
			'some',
			'every',
			'forEach',
			'flatMap',
			'reduce',
			'reduceRight',
			'sort',
			'toSorted'
		];
		if (prototype && root === 'Array' && callbackMethods.includes(member)) {
			const reduce = member.startsWith('reduce');
			const compare = ['sort', 'toSorted'].includes(member);
			const fn = {
				op: 'function',
				params: reduce || compare ? ['a', 'b'] : ['value'],
				value: {
					op: 'binary',
					operator: reduce
						? '+'
						: compare
						? '-'
						: ['filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every'].includes(member)
						? '>'
						: '*',
					left: { op: 'variable', name: reduce || compare ? 'a' : 'value' },
					right: reduce || compare ? { op: 'variable', name: 'b' } : 2
				}
			};
			args = reduce ? [fn, 0] : [fn];
		} else {
			const samples: Record<string, unknown[]> = {
				at: [1],
				concat: [[6, 7]],
				copyWithin: [0, 2],
				fill: [9, 1, 3],
				flat: [1],
				includes: [root === 'String' ? 'Thingtime' : 3],
				indexOf: [root === 'String' ? 'Thingtime' : 1],
				lastIndexOf: [1],
				join: [' · '],
				slice: [1, 4],
				splice: [1, 1, 9],
				toSpliced: [1, 1, 9],
				with: [1, 9],
				push: [9],
				unshift: [9],
				split: [' '],
				replace: ['Thingtime', 'Builder'],
				replaceAll: ['l', 'L'],
				startsWith: ['Hello'],
				endsWith: ['🌈'],
				padStart: [24, '·'],
				padEnd: [24, '·'],
				repeat: [2],
				substring: [0, 5],
				charAt: [1],
				charCodeAt: [1],
				codePointAt: [16],
				normalize: ['NFC'],
				match: ['[A-Z][a-z]+'],
				matchAll: ['[a-z]+'],
				search: ['Thingtime'],
				localeCompare: ['Hello'],
				toFixed: [2],
				toPrecision: [4],
				toExponential: [2],
				toString: root === 'Number' ? [16] : [],
				test: ['hello'],
				exec: ['hello'],
				get: ['one'],
				set: ['three', 3],
				has: [root === 'Map' ? 'one' : 2],
				add: [4],
				delete: [root === 'Map' ? 'one' : 2],
				from: [[1, 2, 3]],
				of: [1, 2, 3],
				isArray: [[1, 2]],
				keys: [{ one: 1, two: 2 }],
				values: [{ one: 1, two: 2 }],
				entries: [{ one: 1, two: 2 }],
				fromEntries: [
					[
						['one', 1],
						['two', 2]
					]
				],
				assign: [{ one: 1 }, { two: 2 }],
				groupBy: [[1, 2, 3]],
				parse: ['{"hello":"Thingtime"}'],
				stringify: [{ hello: 'Thingtime', count: 3 }],
				parseInt: ['42', 10],
				parseFloat: ['3.14'],
				isFinite: [42],
				isNaN: [42],
				isInteger: [42],
				isSafeInteger: [42],
				abs: [-42],
				ceil: [3.14],
				floor: [3.14],
				round: [3.6],
				trunc: [3.14],
				sign: [-42],
				sqrt: [16],
				cbrt: [27],
				pow: [2, 8],
				max: [1, 5, 3],
				min: [1, 5, 3],
				hypot: [3, 4],
				imul: [3, 4],
				atan2: [1, 1],
				clz32: [1],
				fround: [1.337]
			};
			values = Object.prototype.hasOwnProperty.call(samples, member)
				? samples[member]
				: /^(sin|cos|tan|a?cos|a?sin|a?tan|log|exp|sinh|cosh|tanh)/.test(member)
				? [0.5]
				: [];
			if (prototype && ['keys', 'values', 'entries'].includes(member)) values = [];
			p.parameters.push(parameter('arguments', 'Arguments (JSON array)', values, 'json'));
			args = [{ op: 'spread', value: input('arguments') }];
		}
		let result: any = method(target, member, args);
		if (['entries', 'keys', 'values', 'matchAll'].includes(member) && prototype) result = method(global('Array'), 'from', [result]);
		p.steps = returns(result);
		return recipe(
			p,
			'interactive',
			'Runs this built-in with an editable receiver and arguments. Unsupported methods and invalid argument combinations return the browser error.'
		);
	}
	return recipe(
		{
			...p,
			parameters: [parameter('value', 'Value to inspect', { hello: 'Thingtime', values: [1, 2, 3] }, 'json')],
			steps: returns({
				op: 'object',
				entries: [
					['value', input('value')],
					['type', { op: 'unary', operator: 'typeof', value: input('value') }]
				]
			})
		},
		'inspection',
		'This specification clause is indexed. This value inspector is not a worked example of the complete clause.'
	);
}
