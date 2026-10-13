import type { Feature, PlatformProgram, Recipe } from './types';
import { base, parameter, input, global, get, method, make, recipe, returns, variable as v, object, array, call, awaited, declare, perform } from './programBuilders';

const proto = (value: unknown) => method(global('Object'), 'getPrototypeOf', [value]);
const descriptor = (target: unknown, key: unknown) => method(global('Object'), 'getOwnPropertyDescriptor', [target, key]);
const apply = (target: unknown, receiver: unknown, args: unknown[] = []) => method(global('Reflect'), 'apply', [target, receiver, array(...args)]);
const same = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
const choose = (test: unknown, then: unknown, otherwise: unknown) => ({ op: 'conditional', test, then, else: otherwise });
const typeOf = (value: unknown) => ({ op: 'unary', operator: 'typeof', value });
const metadata = (value: unknown) => object({ type: typeOf(value), name: get(value, 'name'), length: get(value, 'length') });

/** Prototype links and accessors are observed through ordinary Object/Reflect
 * data nodes. No executable constructor source or mutable global prototype is used. */
export function javascriptPrototypeRecipe(f: Feature): Recipe | undefined {
	if (f.kind !== 'built-in') return;
	const path = f.name.replace(/^(get|set) /, '').split(' (')[0].trim();
	const legacy = path === 'Object.prototype.__proto__';
	const iteratorTagSetter = f.name === 'set Iterator.prototype [ %Symbol.toStringTag% ]';
	const functionTag = /^(AsyncFunction|GeneratorFunction|AsyncGeneratorFunction)\.prototype \[ %Symbol\.toStringTag% \]$/.exec(path);
	const match = /^((?:Intl\.)?[A-Za-z]+)\.prototype(?:\.(constructor|prototype))?$/.exec(path);
	if (!legacy && !iteratorTagSetter && !functionTag && !match) return;
	const root = match?.[1] || functionTag?.[1] || (legacy ? 'Object' : 'Iterator');
	const member = match?.[2];
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [], requires: [] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type)); return input(name);
	};
	const done = (value: unknown, note: string) => recipe({ ...p, steps: [...p.steps!, ...returns(value)] }, 'interactive', note);
	if (legacy) {
		p.steps!.push(declare('parent', param('parent', 'Prototype fields', { inherited: 'Thingtime' })),
			declare('target', method(global('Object'), 'assign', [method(global('Object'), 'create', [v('parent')]), object({ ownValue: param('value', 'Own value', 42, 'number') })])),
			declare('accessor', descriptor(get(global('Object'), 'prototype'), '__proto__')));
		if (f.name.startsWith('set ')) p.steps!.push(perform(apply(get(v('accessor'), 'set'), v('target'), [param('replacement', 'Replacement prototype', { inherited: 'Builder' })])));
		p.steps!.push(declare('observed', apply(get(v('accessor'), 'get'), v('target'))));
		return done(object({ prototype: v('observed'), agreesWithGetPrototypeOf: same(v('observed'), proto(v('target'))), ownKeys: method(global('Object'), 'keys', [v('target')]), inherited: get(v('target'), 'inherited'), intrinsicPrototypeUnchanged: same(proto(get(global('Object'), 'prototype')), null) }),
			'Call the actual legacy prototype accessor on a fresh local object. Compare its result with Object.getPrototypeOf; the setter changes only this example object, never Object.prototype.');
	}
	let constructor: unknown, sample: unknown, target: unknown;
	if (['Function', 'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(root)) {
		const generator = root.includes('Generator'), async = root.startsWith('Async');
		const value = param('value', 'Function result or yielded value', 'Thingtime', 'text');
		p.steps!.push(declare('example', { op: 'function-expression', name: 'example', params: [], async, generator,
			body: generator ? [perform({ op: 'yield', value })] : returns(value) }));
		target = proto(v('example')); sample = v('example');
		constructor = get(descriptor(target, 'constructor'), 'value');
		if (member === 'prototype') { target = get(target, 'prototype'); sample = call(v('example')); }
		p.steps!.push(declare('invoked', generator ? awaited(method(call(v('example')), 'next')) : awaited(call(v('example')))));
	} else {
		const simpleRoots = ['AggregateError', 'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error', 'FinalizationRegistry', 'Iterator', 'Map', 'NativeError', 'Number', 'Object', 'Promise', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol', 'TypedArray', 'WeakMap', 'WeakRef', 'WeakSet'];
		if (!simpleRoots.includes(root) && !/^Intl\.(Collator|DateTimeFormat|DisplayNames|DurationFormat|ListFormat|Locale|NumberFormat|PluralRules|RelativeTimeFormat|Segmenter)$/.test(root)) return;
		const actual = root === 'NativeError' ? 'TypeError' : root;
		constructor = root === 'TypedArray' ? proto(global('Uint8Array')) : root.startsWith('Intl.') ? get(global('Intl'), root.split('.')[1]) : global(actual);
		p.requires!.push(root === 'TypedArray' ? ['Uint8Array'] : actual.split('.'));
		const value = param('value', 'Example value', ['Array', 'Set', 'TypedArray'].includes(root) ? [1, 2, 3] : ['Object', 'WeakRef'].includes(root) ? { message: 'Thingtime' } : 'Thingtime');
		if (root.startsWith('Intl.')) {
			const type = root.split('.')[1];
			p.parameters = [parameter('locale', 'Locale', 'en-AU'), parameter('options', 'Options', type === 'DisplayNames' ? { type: 'region' } : {}, 'json')];
			sample = { op: 'new', target: constructor, args: [input('locale'), input('options')] };
		} else if (root === 'Array') sample = method(global('Array'), 'from', [value]);
		else if (root === 'TypedArray') sample = make('Uint8Array', [value]);
		else if (root === 'ArrayBuffer' || root === 'SharedArrayBuffer') { p.parameters = [parameter('size', 'Byte length', 16, 'number')]; sample = make(root, [input('size')]); }
		else if (root === 'DataView') { p.parameters = [parameter('size', 'Byte length', 16, 'number')]; sample = make(root, [make('ArrayBuffer', [input('size')])]); }
		else if (root === 'Map') { p.parameters = [parameter('entries', 'Entries', [['key', 'Thingtime']], 'json')]; sample = make(root, [input('entries')]); }
		else if (root === 'Set') sample = make(root, [value]);
		else if (root === 'WeakMap' || root === 'WeakSet') { sample = make(root); p.parameters = []; }
		else if (root === 'WeakRef') sample = make(root, [value]);
		else if (root === 'FinalizationRegistry') sample = make(root, [{ op: 'function', params: ['held'], value }]);
		else if (root === 'Iterator') { p.parameters = [parameter('values', 'Iterator values', [1, 2, 3], 'json')]; sample = method(input('values'), 'values'); }
		else if (root === 'Promise') sample = method(global(root), 'resolve', [value]);
		else if (root === 'Symbol') sample = call(global('Object'), [call(global('Symbol'), [value])]);
		else if (root === 'BigInt') { p.parameters = [parameter('value', 'Integer string', '42')]; sample = call(global('Object'), [call(global('BigInt'), [input('value')])]); }
		else if (root === 'Date') { p.parameters = [parameter('value', 'ISO date', '2026-09-23T12:00:00Z')]; sample = make(root, [input('value')]); }
		else if (root === 'AggregateError') sample = make(root, [array(value), 'Aggregate example']);
		else if (root === 'Number') { p.parameters = [parameter('value', 'Number', 42, 'number')]; sample = make(root, [input('value')]); }
		else if (root === 'Boolean') { p.parameters = [parameter('value', 'Boolean', true, 'boolean')]; sample = make(root, [input('value')]); }
		else if (root === 'Object') sample = call(global(root), [value]);
		else sample = make(actual, [value]);
		target = get(constructor, 'prototype');
	}
	if (!target || !sample) return;
	p.steps!.push(declare('prototype', target), declare('expectedConstructor', constructor), declare('sample', sample));
	if (iteratorTagSetter || (root === 'Iterator' && f.name.startsWith('set '))) {
		const key = iteratorTagSetter ? get(global('Symbol'), 'toStringTag') : 'constructor';
		p.steps!.push(declare('accessor', descriptor(v('prototype'), key)),
			perform(apply(get(v('accessor'), 'set'), v('sample'), [param('replacement', 'Own property replacement', 'Thingtime Iterator', 'text')])));
		return done(object({ ownProperty: descriptor(v('sample'), key), inheritedGetter: apply(get(v('accessor'), 'get'), v('sample')), prototypeStillAccessor: typeOf(get(descriptor(v('prototype'), key), 'set')) }),
			'Invoke the native Iterator prototype setter on an iterator instance. It creates an own property while preserving the intrinsic prototype accessor.');
	}
	if (functionTag) return done(object({ tag: get(v('prototype'), get(global('Symbol'), 'toStringTag')), invoked: v('invoked'), receiverUsesPrototype: method(v('prototype'), 'isPrototypeOf', [v('sample')]) }),
		'Observe the real function-family tag and invoke a structured function of that family. Async and generator behavior is preserved by the authored language nodes.');
	// Extend only a fresh per-run prototype above the real intrinsic. The
	// receiver keeps its native internal slots and the intrinsic is unchanged.
	p.steps!.push(declare('extension', method(global('Object'), 'create', [v('prototype')])),
		perform(method(global('Reflect'), 'set', [v('extension'), 'thingtimeExampleLabel', param('label', 'Inherited label', 'Reusable Thingtime', 'text')])),
		perform(method(global('Object'), 'setPrototypeOf', [v('sample'), v('extension')])));
	p.steps!.push(declare('constructorDescriptor', descriptor(v('prototype'), 'constructor')),
		declare('constructorValue', choose(get(v('constructorDescriptor'), 'get'), apply(get(v('constructorDescriptor'), 'get'), v('sample')), get(v('constructorDescriptor'), 'value'))));
	return done(object({ constructor: metadata(v('constructorValue')), descriptor: object({ writable: get(v('constructorDescriptor'), 'writable'), enumerable: get(v('constructorDescriptor'), 'enumerable'), configurable: get(v('constructorDescriptor'), 'configurable'), accessor: typeOf(get(v('constructorDescriptor'), 'get')) }),
		receiverUsesPrototype: method(v('prototype'), 'isPrototypeOf', [v('sample')]), sampleOwnKeys: method(global('Object'), 'keys', [v('sample')]),
		inheritedLabel: get(v('sample'), 'thingtimeExampleLabel'), intrinsicUnchanged: { op: 'unary', operator: '!', value: method(global('Object'), 'hasOwn', [v('prototype'), 'thingtimeExampleLabel']) },
		...(member === 'constructor' ? { expectedConstructor: same(v('constructorValue'), v('expectedConstructor')) } : { prototypeOwnKeys: method(global('Reflect'), 'ownKeys', [v('prototype')]) }),
		...(['Function', 'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(root) ? { invoked: v('invoked') } : {}) }),
		'Inspect this native prototype or constructor descriptor, then extend a fresh local prototype with an editable inherited label. The native receiver and intrinsic relationship remain intact.' + (root === 'TypedArray' ? ' TypedArray uses the intrinsic above Uint8Array.' : root === 'NativeError' ? ' NativeError uses TypeError.' : '') + ' Source-string constructors are never called.');
}
