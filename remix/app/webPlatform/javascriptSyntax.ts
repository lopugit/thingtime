import type { Feature, Recipe } from './types';
import { base, parameter, input, global, literal, get, method, make, recipe, returns } from './programBuilders';

/** Worked language examples, authored in the same data vocabulary users edit. */
export function javascriptSyntaxRecipe(f: Feature): Recipe | null {
	if (f.kind !== 'language') return null;
	const p = { ...base(f), parameters: [] as ReturnType<typeof parameter>[], steps: [] as any[] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters.push(parameter(name, label, value, type));
		return input(name);
	};
	const variable = (name: string) => ({ op: 'variable', name });
	const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
	const call = (target: unknown, args: unknown[]) => ({ op: 'call', target, args });
	const done = (value: unknown, note?: string) => recipe({ ...p, steps: [...p.steps, ...returns(value)] }, 'interactive', note);
	const binaryOperators: Record<string, string[]> = {
		'Additive Operators': ['+', '-'],
		'The Addition Operator ( + )': ['+'],
		'The Subtraction Operator ( - )': ['-'],
		'Multiplicative Operators': ['*', '/', '%'],
		'Exponentiation Operator': ['**'],
		'Equality Operators': ['==', '!=', '===', '!=='],
		'Relational Operators': ['<', '<=', '>', '>='],
		'Binary Bitwise Operators': ['&', '|', '^'],
		'Bitwise Shift Operators': ['<<', '>>', '>>>'],
		'The Left Shift Operator ( << )': ['<<'],
		'The Signed Right Shift Operator ( >> )': ['>>'],
		'The Unsigned Right Shift Operator ( >>> )': ['>>>'],
		'Binary Logical Operators': ['&&', '||', '??']
	};
	if (binaryOperators[f.name]) {
		const a = param('a', 'Left operand', 3),
			b = param('b', 'Right operand', 2);
		return done({ op: 'object', entries: binaryOperators[f.name].map((operator) => [operator, binary(operator, a, b)]) });
	}
	const unaryOperators: Record<string, string> = {
		'The typeof Operator': 'typeof',
		'The void Operator': 'void',
		'Unary + Operator': '+',
		'Unary - Operator': '-',
		'Bitwise NOT Operator ( ~ )': '~',
		'Logical NOT Operator ( ! )': '!'
	};
	if (unaryOperators[f.name]) return done({ op: 'unary', operator: unaryOperators[f.name], value: param('value', 'Value', 3) });
	if (f.name === 'Conditional Operator ( ? : )')
		return done({
			op: 'conditional',
			test: param('condition', 'Condition', true, 'boolean'),
			then: param('yes', 'When true', 'yes', 'text'),
			else: param('no', 'When false', 'no', 'text')
		});
	if (['Array Initializer', 'Argument Lists'].includes(f.name)) {
		const items = {
			op: 'array',
			items: [param('first', 'First value', 'Thingtime'), { op: 'spread', value: param('rest', 'Spread values', [1, 2, 3]) }]
		};
		return done(f.name === 'Argument Lists' ? method(global('Array'), 'of', [{ op: 'spread', value: items }]) : items);
	}
	if (f.name === 'Object Initializer')
		return done({
			op: 'object',
			entries: [
				['name', param('name', 'Name', 'Thingtime', 'text')],
				['count', param('count', 'Count', 3, 'number')]
			]
		});
	if (['Property Accessors', 'Optional Chains'].includes(f.name))
		return done({
			op: 'get',
			target: param('object', 'Object or null', { name: 'Thingtime' }),
			key: param('key', 'Property', 'name', 'text'),
			...(f.name === 'Optional Chains' ? { optional: true } : {})
		});
	if (['Arrow Function Definitions', 'Async Arrow Function Definitions', 'Function Calls', 'Function Defining Expressions'].includes(f.name)) {
		const fn = { op: 'function', params: ['value'], value: binary('*', variable('value'), 2), async: f.name.startsWith('Async') };
		return done({ op: 'await', value: call(fn, [param('value', 'Value to double', 4, 'number')]) });
	}
	if (f.name === 'The new Operator') return done(method(make('Date', [param('date', 'Date (ISO)', '2026-09-23T12:00:00Z', 'text')]), 'toISOString'));
	if (f.name === 'Regular Expression Literals')
		return done(
			method({ op: 'regex', pattern: '[A-Z][a-z]+', flags: 'g' }, 'exec', [param('text', 'Text', 'Hello Thingtime', 'text')]),
			'The editable regex node compiles to a RegExp constructor; it demonstrates matching, not lexical slash parsing.'
		);
	if (
		[
			'Identifier Reference',
			'Let and Const Declarations',
			'Declarations and the Variable Statement',
			'Variable Statement',
			'Assignment Operators'
		].includes(f.name)
	) {
		p.steps.push({ op: f.name === 'Variable Statement' ? 'var' : 'let', name: 'value', value: param('initial', 'Initial value', 3) });
		if (f.name === 'Assignment Operators') p.steps.push({ op: 'assign', name: 'value', value: param('replacement', 'Replacement', 5) });
		return done(variable('value'), 'This example declares a local binding and reads it; assignment replaces that binding when selected.');
	}
	if (f.name === 'The if Statement') {
		p.steps.push({ op: 'if', test: param('condition', 'Condition', true, 'boolean'), then: returns('then branch'), else: returns('else branch') });
		return recipe(p);
	}
	if (['Iteration Statements', 'The for-in, for-of, and for-await-of Statements', 'The break Statement', 'The continue Statement'].includes(f.name)) {
		const values = param('values', 'Values', [1, 2, 3, 4, 5]);
		p.steps.push({ op: 'let', name: 'visited', value: [] });
		const body: any[] = [];
		if (f.name === 'The break Statement' || f.name === 'The continue Statement')
			body.push({
				op: 'if',
				test: binary('===', variable('item'), param('match', 'Value to match', 3)),
				then: [{ op: f.name.includes('break') ? 'break' : 'continue' }]
			});
		body.push({ op: 'expression', value: method(variable('visited'), 'push', [variable('item')]) });
		p.steps.push({ op: 'for-of', name: 'item', value: values, body });
		return done(variable('visited'), 'This fixture uses for-of. Change the list and matching value to observe iteration, break or continue.');
	}
	if (f.name === 'The while Statement') {
		const limit = param('limit', 'Count up to', 5, 'number');
		p.steps.push(
			{ op: 'let', name: 'count', value: 0 },
			{ op: 'while', test: binary('<', variable('count'), limit), body: [{ op: 'assign', name: 'count', value: binary('+', variable('count'), 1) }] }
		);
		return done(variable('count'));
	}
	if (['The try Statement', 'The throw Statement', 'Error Handling and Language Extensions'].includes(f.name)) {
		p.steps.push(
			{ op: 'let', name: 'events', value: [] },
			{
				op: 'try',
				body: [{ op: 'throw', value: make('Error', [param('message', 'Error message', 'Example error', 'text')]) }],
				error: 'error',
				catch: [{ op: 'expression', value: method(variable('events'), 'push', [get(variable('error'), 'message')]) }],
				finally: [{ op: 'expression', value: method(variable('events'), 'push', ['finally ran']) }]
			}
		);
		return done(variable('events'));
	}
	if (f.name === 'The return Statement') return done(param('value', 'Return value', 'Hello Thingtime', 'text'));
	if (f.name === 'Expression Statement') {
		p.steps.push(
			{ op: 'let', name: 'values', value: [] },
			{ op: 'expression', value: method(variable('values'), 'push', [param('value', 'Value to append', 'Thingtime', 'text')]) }
		);
		return done(variable('values'));
	}
	if (['Boolean Literals', 'String Literals', 'Numeric Literals'].includes(f.name))
		return done(
			literal(f.name === 'Boolean Literals' ? true : f.name === 'Numeric Literals' ? 42 : 'Hello Thingtime'),
			'Edit the literal value in the reusable program to change this language literal.'
		);
	if (f.name === 'Null Literals') return done(null);
	return null;
}
