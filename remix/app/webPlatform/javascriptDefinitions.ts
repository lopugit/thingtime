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
	awaited as wait,
	declare as decl,
	perform as act,
	arrayPattern,
	objectPattern,
	defaultPattern
} from './programBuilders';

const self = { op: 'this' };
const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const assign = (target: unknown, value: unknown, operator = '=') => ({ op: 'assign-expression', target, value, operator });
const make = (target: unknown, args: unknown[] = []) => ({ op: 'new', target, args });
const privateValue = (name: string, target: unknown = self) => ({ op: 'private-get', name, target });

export function javascriptDefinitionsRecipe(f: Feature): Recipe | null {
	if (f.kind !== 'language') return null;
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type));
		return input(name);
	};
	const done = (
		value: unknown,
		note = 'This complete editable program compiles structured language nodes and runs them in a fresh isolated worker.'
	) => recipe({ ...p, steps: [...p.steps!, ...returns(value)] }, 'interactive', note);
	if (f.name === 'Template Literals' || f.name === 'Tagged Templates') {
		const template = {
			op: 'template-literal',
			strings: ['Hello ', '!\nCount: ', '.'],
			values: [param('name', 'Name', 'Thingtime', 'text'), param('count', 'Count', 3, 'number')]
		};
		if (f.name === 'Template Literals') return done(template);
		return done(
			{
				...template,
				op: 'tagged-template',
				tag: {
					op: 'function-expression',
					params: ['strings', { name: 'values', rest: true }],
					body: returns(obj({ cooked: v('strings'), raw: get(v('strings'), 'raw'), values: v('values') }))
				}
			},
			'The tag receives real cooked/raw segment arrays and uncoerced substitution values. The editable segments are cooked strings; the compiler encodes their source escapes.'
		);
	}
	if (['Function Definitions', 'Function Defining Expressions', 'Async Function Definitions'].includes(f.name)) {
		const definition = {
			op: f.name === 'Function Defining Expressions' ? 'function-expression' : 'function-declaration',
			name: 'double',
			params: ['value'],
			async: f.name === 'Async Function Definitions',
			body: returns(binary('*', v('value'), 2))
		};
		if (definition.op === 'function-declaration') p.steps!.push(definition);
		else p.steps!.push(decl('double', definition));
		return done(wait(call(v('double'), [param('value', 'Value to double', 7, 'number')])));
	}
	if (f.name === 'Parameter Lists') {
		p.steps!.push({
			op: 'function-declaration',
			name: 'describe',
			params: [
				{ name: 'label', default: 'default label' },
				{ pattern: objectPattern([{ key: 'enabled', target: defaultPattern('enabled', true) }]), default: obj({}) },
				{ pattern: arrayPattern(['first'], 'tail'), rest: true }
			],
			body: returns(obj({ label: v('label'), enabled: v('enabled'), first: v('first'), tail: v('tail') }))
		});
		return done(
			obj({
				omitted: call(v('describe')),
				supplied: call(v('describe'), [
					param('label', 'Label', 'Thingtime', 'text'),
					param('settings', 'Destructured options', { enabled: false }, 'json'),
					{ op: 'spread', value: param('items', 'Rest values', [1, 2, 3]) }
				])
			}),
			'Compare omitted arguments with a supplied default parameter, an object binding pattern and a destructured rest array. Undefined triggers defaults; null remains a value or causes a native destructuring error.'
		);
	}
	if (f.name === 'The this Keyword') {
		const fn = { op: 'function-expression', params: ['amount'], body: returns(binary('+', get(self, 'value'), v('amount'))) };
		return done(
			method(global('Reflect'), 'apply', [
				fn,
				obj({ value: param('base', 'Receiver value', 3, 'number') }),
				arr(param('amount', 'Amount to add', 4, 'number'))
			])
		);
	}
	if (f.name === 'Meta Properties') {
		p.steps!.push({
			op: 'function-declaration',
			name: 'Example',
			params: [],
			body: [act(assign(get(self, 'constructedBy'), get({ op: 'new-target' }, 'name')))]
		});
		return done(
			get(make(v('Example')), 'constructedBy'),
			'This example observes new.target in a constructor. import.meta requires module authoring support and is not covered here.'
		);
	}
	if (['Generator Function Definitions', 'Async Generator Function Definitions'].includes(f.name)) {
		const async = f.name.startsWith('Async');
		const chunk = binary('*', v('item'), param('factor', 'Multiplier', 2, 'number'));
		p.steps!.push({
			op: 'function-declaration',
			name: 'values',
			params: ['items'],
			generator: true,
			async,
			body: [
				{
					op: 'for-of',
					name: 'item',
					value: v('items'),
					body: [act({ op: 'yield', value: async ? wait(method(global('Promise'), 'resolve', [chunk])) : chunk })]
				}
			]
		});
		const iterator = call(v('values'), [param('items', 'Values to yield', [1, 2, 3])]);
		if (async) p.requires = [['Array', 'fromAsync']];
		return done(async ? wait(method(global('Array'), 'fromAsync', [iterator])) : method(global('Array'), 'from', [iterator]));
	}
	if (f.name === 'The super Keyword') {
		p.steps!.push({
			op: 'class',
			name: 'Base',
			members: [
				{ kind: 'constructor', params: ['name'], body: [act(assign(get(self, 'name'), v('name')))] },
				{ kind: 'method', name: 'greet', params: [], body: returns(binary('+', 'Hello ', get(self, 'name'))) }
			]
		});
		p.steps!.push({
			op: 'class',
			name: 'Derived',
			extends: v('Base'),
			members: [
				{ kind: 'constructor', params: ['name'], body: [act({ op: 'super-call', args: [v('name')] })] },
				{
					kind: 'method',
					name: 'greet',
					params: [],
					body: returns(binary('+', call({ op: 'super-get', key: 'greet' }), param('suffix', 'Greeting suffix', '!', 'text')))
				}
			]
		});
		return done(method(make(v('Derived'), [param('name', 'Name', 'Thingtime', 'text')]), 'greet'));
	}
	if (f.name === 'Class Definitions' || f.name === 'Method Definitions') {
		p.steps!.push({
			op: 'class',
			name: 'Counter',
			members: [
				{ kind: 'field', private: true, name: 'value', value: 0 },
				{ kind: 'field', static: true, name: 'instances', value: 0 },
				{ kind: 'field', static: true, name: 'kind' },
				{ kind: 'static-block', body: [act(assign(get(self, 'kind'), 'Counter'))] },
				{
					kind: 'constructor',
					params: ['initial'],
					body: [act(assign(privateValue('value'), v('initial'))), act(assign(get(v('Counter'), 'instances'), 1, '+='))]
				},
				{ kind: 'get', name: 'current', params: [], body: returns(privateValue('value')) },
				{ kind: 'set', name: 'current', params: ['next'], body: [act(assign(privateValue('value'), v('next')))] },
				{ kind: 'method', name: 'increment', params: ['amount'], body: returns(assign(privateValue('value'), v('amount'), '+=')) },
				{
					kind: 'method',
					static: true,
					name: 'recognizes',
					params: ['candidate'],
					body: returns({ op: 'private-in', name: 'value', target: v('candidate') })
				}
			]
		});
		p.steps!.push(
			decl('counter', make(v('Counter'), [param('initial', 'Initial value', 3, 'number')])),
			decl('before', get(v('counter'), 'current')),
			decl('incremented', method(v('counter'), 'increment', [param('amount', 'Increment', 2, 'number')])),
			act(assign(get(v('counter'), 'current'), param('replacement', 'Set through accessor', 10, 'number')))
		);
		return done(
			obj({
				before: v('before'),
				incremented: v('incremented'),
				afterSetter: get(v('counter'), 'current'),
				staticKind: get(v('Counter'), 'kind'),
				instances: get(v('Counter'), 'instances'),
				privateBrand: method(v('Counter'), 'recognizes', [v('counter')]),
				plainObjectBrand: method(v('Counter'), 'recognizes', [obj({})])
			})
		);
	}
	return null;
}
