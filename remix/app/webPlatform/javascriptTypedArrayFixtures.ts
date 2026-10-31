import type { Feature, PlatformProgram, Recipe } from './types';
import { base, parameter, input, global, get, method, make, recipe, returns, variable as v, object, array, call, declare, perform } from './programBuilders';

const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const choose = (test: unknown, then: unknown, otherwise: unknown) => ({ op: 'conditional', test, then, else: otherwise });
const proto = (value: unknown) => method(global('Object'), 'getPrototypeOf', [value]);
const from = (value: unknown) => method(global('Array'), 'from', [value]);
const fn = (params: string[], body: unknown[]) => ({ op: 'function-expression', params, body });
const apply = (target: unknown, receiver: unknown, args: unknown) => method(global('Reflect'), 'apply', [target, receiver, args]);
export const TYPED_ARRAY_CONSTRUCTORS = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
const constructors = TYPED_ARRAY_CONSTRUCTORS;

/** TypedArray intrinsics are invoked with real concrete receivers. Every choice,
 * callback and observation is saved as ordinary reusable program data. */
export function javascriptTypedArrayRecipe(f: Feature): Recipe | undefined {
	const name = f.name.replace(/^get /, '').split(' (')[0].trim();
	if (!/^%TypedArray%(?:\.prototype)?(?:\.[A-Za-z]+)?$/.test(name)) return;
	const member = name === '%TypedArray%' ? 'abstract' : name.split('.').at(-1)!;
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [], requires: [['Uint8Array']] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type)); return input(name);
	};
	const done = (value: unknown, note: string) => recipe({ ...p, steps: [...p.steps!, ...returns(value)] }, 'interactive', note + ' Type choices: ' + constructors.join(', ') + '.');
	const type = param('type', 'Native typed array type', 'Uint8Array', 'text');
	p.steps!.push(declare('constructors', object(Object.fromEntries(constructors.map(name => [name,
		choose(binary('===', { op: 'unary', operator: 'typeof', value: global(name) }, 'undefined'), null, global(name))
	])))),
		{ op: 'if', test: { op: 'unary', operator: '!', value: method(global('Object'), 'hasOwn', [v('constructors'), type]) }, then: [{ op: 'throw', value: make('RangeError', ['Choose a standard typed array constructor']) }] },
		declare('type', get(v('constructors'), type)),
		{ op: 'if', test: binary('===', v('type'), null), then: returns(object({ status: 'unsupported', missing: array(type), message: 'This browser does not expose the selected native typed array constructor.' })) },
		declare('big', method(type, 'startsWith', ['Big'])), declare('intrinsic', proto(v('type'))), declare('prototype', get(v('intrinsic'), 'prototype')));
	const convert = (value: unknown) => choose(v('big'), call(global('BigInt'), [value]), value);
	const values = param('values', 'Values (decimal strings preserve large BigInts)', [3, 1, 4, 1, 5]);
	p.steps!.push(declare('values', method(values, 'map', [fn(['value'], returns(convert(v('value'))))])),
		declare('backing', { op: 'new', target: v('type'), args: [binary('+', get(v('values'), 'length'), 4)] }),
		declare('view', { op: 'new', target: v('type'), args: [get(v('backing'), 'buffer'), binary('*', param('prefix', 'Elements before the view (0–4)', 2, 'number'), get(v('type'), 'BYTES_PER_ELEMENT')), get(v('values'), 'length')] }),
		perform(method(v('view'), 'set', [v('values')])), declare('visited', array()));
	const layout = { type: get(v('type'), 'name'), values: from(v('view')), byteOffset: get(v('view'), 'byteOffset'), byteLength: get(v('view'), 'byteLength'), backingBytes: from(make('Uint8Array', [get(v('view'), 'buffer')])) };
	if (member === 'abstract') {
		p.steps!.push(declare('abstractConstruction', null), { op: 'try', body: [perform({ op: 'new', target: v('intrinsic'), args: [] })], error: 'error', catch: [{ op: 'assign', name: 'abstractConstruction', value: object({ name: get(v('error'), 'name'), message: get(v('error'), 'message') }) }] });
		return done(object({ abstractConstruction: v('abstractConstruction'), concrete: object(layout) }), 'The actual TypedArray intrinsic rejects direct construction. Choose a concrete native type and inspect its real view and backing bytes. No constructor source string is evaluated.');
	}
	if (['prototype', 'constructor'].includes(member)) {
		p.steps!.push(declare('descriptor', method(global('Object'), 'getOwnPropertyDescriptor', [v('prototype'), 'constructor'])));
		return done(object({ ...layout, receiverUsesIntrinsic: method(v('prototype'), 'isPrototypeOf', [v('view')]), constructorName: get(get(v('descriptor'), 'value'), 'name'), expectedConstructor: binary('===', get(v('descriptor'), 'value'), v('intrinsic')), prototypeOwnKeys: method(global('Reflect'), 'ownKeys', [v('prototype')]) }), 'Inspect the actual shared TypedArray prototype and constructor descriptor through a concrete native view. Changing the selected type changes its byte width while preserving the shared intrinsic relationship.');
	}
	if (['buffer', 'byteLength', 'byteOffset', 'length'].includes(member)) return done(object({ result: get(v('view'), member), ...layout }), 'Read the intrinsic accessor on a native view with an editable byte window. The buffer covers the entire backing allocation; byteOffset and byteLength describe only the view.');
	let args: unknown[] = [];
	const predicates = ['every', 'some', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex'];
	if (['from', 'map', 'forEach', ...predicates].includes(member)) {
		const predicate = predicates.includes(member);
		const operand = convert(param(predicate ? 'threshold' : 'factor', predicate ? 'Greater than' : 'Multiplier', 2));
		const callback = fn(['value', 'index'], [perform(method(v('visited'), 'push', [object({ value: v('value'), index: v('index') })])), ...returns(binary(predicate ? '>' : '*', v('value'), get({ op: 'this' }, 'operand')))]);
		args = [callback, object({ operand })];
		if (member === 'from') args.unshift(v('values'));
	} else if (member.startsWith('reduce')) {
		args = [fn(['total', 'value', 'index'], [perform(method(v('visited'), 'push', [object({ value: v('value'), index: v('index') })])), ...returns(binary('+', v('total'), v('value')))]), convert(param('initial', 'Initial total', 0))];
	} else if (['sort', 'toSorted'].includes(member)) {
		const descending = param('descending', 'Descending order', false, 'boolean');
		args = [fn(['left', 'right'], [perform(method(v('visited'), 'push', [array(v('left'), v('right'))])), ...returns(binary('*', call(global('Number'), [binary('-', v('left'), v('right'))]), choose(descending, -1, 1)))])];
	} else if (member === 'set') {
		args = [method(param('source', 'Values to write', [9, 8]), 'map', [fn(['value'], returns(convert(v('value'))))]), param('offset', 'Write offset (elements)', 1, 'number')];
	} else if (member === 'copyWithin') args = [param('target', 'Target index', 0, 'number'), param('start', 'Copy from index', 2, 'number'), param('end', 'Copy before index', 4, 'number')];
	else if (member === 'fill') args = [convert(param('value', 'Fill value', 9)), param('start', 'Start index', 1, 'number'), param('end', 'End index', 4, 'number')];
	else if (['slice', 'subarray'].includes(member)) args = [param('start', 'Start index', 1, 'number'), param('end', 'End index', 4, 'number')];
	else if (['at', 'with'].includes(member)) { args = [param('index', 'Index', 1, 'number')]; if (member === 'with') args.push(convert(param('value', 'Replacement', 9))); }
	else if (['includes', 'indexOf', 'lastIndexOf'].includes(member)) args = [convert(param('value', 'Search value', 1)), param('start', 'Search from index', member === 'lastIndexOf' ? 4 : 0, 'number')];
	else if (member === 'join') args = [param('separator', 'Separator', ' · ', 'text')];
	else if (member === 'toLocaleString') args = [param('locale', 'Locale', 'en-AU', 'text'), param('options', 'Formatting options', { minimumFractionDigits: 2 })];
	else if (!['of', 'entries', 'keys', 'values', 'reverse', 'toReversed', 'toString'].includes(member)) return;
	const staticMember = ['from', 'of'].includes(member);
	p.steps!.push(declare('operation', get(staticMember ? v('intrinsic') : v('prototype'), member)),
		{ op: 'if', test: binary('!==', { op: 'unary', operator: 'typeof', value: v('operation') }, 'function'), then: returns(object({ status: 'unsupported', missing: array(f.name), message: 'The selected native intrinsic method is unavailable.' })) });
	let result: unknown = apply(v('operation'), staticMember ? v('type') : v('view'), member === 'of' ? v('values') : array(...args));
	if (['entries', 'keys', 'values'].includes(member)) result = from(result);
	p.steps!.push(declare('result', result));
	const viewResult = method(global('ArrayBuffer'), 'isView', [v('result')]);
	return done(object({ result: choose(viewResult, from(v('result')), v('result')), receiver: object(layout), sameReceiver: binary('===', v('result'), v('view')), sharesBackingBuffer: binary('&&', viewResult, binary('===', get(v('result'), 'buffer'), get(v('view'), 'buffer'))), visited: v('visited') }),
		'Invoke the named TypedArray intrinsic with a concrete native receiver. Edit the type, values and operation inputs; compare mutation, byte sharing and callback visits. Decimal strings preserve BigInt precision. Unsupported native choices are reported explicitly.');
}
