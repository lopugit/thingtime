import type { Feature, PlatformProgram, Recipe } from './types';
import { base, parameter, input, global, get, method, make, recipe, returns, variable as v, object, array, fn, call, awaited, declare, perform, project } from './programBuilders';
import { TYPED_ARRAY_CONSTRUCTORS } from './javascriptTypedArrayFixtures';

const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const choose = (test: unknown, then: unknown, otherwise: unknown) => ({ op: 'conditional', test, then, else: otherwise });
const typeOf = (value: unknown) => ({ op: 'unary', operator: 'typeof', value });
const from = (value: unknown) => method(global('Array'), 'from', [value]);
const func = (params: string[], body: unknown[]) => ({ op: 'function-expression', params, body });
const error = () => object({ name: { ...get(v('error'), 'name'), optional: true }, message: call(global('String'), [v('error')]) });
const errors = ['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError'];
const roots = new Set(['AggregateError', 'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'FinalizationRegistry', 'Iterator', 'Map', 'NativeError', 'Number', 'Object', 'Promise', 'Proxy', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol', 'TypedArray', 'WeakMap', 'WeakRef', 'WeakSet', ...errors, ...TYPED_ARRAY_CONSTRUCTORS]);

/** Constructor signatures retain their own source identity and complete saved
 * program. Reflection invokes the actual constructor, never a source string. */
export function javascriptConstructorRecipe(f: Feature): Recipe | undefined {
	if (f.language !== 'javascript') return;
	const match = /^([A-Za-z][A-Za-z0-9]*) \([^)]*\)$/.exec(f.name);
	if (!match || !roots.has(match[1])) return;
	const root = match[1];
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [], requires: ['NativeError', 'TypedArray'].includes(root) ? [] : [[root]] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type)); return input(name);
	};
	const useNew = param('useNew', 'Invoke with new', !['BigInt', 'Symbol'].includes(root), 'boolean');
	const invoke = (args: unknown, target: unknown = global(root)) => choose(useNew, method(global('Reflect'), 'construct', [target, args]), method(global('Reflect'), 'apply', [target, { op: 'undefined' }, args]));
	const done = (result: Record<string, unknown>, note: string) => recipe({ ...p, steps: [{ op: 'try', body: [...p.steps!, ...returns(object({ status: 'ok', ...result }))], error: 'error', catch: returns(object({ status: 'threw', error: error() })) }] }, 'interactive', note + ' The new toggle calls the real native constructor or function; failures retain their native error name and message.');
	const bounded = (value: unknown, maximum = 4096) => p.steps!.push({ op: 'if', test: binary('>', value, maximum), then: [{ op: 'throw', value: make('RangeError', [`This demo limits allocation to ${maximum} elements or bytes`]) }] });
	const selection = (name: string, label: string, value: string, choices: string[]) => {
		const choiceLabel = choices === TYPED_ARRAY_CONSTRUCTORS ? label + ' (add Array): ' + choices.map(name => name.replace(/Array$/, '')).join(', ') : label + ': ' + choices.join(', ');
		const selected = param(name, choiceLabel, value, 'text');
		p.steps!.push({ op: 'if', test: { op: 'unary', operator: '!', value: method(array(...choices), 'includes', [selected]) }, then: [{ op: 'throw', value: make('RangeError', ['Choose one of the listed ' + name + ' values']) }] });
		return selected;
	};
	if (['Object', 'Boolean', 'Number', 'String', 'BigInt', 'Symbol'].includes(root)) {
		const supplied = param('value', root === 'BigInt' ? 'Integer value (decimal strings preserve precision)' : 'Input value', root === 'Object' ? { label: 'Thingtime' } : root === 'Boolean' ? false : root === 'Number' ? '0x10' : root === 'BigInt' ? '9007199254740993' : 'Thingtime');
		const omit = param('omit', 'Omit the argument', false, 'boolean');
		p.steps!.push(declare('argument', choose(omit, { op: 'undefined' }, supplied)), declare('result', invoke(choose(omit, array(), array(v('argument'))))));
		return done({ value: root === 'Object' ? v('result') : method(v('result'), 'valueOf'), type: typeOf(v('result')), truthy: call(global('Boolean'), [v('result')]),
			...(root === 'Object' ? { sameInputIdentity: binary('===', v('result'), v('argument')), keys: method(global('Object'), 'keys', [v('result')]) } : {}),
			...(root === 'Symbol' ? { description: get(v('result'), 'description'), sameDescriptionIsSameSymbol: binary('===', v('result'), call(global('Symbol'), [v('argument')])) } : {}),
			...(root === 'Number' ? { negativeZero: method(global('Object'), 'is', [method(v('result'), 'valueOf'), { op: 'unary', operator: '-', value: 0 }]) } : {}) },
			'Compare primitive conversion with object construction, native truthiness and identity. BigInt and Symbol are callable but cannot be constructed. Object preserves an existing object; null or undefined creates a fresh one.');
	}
	if (root === 'Array') {
		const args = param('args', 'Constructor argument list', ['HTML', 'CSS', 'JavaScript']); bounded(get(args, 'length'));
		bounded(choose(binary('&&', binary('===', get(args, 'length'), 1), binary('===', typeOf(get(args, 0)), 'number')), get(args, 0), 0));
		p.steps!.push(declare('result', invoke(args)));
		return done({ length: get(v('result'), 'length'), ownIndexes: method(global('Object'), 'keys', [v('result')]), values: from(v('result')), hasFirstElement: method(global('Object'), 'hasOwn', [v('result'), 0]) },
			'One numeric argument creates a sparse array of that length. A string or several arguments creates actual elements. Compare own indexes with materialized values; this demo caps large allocations at 4096.');
	}
	if (root === 'TypedArray' || TYPED_ARRAY_CONSTRUCTORS.includes(root)) {
		const selected = root === 'TypedArray' ? selection('type', 'Concrete typed array', 'Uint8Array', TYPED_ARRAY_CONSTRUCTORS) : root;
		p.steps!.push(declare('types', object(Object.fromEntries(TYPED_ARRAY_CONSTRUCTORS.map(name => [name, choose(binary('===', typeOf(global(name)), 'undefined'), null, global(name))])))), declare('type', get(v('types'), selected)),
			{ op: 'if', test: binary('===', v('type'), null), then: returns(object({ status: 'unsupported', missing: array(selected), message: 'This native constructor is unavailable.' })) });
		const mode = selection('mode', 'Constructor overload', 'values', ['values', 'length', 'copy', 'buffer', 'array-like']);
		const big = method(selected, 'startsWith', ['Big']);
		const convert = (value: unknown) => choose(big, call(global('BigInt'), [value]), value);
		const values = param('values', 'Source values (strings preserve large BigInts)', [3, 1, 4, 1, 5]);
		const length = param('length', 'Element count for length, buffer or array-like mode', 3, 'number'); bounded(length);
		p.steps!.push(declare('values', method(values, 'map', [fn(['value'], convert(v('value')))])), declare('source', { op: 'new', target: v('type'), args: [v('values')] }));
		const arrayLike = method(global('Object'), 'assign', [object({}), v('values'), object({ length })]);
		const sequenceArgs = array(choose(binary('===', mode, 'array-like'), arrayLike, v('values')));
		const bufferArgs = array(get(v('source'), 'buffer'), param('offset', 'Buffer byte offset', 0, 'number'), length);
		const args = choose(binary('===', mode, 'length'), array(length), choose(binary('===', mode, 'copy'), array(v('source')), choose(binary('===', mode, 'buffer'), bufferArgs, sequenceArgs)));
		p.steps!.push(declare('result', invoke(args, v('type'))), declare('beforeMutation', from(v('result'))), perform(method(global('Reflect'), 'set', [v('source'), 0, convert(param('replacement', 'Write first source element after construction', 9))])));
		return done({ type: get(v('type'), 'name'), beforeMutation: v('beforeMutation'), afterMutation: from(v('result')), source: from(v('source')), sharesBuffer: binary('===', get(v('result'), 'buffer'), get(v('source'), 'buffer')), byteOffset: get(v('result'), 'byteOffset'), byteLength: get(v('result'), 'byteLength') },
			'Construct from iterable values, an element count, a typed array copy, a shared buffer window or an array-like object. Mutating the retained source distinguishes copying from shared storage. TypedArray in the standard is a family placeholder; choose a real concrete constructor. Native alignment and BigInt conversion errors stay visible. Allocations are capped at 4096 elements.');
	}
	if (root === 'ArrayBuffer' || root === 'SharedArrayBuffer') {
		const length = param('length', 'Initial byte length', 8, 'number'); const maximum = param('maximum', 'Maximum byte length', 32, 'number'); bounded(length); bounded(maximum);
		const resizable = param('resizable', 'Allow resizing or growth', true, 'boolean');
		p.steps!.push(declare('result', invoke(choose(resizable, array(length, object({ maxByteLength: maximum })), array(length)))));
		return done({ byteLength: get(v('result'), 'byteLength'), maxByteLength: get(v('result'), 'maxByteLength'), [root === 'SharedArrayBuffer' ? 'growable' : 'resizable']: get(v('result'), root === 'SharedArrayBuffer' ? 'growable' : 'resizable'), bytes: from(make('Uint8Array', [v('result')])) },
			'Construct the actual buffer with or without a maximum length and inspect native zero initialization. SharedArrayBuffer requires a context exposing it; this example does not grant cross-origin isolation. This demo caps allocations at 4096 bytes.');
	}
	if (root === 'DataView') {
		const bytes = param('bytes', 'Backing bytes', [1, 2, 3, 4, 5, 6]); bounded(choose(binary('===', typeOf(bytes), 'object'), get(bytes, 'length'), bytes));
		p.steps!.push(declare('bytes', make('Uint8Array', [bytes])), declare('result', invoke(array(get(v('bytes'), 'buffer'), param('offset', 'Byte offset', 1, 'number'), param('length', 'View byte length', 4, 'number')))),
			perform(method(v('result'), 'setUint8', [0, param('value', 'Write at view index zero', 255, 'number')])));
		return done({ byteOffset: get(v('result'), 'byteOffset'), byteLength: get(v('result'), 'byteLength'), sharesBuffer: binary('===', get(v('result'), 'buffer'), get(v('bytes'), 'buffer')), bytes: from(v('bytes')) }, 'Construct a real DataView window, write its first byte and observe the changed backing buffer. Invalid construction bounds or writes produce native errors. Backing allocation is capped at 4096 bytes by this demo.');
	}
	if (root === 'Date') {
		const args = param('args', 'Date argument list (numeric fields use local time)', ['2026-09-23T12:00:00Z']); bounded(get(args, 'length'));
		p.steps!.push(declare('result', invoke(args)));
		const isObject = binary('===', typeOf(v('result')), 'object');
		return done({ type: typeOf(v('result')), text: call(global('String'), [v('result')]), epoch: choose(isObject, method(v('result'), 'valueOf'), null), iso: choose(isObject, choose(method(global('Number'), 'isNaN', [method(v('result'), 'valueOf')]), null, method(v('result'), 'toISOString')), null) },
			'Construct from an ISO string, timestamp or local numeric date fields. Calling Date without new returns the current local date string and ignores arguments. Invalid dates preserve NaN and show no ISO string.');
	}
	if (errors.includes(root) || root === 'NativeError' || root === 'AggregateError') {
		let target: unknown = global(root);
		if (root === 'NativeError') { const name = selection('type', 'Native error constructor', 'TypeError', errors.slice(1)); p.steps!.push(declare('types', object(Object.fromEntries(errors.map(name => [name, global(name)]))))); target = get(v('types'), name); }
		const args = [param('message', 'Error message', 'Thingtime example', 'text'), param('options', 'Error options', { cause: 'Original cause' })];
		if (root === 'AggregateError') args.unshift(param('errors', 'Errors iterable', ['First failure', 'Second failure']));
		p.steps!.push(declare('result', invoke(array(...args), target)), declare('causeDescriptor', method(global('Object'), 'getOwnPropertyDescriptor', [v('result'), 'cause'])));
		const descriptorFlags = (descriptor: unknown) => choose(binary('===', descriptor, { op: 'undefined' }), null, project(descriptor, ['writable', 'enumerable', 'configurable']));
		return done({ name: get(v('result'), 'name'), message: get(v('result'), 'message'), cause: get(v('result'), 'cause'), causeDescriptor: descriptorFlags(v('causeDescriptor')), ownEnumerableKeys: method(global('Object'), 'keys', [v('result')]), ...(root === 'AggregateError' ? { errors: get(v('result'), 'errors'), errorsDescriptor: descriptorFlags(method(global('Object'), 'getOwnPropertyDescriptor', [v('result'), 'errors'])) } : {}) },
			'Create the actual error and inspect message, cause and property descriptors. AggregateError consumes its errors iterable. NativeError is a specification family name; the type input selects an actual native constructor.');
	}
	if (root === 'Map' || root === 'Set') {
		const iterable = param('iterable', 'Constructor iterable', root === 'Map' ? [['one', 1], ['two', 2], ['one', 3]] : [1, 2, 2, 3]);
		p.steps!.push(declare('result', invoke(array(iterable))));
		return done({ size: get(v('result'), 'size'), entries: from(v('result')), has: method(v('result'), 'has', [param('key', 'Lookup key', root === 'Map' ? 'one' : 2)]) }, 'The native constructor consumes the iterable. Duplicate keys update Map values without changing their position; Set removes duplicate values. Null supplies an empty collection. Invalid entries keep native errors.');
	}
	if (root === 'WeakMap' || root === 'WeakSet' || root === 'WeakRef') {
		p.steps!.push(declare('key', param('key', 'Strongly retained target object', { label: 'Thingtime' })), declare('other', method(global('Object'), 'assign', [object({}), v('key')])));
		if (root === 'WeakRef') { p.steps!.push(declare('result', invoke(array(v('key'))))); return done({ value: method(v('result'), 'deref'), sameIdentity: binary('===', method(v('result'), 'deref'), v('key')) }, 'Construct a native WeakRef and dereference the strongly retained target. This deterministic run does not force garbage collection or promise cleanup timing.'); }
		const values = root === 'WeakMap' ? array(array(v('key'), param('first', 'First stored value', 'first')), array(v('key'), param('last', 'Last stored value', 'last'))) : array(v('key'), v('key'));
		p.steps!.push(declare('result', invoke(array(values))));
		return done({ hasOriginal: method(v('result'), 'has', [v('key')]), hasEqualLookingObject: method(v('result'), 'has', [v('other')]), ...(root === 'WeakMap' ? { value: method(v('result'), 'get', [v('key')]) } : {}) }, 'Construct from repeated references to one retained object and compare a distinct equal-looking object. Weak collection keys use identity. Invalid primitive targets produce native constructor errors.');
	}
	if (root === 'FinalizationRegistry') {
		p.steps!.push(declare('cleanup', array()), declare('target', object({})), declare('token', object({})), declare('result', invoke(array(choose(param('callable', 'Provide a callable cleanup callback', true, 'boolean'), fn(['held'], method(v('cleanup'), 'push', [v('held')])), null)))),
			perform(method(v('result'), 'register', [v('target'), param('held', 'Held value', 'Thingtime'), v('token')])), declare('removed', method(v('result'), 'unregister', [v('token')])));
		return done({ removed: v('removed'), secondRemoval: method(v('result'), 'unregister', [v('token')]), cleanup: v('cleanup') }, 'Construct with a saved callback, register a retained target, then unregister it. A non-callable callback is rejected. No cleanup callback or garbage-collection schedule is promised.');
	}
	if (root === 'Promise') {
		const mode = selection('settlement', 'Executor behavior', 'resolve', ['resolve', 'reject', 'throw', 'resolve-then-throw']);
		const value = param('value', 'Settlement value', 'Thingtime'); const thenable = param('thenable', 'Resolve through a thenable', false, 'boolean');
		p.steps!.push(declare('trace', array())); const trace = (text: string) => perform(method(v('trace'), 'push', [text]));
		const promiseValue = choose(thenable, object({ then: func(['resolve'], [trace('thenable called'), perform(call(v('resolve'), [value]))]) }), value);
		const executor = func(['resolve', 'reject'], [trace('executor started'), { op: 'if', test: binary('===', mode, 'throw'), then: [{ op: 'throw', value: make('Error', [value]) }] },
			perform(call(choose(binary('===', mode, 'reject'), v('reject'), v('resolve')), [choose(binary('===', mode, 'reject'), value, promiseValue)])), trace('first settlement requested'),
			{ op: 'if', test: param('second', 'Attempt another settlement', true, 'boolean'), then: [perform(call(v('reject'), ['Ignored second rejection']))] },
			{ op: 'if', test: binary('===', mode, 'resolve-then-throw'), then: [{ op: 'throw', value: make('Error', ['Ignored throw after resolve']) }] }]);
		const fulfilled = func(['value'], [trace('fulfilled reaction'), ...returns(object({ state: 'fulfilled', value: v('value') }))]);
		const rejected = func(['reason'], [trace('rejected reaction'), ...returns(object({ state: 'rejected', reason: call(global('String'), [v('reason')]) }))]);
		p.steps!.push(declare('result', invoke(array(choose(param('callable', 'Provide a callable executor', true, 'boolean'), executor, null)))), declare('beforeAwait', from(v('trace'))), declare('settled', awaited(method(v('result'), 'then', [fulfilled, rejected]))));
		return done({ beforeAwait: v('beforeAwait'), settled: v('settled'), trace: v('trace') }, 'Construct the native Promise with an editable data-defined executor. Its executor runs synchronously; reactions and thenable assimilation run as jobs. The first settlement wins, including resolution to a still-pending thenable.');
	}
	if (root === 'Proxy') {
		const key = param('key', 'Property key', 'count', 'text'); const delta = param('delta', 'Numeric get adjustment', 3, 'number');
		p.steps!.push(declare('target', param('target', 'Target object', { count: 2 })), declare('trace', array()), { op: 'if', test: param('fixed', 'Make property non-configurable and read-only', false, 'boolean'), then: [perform(method(global('Object'), 'defineProperty', [v('target'), key, object({ value: get(v('target'), key), writable: false, configurable: false })]))] },
			declare('handler', object({ get: func(['target', 'key', 'receiver'], [perform(method(v('trace'), 'push', [object({ trap: 'get', key: v('key') })])), declare('value', method(global('Reflect'), 'get', [v('target'), v('key'), v('receiver')])), ...returns(choose(binary('===', typeOf(v('value')), 'number'), binary('+', v('value'), delta), v('value')))]), set: func(['target', 'key', 'value', 'receiver'], [perform(method(v('trace'), 'push', [object({ trap: 'set', key: v('key'), value: v('value') })])), ...returns(choose(param('allowWrite', 'Allow writes through the trap', true, 'boolean'), method(global('Reflect'), 'set', [v('target'), v('key'), v('value'), v('receiver')]), false))]) })),
			declare('result', invoke(array(v('target'), v('handler')))), declare('read', get(v('result'), key)), declare('written', method(global('Reflect'), 'set', [v('result'), key, param('value', 'Value to write', 10)])));
		return done({ read: v('read'), writeAccepted: v('written'), targetValue: get(v('target'), key), trace: v('trace') }, 'Construct an actual Proxy with reusable get/set callbacks. Compare intercepted reads with the underlying target and refused writes. A get trap cannot misreport a fixed read-only property; that invariant produces the native TypeError.');
	}
	if (root === 'RegExp') {
		const pattern = param('pattern', 'Pattern', '[a-z]+', 'text'); const flags = param('flags', 'Flags', 'g', 'text');
		p.steps!.push(declare('pattern', choose(param('existing', 'Pass an existing RegExp', false, 'boolean'), make('RegExp', [pattern, flags]), pattern)), declare('result', invoke(choose(param('omitFlags', 'Omit the flags argument', false, 'boolean'), array(v('pattern')), array(v('pattern'), flags)))),
			declare('first', method(v('result'), 'exec', [param('text', 'Text to match', 'one two', 'text')])), declare('indexAfterFirst', get(v('result'), 'lastIndex')), declare('second', method(v('result'), 'exec', [input('text')])));
		const match = (name: string) => choose(binary('===', v(name), null), null, object({ values: from(v(name)), index: get(v(name), 'index'), groups: get(v(name), 'groups') }));
		return done({ source: get(v('result'), 'source'), flags: get(v('result'), 'flags'), sameInputIdentity: binary('===', v('result'), v('pattern')), first: match('first'), indexAfterFirst: v('indexAfterFirst'), second: match('second'), indexAfterSecond: get(v('result'), 'lastIndex') }, 'Calling RegExp with an existing RegExp and omitted flags preserves identity; construction creates a copy. Native exec state reveals global/sticky lastIndex behavior. Patterns run only in the terminable worker.');
	}
	if (root === 'Iterator') {
		p.steps!.push({ op: 'class', name: 'ExampleIterator', extends: global('Iterator'), members: [{ kind: 'field', name: 'index', value: 0 }, { kind: 'method', name: 'next', params: [], body: [declare('index', { op: 'update', target: get({ op: 'this' }, 'index'), operator: '++' }), ...returns(object({ value: get(input('values'), v('index')), done: binary('>=', v('index'), get(input('values'), 'length')) }))] }] });
		bounded(get(param('values', 'Subclass iterator values', [1, 2, 3]), 'length'));
		p.steps!.push(declare('result', invoke(array(), choose(param('subclass', 'Construct a subclass that calls super', true, 'boolean'), v('ExampleIterator'), global('Iterator')))));
		return done({ values: from(v('result')), nativePrototype: method(get(global('Iterator'), 'prototype'), 'isPrototypeOf', [v('result')]) }, 'Iterator is an abstract constructor. A real data-defined subclass calls its super constructor and supplies next; direct construction or calling without new produces native TypeError. This demo caps materialization at 4096 values.');
	}
}
