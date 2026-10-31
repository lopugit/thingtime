import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { compilePlatformProgram } from './compiler';
import { variable as v, input, get, object, array, method, global, call, declare, perform, returns } from './programBuilders';
const ap = (items: any[], rest?: any) => ({ op: 'array-pattern', items, ...(rest === undefined ? {} : { rest }) });
const op = (entries: any[], rest?: any) => ({ op: 'object-pattern', entries, ...(rest === undefined ? {} : { rest }) });
const entry = (key: any, target: any, computed = false) => ({ key, target, computed });
const def = (target: any, value: any) => ({ op: 'default-pattern', target, value });
const assign = (target: any, value: any) => ({ op: 'assign-expression', target, value });
const fn = (params: any[], body: any[]) => ({ op: 'function-expression', params, body });
const program = (steps: any[]) => ({ version: 1, title: 'Reusable native binding patterns', steps });
async function run(steps: any[], values: any = {}) {
	return vm.runInNewContext(`(async()=>{${compilePlatformProgram(program(steps))}})()`, { input: structuredClone(values) }, { timeout: 1000 });
}
const plain = (value: any) => JSON.parse(JSON.stringify(value));

test('nested binding patterns preserve defaults, elisions, rest and native TDZ', async () => {
	const steps = [
		{ op: 'let', pattern: ap([def('first', 7), null, op([entry('label', def('label', 'missing'))])], 'rest'), value: input('values') },
		...returns(object({ first: v('first'), label: v('label'), rest: v('rest') }))
	];
	for (const values of [
		[undefined, 2, {}, 4, 5],
		[null, 2, { label: null }],
		['x', 2, { label: 'custom' }]
	]) {
		const [first = 7, , { label = 'missing' }, ...rest] = values as any;
		assert.deepEqual(plain(await run(steps, { values })), plain({ first, label, rest }));
	}
	await assert.rejects(run([{ op: 'let', pattern: ap([def('first', v('later')), 'later']), value: array({ op: 'undefined' }, 4) }]), {
		name: 'ReferenceError'
	});
	await assert.rejects(run([{ op: 'const', pattern: op([]), value: null }]), { name: 'TypeError' });
	assert.deepEqual(
		plain(
			await run([
				{ op: 'var', pattern: ap(['first'], ap(['second'], 'rest')), value: array(1, 2, 3) },
				...returns(array(v('first'), v('second'), v('rest')))
			])
		),
		[1, 2, [3]]
	);
});

test('assignment patterns preserve RHS identity, member writes and partial completion', async () => {
	const target = op([entry('first', get(v('target'), 'first')), entry('second', def(get(v('target'), 'second'), 9))], get(v('target'), 'rest'));
	assert.deepEqual(
		plain(
			await run(
				[
					declare('target', object({})),
					declare('source', input('source')),
					declare('returned', assign(target, v('source'))),
					...returns(object({ target: v('target'), same: { op: 'binary', operator: '===', left: v('returned'), right: v('source') } }))
				],
				{ source: { first: 3, remaining: 5 } }
			)
		),
		{ target: { first: 3, second: 9, rest: { remaining: 5 } }, same: true }
	);
	const partial = await run([
		declare('first', 0),
		declare('later', 0),
		{
			op: 'try',
			body: [{ op: 'assign', pattern: ap(['first', op([entry('x', 'later')])]), value: array(2, null) }],
			error: 'error',
			catch: returns(object({ first: v('first'), later: v('later'), error: get(v('error'), 'name') }))
		}
	]);
	assert.deepEqual(plain(partial), { first: 2, later: 0, error: 'TypeError' });
});

test('computed object patterns retain getter order, symbol keys and rest exclusion', async () => {
	const trace = (s: any) => perform(method(v('trace'), 'push', [s]));
	const source = await run([
		declare('trace', array()),
		declare('symbol', call(global('Symbol'), ['included'])),
		declare('source', method(global('Object'), 'create', [object({ inherited: 5 })])),
		perform(
			method(global('Object'), 'defineProperty', [
				v('source'),
				'first',
				object({ enumerable: true, get: fn([], [trace('first getter'), ...returns(3)]) })
			])
		),
		perform(method(global('Object'), 'defineProperty', [v('source'), 'hidden', object({ value: 7 })])),
		perform(method(global('Reflect'), 'set', [v('source'), v('symbol'), 11])),
		perform(
			method(global('Object'), 'defineProperty', [
				v('source'),
				'second',
				object({ enumerable: true, get: fn([], [trace('second getter'), ...returns(4)]) })
			])
		),
		{
			op: 'const',
			pattern: op([entry({ op: 'sequence', items: [method(v('trace'), 'push', ['computed key']), 'first'] }, 'selected', true)], 'rest'),
			value: v('source')
		},
		...returns(
			object({
				selected: v('selected'),
				rest: v('rest'),
				symbol: get(v('rest'), v('symbol')),
				keys: method(method(global('Reflect'), 'ownKeys', [v('rest')]), 'map', [fn(['key'], returns(call(global('String'), [v('key')])))]),
				trace: v('trace')
			})
		)
	]);
	const nativeTrace = vm.runInNewContext(
		`(()=>{const trace=[];const symbol=Symbol('included');const source=Object.create({inherited:5});Object.defineProperty(source,'first',{enumerable:true,get(){trace.push('first getter');return 3}});Object.defineProperty(source,'hidden',{value:7});source[symbol]=11;Object.defineProperty(source,'second',{enumerable:true,get(){trace.push('second getter');return 4}});const {[(trace.push('computed key'),'first')]:selected,...rest}=source;return trace})()`
	);
	assert.deepEqual(plain(source), { selected: 3, rest: { second: 4 }, symbol: 11, keys: ['second', 'Symbol(included)'], trace: plain(nativeTrace) });
});

test('native iteration closes for partial or failing destructuring and retains final elisions', async () => {
	for (const items of [[], [null], [null, null], ['first', null]]) {
		const source = compilePlatformProgram(program([{ op: 'let', pattern: ap(items), value: input('iterable') }]));
		const trace: string[] = [];
		let i = 0;
		const iterable = {
			[Symbol.iterator]() {
				trace.push('iterator');
				return {
					next() {
						trace.push('next');
						return { value: ++i, done: false };
					},
					return() {
						trace.push('return');
						return { done: true };
					}
				};
			}
		};
		await vm.runInNewContext(`(async()=>{${source}})()`, { input: { iterable } }, { timeout: 1000 });
		assert.deepEqual(trace, ['iterator', ...items.map(() => 'next'), 'return']);
	}
	const trace: string[] = [];
	const iterable = {
		*[Symbol.iterator]() {
			try {
				yield undefined;
				yield 2;
			} finally {
				trace.push('closed');
			}
		}
	};
	const source = compilePlatformProgram(
		program([{ op: 'let', pattern: ap([def('x', call(fn([], [{ op: 'throw', value: 'default failed' }])))]), value: input('iterable') }])
	);
	await assert.rejects(vm.runInNewContext(`(async()=>{${source}})()`, { input: { iterable } }, { timeout: 1000 }), (e) => e === 'default failed');
	assert.deepEqual(trace, ['closed']);
});

test('destructured parameters, rest parameters, catch and class methods use binding syntax', async () => {
	const params = [
		{ pattern: op([entry('title', def('title', 'fallback'))]), default: object({}) },
		{ pattern: ap(['first'], 'tail'), rest: true }
	];
	const body = returns(object({ title: v('title'), first: v('first'), tail: v('tail') }));
	assert.deepEqual(plain(await run(returns(call(fn(params, body), [object({ title: 'hello' }), 1, 2, 3])))), {
		title: 'hello',
		first: 1,
		tail: [2, 3]
	});
	assert.deepEqual(plain(await run(returns(call(fn(params, body))))), { title: 'fallback', tail: [] });
	const caught = await run([
		{
			op: 'try',
			body: [{ op: 'throw', value: object({ reason: 'example', code: 7 }) }],
			errorPattern: op([entry('reason', 'reason')], 'rest'),
			catch: returns(object({ reason: v('reason'), rest: v('rest') }))
		}
	]);
	assert.deepEqual(plain(caught), { reason: 'example', rest: { code: 7 } });
	const klass = {
		op: 'class',
		name: 'Example',
		members: [{ kind: 'method', name: 'read', params: [{ pattern: ap(['x']) }], body: returns(v('x')) }]
	};
	assert.equal(await run([klass, ...returns(method({ op: 'new', target: v('Example'), args: [] }, 'read', [array(12)]))]), 12);
});

test('loop patterns preserve declaration scope, assignment and for-await values', async () => {
	for (const declaration of ['const', 'let', 'var']) {
		const result = await run([
			declare('readers', array()),
			{
				op: 'for-of',
				declaration,
				pattern: ap(['value']),
				value: array(array(1), array(2), array(3)),
				body: [perform(method(v('readers'), 'push', [fn([], returns(v('value')))]))]
			},
			...returns(method(v('readers'), 'map', [fn(['read'], returns(call(v('read'))))]))
		]);
		assert.deepEqual(plain(result), declaration === 'var' ? [3, 3, 3] : [1, 2, 3]);
	}
	assert.equal(
		await run([
			declare('last', 0),
			{ op: 'for-await-of', declaration: 'assign', pattern: ap(['last']), value: array(method(global('Promise'), 'resolve', [array(7)])), body: [] },
			...returns(v('last'))
		]),
		7
	);
	assert.deepEqual(
		plain(
			await run([
				declare('keys', array()),
				{
					op: 'for-in',
					pattern: ap(['first'], 'rest'),
					value: object({ ab: 1, cd: 2 }),
					body: [perform(method(v('keys'), 'push', [array(v('first'), v('rest'))]))]
				},
				...returns(v('keys'))
			])
		),
		[
			['a', ['b']],
			['c', ['d']]
		]
	);
});

test('pattern validation rejects code fragments, invalid targets and bypassed budgets', () => {
	const compile = (pattern: any) => compilePlatformProgram(program([{ op: 'let', pattern, value: array() }]));
	for (const pattern of [
		'x);throw 1;//',
		ap([{ op: 'get', target: v('x'), key: 'y' }]),
		ap([], def('rest', 2)),
		op([], ap(['rest'])),
		op([entry('constructor', 'x')]),
		op([null]),
		ap(Array(101).fill('x')),
		op(Array(101).fill(entry('x', 'x'))),
		def('x', 1),
		{ op: 'source', value: 'x' }
	])
		assert.throws(() => compile(pattern));
	for (const steps of [
		[{ op: 'let', name: 'x', pattern: ap(['y']), value: array() }],
		[{ op: 'expression', value: { ...assign(ap(['x']), array()), operator: '+=' } }],
		[{ op: 'assign', pattern: ap([{ op: 'get', target: v('x'), key: 'y', optional: true }]), value: array() }],
		[{ op: 'function-declaration', name: 'f', params: [{ pattern: ap(['x']), rest: true, default: array() }], body: [] }],
		[{ op: 'function-declaration', name: 'f', params: [{ name: 'x', pattern: ap(['y']) }], body: [] }],
		[{ op: 'try', error: 'e', errorPattern: op([]), body: [] }],
		[{ op: 'for-of', declaration: 'let);throw 1;//', name: 'x', value: array(), body: [] }]
	])
		assert.throws(() => compilePlatformProgram(program(steps)));
	let nested: any = 'x';
	for (let i = 0; i < 40; i++) nested = ap([nested]);
	assert.throws(() => compile(nested), /complexity budget/);
	const broad = ap(Array.from({ length: 100 }, (_, i) => op(Array.from({ length: 10 }, (_, j) => entry('key' + j, 'x' + i + '_' + j)))));
	assert.throws(() => compile(broad), /24 KB|complexity budget/);
	const dangerous = 'x"]};throw 1;//';
	const safe = compilePlatformProgram(
		program([{ op: 'const', pattern: op([entry(dangerous, 'value')]), value: input('object') }, ...returns(v('value'))])
	);
	assert.equal(vm.runInNewContext(`(()=>{${safe}})()`, { input: { object: { [dangerous]: 42 } } }), 42);
});
