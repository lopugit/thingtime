import type { Feature, PlatformProgram, Recipe } from './types';
import {
	base,
	parameter,
	input,
	get,
	global,
	method,
	returns,
	recipe,
	variable as v,
	object as obj,
	array as arr,
	call,
	declare as decl,
	perform as act
} from './programBuilders';
const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const assignment = (target: unknown, value: unknown, operator = '=') => ({ op: 'assign-expression', target, value, operator });

export function javascriptControlRecipe(f: Feature): Recipe | null {
	if (f.kind !== 'language') return null;
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type));
		return input(name);
	};
	const done = (value: unknown) => recipe({ ...p, steps: [...p.steps!, ...returns(value)] });
	const updateNames: Record<string, { operator: string; prefix: boolean }> = {
		'Postfix Increment Operator': { operator: '++', prefix: false },
		'Postfix Decrement Operator': { operator: '--', prefix: false },
		'Prefix Increment Operator': { operator: '++', prefix: true },
		'Prefix Decrement Operator': { operator: '--', prefix: true }
	};
	if (f.name === 'Update Expressions' || updateNames[f.name]) {
		const initial = param('initial', 'Initial value', 3);
		const example = (options: { operator: string; prefix: boolean }) =>
			call(
				{
					op: 'function-expression',
					params: ['value'],
					body: [decl('returned', { op: 'update', target: v('value'), ...options }), ...returns(obj({ returned: v('returned'), stored: v('value') }))]
				},
				[initial]
			);
		return done(
			f.name === 'Update Expressions'
				? obj(Object.fromEntries(Object.entries(updateNames).map(([name, options]) => [name, example(options)])))
				: example(updateNames[f.name])
		);
	}
	if (f.name === 'Assignment Operators') {
		const initial = param('initial', 'Initial value', 3),
			right = param('right', 'Right operand', 2);
		return done(
			obj(
				Object.fromEntries(
					['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??='].map((operator) => [
						operator,
						call(
							{
								op: 'function-expression',
								params: ['value', 'right'],
								body: [
									decl('returned', assignment(v('value'), v('right'), operator)),
									...returns(obj({ returned: v('returned'), stored: v('value') }))
								]
							},
							[initial, right]
						)
					])
				)
			)
		);
	}
	if (f.name === 'The delete Operator') {
		p.steps!.push(
			decl('object', param('object', 'Object properties', { keep: 1, remove: 2 })),
			decl('deleted', { op: 'delete', target: get(v('object'), param('key', 'Property to delete', 'remove', 'text')) })
		);
		return done(obj({ deleted: v('deleted'), after: v('object') }));
	}
	if (f.name === 'Comma Operator ( , )') {
		p.steps!.push(
			decl('value', param('initial', 'Initial value', 1)),
			decl('returned', { op: 'sequence', items: [assignment(v('value'), param('next', 'Next value', 4)), binary('*', v('value'), 2)] })
		);
		return done(obj({ stored: v('value'), returned: v('returned') }));
	}
	if (f.name === 'Block') {
		p.steps!.push(decl('value', param('outer', 'Outer value', 'outside', 'text')), decl('inside', null), {
			op: 'block',
			body: [decl('value', param('inner', 'Inner value', 'inside', 'text')), { op: 'assign', name: 'inside', value: v('value') }]
		});
		return done(obj({ outside: v('value'), inside: v('inside') }));
	}
	if (f.name === 'Empty Statement') {
		p.steps!.push(decl('value', param('value', 'Value', 3)), { op: 'empty' });
		return done(v('value'));
	}
	if (f.name === 'The do-while Statement') {
		p.steps!.push(decl('count', 0), {
			op: 'do-while',
			test: binary('<', v('count'), param('limit', 'Count up to (body always runs once)', 3, 'number')),
			body: [act({ op: 'update', target: v('count'), operator: '++' })]
		});
		return done(v('count'));
	}
	if (f.name === 'The for Statement') {
		p.steps!.push(decl('visited', arr()), {
			op: 'for',
			init: decl('index', 0),
			test: binary('<', v('index'), param('limit', 'Iteration count', 4, 'number')),
			update: { op: 'update', target: v('index'), operator: '++' },
			body: [act(method(v('visited'), 'push', [v('index')]))]
		});
		return done(v('visited'));
	}
	if (f.name === 'The for-in, for-of, and for-await-of Statements') {
		const source = param('source', 'Object for property enumeration', { one: 1, two: 2 }),
			values = param('values', 'Values to iterate', [1, 2, 3]);
		p.steps!.push(
			decl('keys', arr()),
			decl('sync', arr()),
			decl('async', arr()),
			{ op: 'for-in', name: 'key', value: source, body: [act(method(v('keys'), 'push', [v('key')]))] },
			{ op: 'for-of', name: 'value', value: values, body: [act(method(v('sync'), 'push', [v('value')]))] },
			{
				op: 'for-await-of',
				name: 'value',
				value: method(values, 'map', [{ op: 'function', params: ['value'], value: method(global('Promise'), 'resolve', [v('value')]) }]),
				body: [act(method(v('async'), 'push', [v('value')]))]
			}
		);
		return done(obj({ keys: v('keys'), values: v('sync'), awaitedValues: v('async') }));
	}
	if (f.name === 'The switch Statement') {
		p.steps!.push(decl('log', arr()), {
			op: 'switch',
			value: param('choice', 'Choose one, two or another value', 'one', 'text'),
			cases: [
				{ test: 'one', body: [act(method(v('log'), 'push', ['one: falls through']))] },
				{ test: 'two', body: [act(method(v('log'), 'push', ['two: break'])), { op: 'break' }] },
				{ default: true, body: [act(method(v('log'), 'push', ['default']))] }
			]
		});
		return done(v('log'));
	}
	if (f.name === 'Labelled Statements') {
		p.steps!.push(decl('visited', arr()), {
			op: 'label',
			name: 'outer',
			body: {
				op: 'for-of',
				name: 'item',
				value: param('items', 'Values', [1, 2, 3, 4]),
				body: [
					{
						op: 'for-of',
						name: 'inner',
						value: arr('a', 'b'),
						body: [
							{ op: 'if', test: binary('===', v('item'), param('stop', 'Break outer loop at value', 3)), then: [{ op: 'break', label: 'outer' }] },
							act(method(v('visited'), 'push', [obj({ outer: v('item'), inner: v('inner') })]))
						]
					}
				]
			}
		});
		return done(v('visited'));
	}
	return null;
}
