import type { Feature, PlatformProgram, Recipe } from './types';
import {
	base,
	parameter,
	input,
	variable as v,
	get,
	global,
	object,
	array,
	call,
	method,
	make,
	returns,
	declare,
	perform,
	recipe,
	awaited,
	arrayPattern,
	objectPattern,
	defaultPattern
} from './programBuilders';
const fn = (params: unknown[], body: unknown[]) => ({ op: 'function-expression', params, body });
const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const choose = (test: unknown, then: unknown, otherwise: unknown) => ({ op: 'conditional', test, then, else: otherwise });
const sequence = (...items: unknown[]) => ({ op: 'sequence', items });
const generalNames = ['Destructuring Binding Patterns', 'Destructuring Assignment', 'Runtime Semantics: DestructuringAssignmentEvaluation'];
const objectNames = [
	'KeyedBindingInitialization',
	'PropertyBindingInitialization',
	'RestBindingInitialization',
	'KeyedDestructuringAssignmentEvaluation',
	'PropertyDestructuringAssignmentEvaluation',
	'RestDestructuringAssignmentEvaluation'
].map((name) => 'Runtime Semantics: ' + name);
const loopNames = [
	'Runtime Semantics: ForDeclarationBindingInitialization',
	'Runtime Semantics: ForDeclarationBindingInstantiation',
	'CreatePerIterationEnvironment ( perIterationBindings )',
	'ForBodyEvaluation ( test, increment, stmt, perIterationBindings, labelSet )'
];
const functionNames = [
	'InstantiateArrowFunctionExpression',
	'InstantiateAsyncArrowFunctionExpression',
	'InstantiateAsyncFunctionExpression',
	'InstantiateAsyncGeneratorFunctionExpression',
	'InstantiateGeneratorFunctionExpression',
	'InstantiateOrdinaryFunctionExpression'
].map((name) => 'Runtime Semantics: ' + name);
const iteratorName = 'Runtime Semantics: IteratorDestructuringAssignmentEvaluation';
export function javascriptBindingRecipe(f: Feature): Recipe | undefined {
	if (f.language !== 'javascript' || ![...generalNames, ...objectNames, ...loopNames, ...functionNames, iteratorName].includes(f.name)) return;
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [declare('trace', array())] };
	const param = (name: string, label: string, value: unknown, type: 'json' | 'text' | 'boolean' | 'number' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type));
		return input(name);
	};
	const trace = (value: unknown) => method(v('trace'), 'push', [value]);
	const fallback = (name: string, value: unknown) => sequence(trace(name), value);
	const done = (value: unknown, note: string) =>
		recipe(
			{
				...p,
				steps: [
					p.steps![0],
					{
						op: 'try',
						body: [...p.steps!.slice(1), ...returns(object({ status: 'ok', result: value, trace: v('trace') }))],
						error: 'error',
						catch: returns(
							object({ status: 'threw', name: get(v('error'), 'name'), message: call(global('String'), [v('error')]), trace: v('trace') })
						)
					}
				]
			},
			'interactive',
			note +
				' This saved Component contains native pattern nodes. Specification algorithms are observed through language execution, not exposed as callable globals.'
		);
	const assignment = f.name.includes('Assignment');
	const bind = (pattern: unknown, source: unknown, fields: string[]) => {
		const target = (node: any): any =>
			typeof node === 'string'
				? get(v('target'), node)
				: node?.op === 'default-pattern'
				? { ...node, target: target(node.target) }
				: node?.op === 'array-pattern'
				? {
						...node,
						items: node.items.map((item: any) => (item === null ? null : target(item))),
						...(node.rest === undefined ? {} : { rest: target(node.rest) })
				  }
				: node?.op === 'object-pattern'
				? {
						...node,
						entries: node.entries.map((entry: any) => ({ ...entry, target: target(entry.target) })),
						...(node.rest === undefined ? {} : { rest: target(node.rest) })
				  }
				: node;
		return call(
			fn(
				['bindingSource'],
				assignment
					? [
							declare('source', v('bindingSource')),
							declare('target', object({})),
							declare('returned', { op: 'assign-expression', target: target(pattern), value: v('source') }),
							...returns(
								object({
									...Object.fromEntries(fields.map((name) => [name, get(v('target'), name)])),
									sameSource: binary('===', v('returned'), v('source'))
								})
							)
					  ]
					: [{ op: 'const', pattern, value: v('bindingSource') }, ...returns(object(Object.fromEntries(fields.map((name) => [name, v(name)]))))]
			),
			[source]
		);
	};
	if (generalNames.includes(f.name) || objectNames.includes(f.name)) {
		const source = param('source', 'Object or primitive to destructure', { title: 'Thingtime', count: 3, extra: 'reusable' });
		const key = param('key', 'Computed property key', 'title', 'text');
		const defaultValue = param('fallback', 'Default for an undefined property', 'Default');
		let objectSource: unknown = source;
		const restExample = f.name.includes('Rest');
		if (restExample) {
			p.steps!.push(
				declare('symbol', call(global('Symbol'), ['rest key'])),
				declare('source', method(global('Object'), 'assign', [method(global('Object'), 'create', [object({ inherited: 99 })]), source])),
				perform(method(global('Object'), 'defineProperty', [v('source'), 'hidden', object({ value: 'non-enumerable', enumerable: false })])),
				perform(
					method(global('Object'), 'defineProperty', [
						v('source'),
						'observed',
						object({ enumerable: true, get: fn([], returns(fallback('rest getter', param('observed', 'Enumerable getter value', 7)))) })
					])
				),
				perform(method(global('Reflect'), 'set', [v('source'), v('symbol'), param('symbolValue', 'Enumerable symbol value', 'symbol data')]))
			);
			objectSource = v('source');
		}
		const objectBinding = objectPattern(
			[{ key: sequence(trace('computed key'), key), computed: true, target: defaultPattern('selected', fallback('property default', defaultValue)) }],
			'rest'
		);
		const objectResult = bind(objectBinding, objectSource, ['selected', 'rest']);
		if (restExample) {
			p.steps!.push(
				declare('result', objectResult),
				declare('getterReads', get(method(v('trace'), 'filter', [fn(['item'], returns(binary('===', v('item'), 'rest getter')))]), 'length'))
			);
			return done(
				object({
					selected: get(v('result'), 'selected'),
					rest: get(v('result'), 'rest'),
					restKeys: method(method(global('Reflect'), 'ownKeys', [get(v('result'), 'rest')]), 'map', [
						fn(['key'], returns(call(global('String'), [v('key')])))
					]),
					symbol: get(get(v('result'), 'rest'), v('symbol')),
					getterReads: v('getterReads'),
					expectedGetterReads: 1,
					matchesExpectedGetterReads: binary('===', v('getterReads'), 1),
					...(assignment ? { sameSource: get(v('result'), 'sameSource') } : {})
				}),
				'Object rest copies own enumerable properties, including symbols, and excludes the selected key, inherited and hidden properties. The source input supplies own properties on a native object with a getter and prototype. Its getter should run once; the result preserves and flags older engines that read an excluded getter again.'
			);
		}
		if (!generalNames.includes(f.name))
			return done(
				objectResult,
				'A computed key is evaluated once. Renamed bindings and member assignment targets preserve native property access; defaults run only for undefined, and null cannot be destructured.'
			);
		const values = param('values', 'Array values: first, skipped, nested object, rest', [1, 2, { label: 'nested' }, 4, 5]);
		const useUndefined = param('undefinedFirst', 'Replace the first array item with undefined', false, 'boolean');
		const items = choose(
			useUndefined,
			call(
				fn(
					[],
					[
						{
							op: 'if',
							test: binary('>', { ...get(values, 'length'), optional: true }, 4096),
							then: [{ op: 'throw', value: make('RangeError', ['This demo limits copied input to 4096 values']) }]
						},
						declare('items', { op: 'array', items: [{ op: 'spread', value: values }] }),
						perform(method(global('Reflect'), 'set', [v('items'), 0, { op: 'undefined' }])),
						...returns(v('items'))
					]
				)
			),
			values
		);
		const arrayBinding = arrayPattern(
			[
				defaultPattern('first', fallback('first default', defaultValue)),
				null,
				defaultPattern(objectPattern([{ key: 'label', target: defaultPattern('label', fallback('nested default', defaultValue)) }]), object({}))
			],
			'rest'
		);
		return done(
			choose(param('array', 'Use the nested array pattern', false, 'boolean'), bind(arrayBinding, items, ['first', 'label', 'rest']), objectResult),
			'Switch between computed object keys and a nested array pattern with an elision, defaults and rest. Null stays null; only undefined triggers an initializer. Assignment writes real member targets and returns the original source identity.'
		);
	}
	if (f.name === iteratorName) {
		const values = param('values', 'Iterator values', [1, 2, 3, 4]);
		const undefinedFirst = param('undefinedFirst', 'Yield undefined first', false, 'boolean');
		const mode = param('mode', 'Pattern: partial, rest or empty', 'partial', 'text');
		p.steps!.push(
			{
				op: 'if',
				test: { op: 'unary', operator: '!', value: method(array('partial', 'rest', 'empty'), 'includes', [mode]) },
				then: [{ op: 'throw', value: make('RangeError', ['Choose partial, rest or empty']) }]
			},
			declare(
				'iterator',
				call({
					...fn(
						[],
						[
							{
								op: 'try',
								body: [
									declare('index', 0),
									{
										op: 'for-of',
										name: 'item',
										value: values,
										body: [
											perform(trace(object({ yielded: v('item') }))),
											perform({
												op: 'yield',
												value: choose(
													binary('&&', undefinedFirst, binary('===', { op: 'update', target: v('index'), operator: '++' }, 0)),
													{ op: 'undefined' },
													v('item')
												)
											})
										]
									}
								],
								finally: [perform(trace('generator closed'))],
								error: 'error',
								catch: [{ op: 'throw', value: v('error') }]
							}
						]
					),
					generator: true
				})
			),
			declare('target', object({}))
		);
		const initializer = call(
			fn(
				[],
				[
					perform(trace('default initializer')),
					{
						op: 'if',
						test: param('throwDefault', 'Throw from the default initializer', false, 'boolean'),
						then: [{ op: 'throw', value: make('Error', ['Default failed']) }]
					},
					...returns(param('fallback', 'Default value', 'fallback'))
				]
			)
		);
		const item = defaultPattern(get(v('target'), 'first'), initializer);
		p.steps!.push(
			perform(
				choose(
					binary('===', mode, 'empty'),
					{ op: 'assign-expression', target: arrayPattern([]), value: v('iterator') },
					choose(
						binary('===', mode, 'rest'),
						{ op: 'assign-expression', target: arrayPattern([item], get(v('target'), 'rest')), value: v('iterator') },
						{ op: 'assign-expression', target: arrayPattern([item, null, get(v('target'), 'third')]), value: v('iterator') }
					)
				)
			)
		);
		return done(
			v('target'),
			'Destructure a real generator and observe yielded values, skipped positions, lazy defaults and finally cleanup. Partial consumption closes it; rest exhausts it. Closing an unstarted generator with an empty pattern never enters its body.'
		);
	}
	if (loopNames.includes(f.name)) {
		const shared = param('shared', 'Use one shared var binding', false, 'boolean');
		const readers = () => returns(method(v('readers'), 'map', [fn(['read'], returns(call(v('read'))))]));
		if (f.name.startsWith('Runtime Semantics: ForDeclaration')) {
			const rows = param('rows', 'Rows to destructure', [
				[1, 'HTML'],
				[2, 'CSS'],
				[3, 'JavaScript']
			]);
			const async = param('async', 'Await the rows in for-await-of', false, 'boolean');
			const body = [perform(method(v('readers'), 'push', [fn([], returns(object({ number: v('number'), label: v('label') })))]))];
			const pattern = arrayPattern(['number', defaultPattern('label', 'untitled')]);
			const loop = (declaration: string) =>
				call(
					fn(
						[],
						[
							declare('readers', array()),
							{
								op: 'if',
								test: async,
								then: [{ op: 'for-await-of', declaration, pattern, value: rows, body }],
								else: [{ op: 'for-of', declaration, pattern, value: rows, body }]
							},
							...readers()
						]
					)
				);
			// Both branches contain for-await, so their enclosing native functions are async.
			const run = (declaration: string) => {
				const expression: any = loop(declaration);
				expression.target.async = true;
				return awaited(expression);
			};
			return done(
				choose(shared, run('var'), run('let')),
				'Each lexical loop binding has its own captured values. Compare a shared var binding after iteration, and use the same pattern in a native for-await-of loop.'
			);
		}
		const start = param('start', 'Starting index', 0, 'number'),
			limit = param('limit', 'Stop before (maximum 16 iterations)', 4, 'number');
		p.steps!.push({
			op: 'if',
			test: binary('||', binary('>', binary('-', limit, start), 16), {
				op: 'unary',
				operator: '!',
				value: binary('&&', method(global('Number'), 'isSafeInteger', [start]), method(global('Number'), 'isSafeInteger', [limit]))
			}),
			then: [{ op: 'throw', value: make('RangeError', ['This demo requires safe integers and at most 16 iterations']) }]
		});
		const loop = (declaration: string) =>
			call(
				fn(
					[],
					[
						declare('readers', array()),
						{
							op: 'for',
							init: { op: declaration, pattern: objectPattern([{ key: 'index', target: 'index' }]), value: object({ index: start }) },
							test: binary('<', v('index'), limit),
							update: { op: 'update', target: v('index'), operator: '++' },
							body: [perform(method(v('readers'), 'push', [fn([], returns(v('index')))]))]
						},
						...readers()
					]
				)
			);
		return done(
			choose(shared, loop('var'), loop('let')),
			'A native for loop starts with an object binding pattern. Lexical per-iteration environments preserve each closure value; var closures share the final index. The demo requires safe integer bounds and explicitly limits iteration count.'
		);
	}
	if (functionNames.includes(f.name)) {
		const async = f.name.includes('Async'),
			generator = f.name.includes('Generator'),
			arrow = f.name.includes('Arrow');
		const fallbackValue = param('fallback', 'Default label', 'fallback', 'text');
		const params = [
			{ pattern: objectPattern([{ key: 'label', target: defaultPattern('label', fallbackValue) }]), default: object({}) },
			{ pattern: arrayPattern(['first'], 'tail'), rest: true }
		];
		const result = object({ label: v('label'), first: v('first'), tail: v('tail') });
		const body = generator ? [perform({ op: 'yield', value: result })] : returns(result);
		const definition = { op: arrow ? 'function' : 'function-expression', params, body, async, ...(generator ? { generator: true } : {}) };
		p.steps!.push(
			declare('describe', definition),
			declare(
				'value',
				call(v('describe'), [
					choose(
						param('omit', 'Omit the first argument', false, 'boolean'),
						{ op: 'undefined' },
						param('source', 'First argument object', { label: 'Thingtime' })
					),
					{ op: 'spread', value: param('rest', 'Arguments collected by the rest pattern', [1, 2, 3]) }
				])
			)
		);
		if (async && generator) p.requires = [['Array', 'fromAsync']];
		return done(
			generator
				? async
					? awaited(method(global('Array'), 'fromAsync', [v('value')]))
					: method(global('Array'), 'from', [v('value')])
				: awaited(v('value')),
			'This real function is instantiated from saved ordinary, arrow, async or generator nodes. It destructures an object parameter and its rest array; omitted arguments and missing properties use separate native defaults.'
		);
	}
}
