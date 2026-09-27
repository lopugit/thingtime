import type { Feature, PlatformProgram, Recipe } from './types';
import { base, parameter, input, global, get, method, make, recipe, returns, variable as v, object, array, fn, call, awaited, declare, perform } from './programBuilders';

const binary = (operator: string, left: unknown, right: unknown) => ({ op: 'binary', operator, left, right });
const choose = (test: unknown, then: unknown, otherwise: unknown) => ({ op: 'conditional', test, then, else: otherwise });
const proto = (value: unknown) => method(global('Object'), 'getPrototypeOf', [value]);
const from = (value: unknown) => method(global('Array'), 'from', [value]);
const symbol = (name: string) => get(global('Symbol'), name);
const functionNode = (params: string[], body: unknown[]) => ({ op: 'function-expression', params, body });
const assign = (name: string, value: unknown) => ({ op: 'assign', name, value });
const describeError = () => object({ name: { ...get(v('error'), 'name'), optional: true }, message: call(global('String'), [v('error')]) });
const append = (value: unknown) => perform(method(v('trace'), 'push', [value]));
const traceSnapshot = () => method(v('trace'), 'map', [fn(['entry'], choose(binary('===', { op: 'unary', operator: 'typeof', value: v('entry') }, 'object'), method(global('Object'), 'assign', [object({}), v('entry')]), v('entry')))]);

/** Native iterator state and protocol calls stay authored in the saved program.
 * Hidden adapters are exercised by actual language constructs, never emulated. */
export function javascriptIteratorRecipe(f: Feature): Recipe | undefined {
	const name = f.name.split(' (')[0].trim();
	const match = /^%(ArrayIteratorPrototype|MapIteratorPrototype|SetIteratorPrototype|StringIteratorPrototype|RegExpStringIteratorPrototype|IntlSegmentIteratorPrototype|IntlSegmentsPrototype|IteratorHelperPrototype|WrapForValidIteratorPrototype|GeneratorPrototype|AsyncGeneratorPrototype|AsyncIteratorPrototype|AsyncFromSyncIteratorPrototype|ForInIteratorPrototype)%(?:\.(\w+)| \[ %Symbol\.(\w+)% \])$/.exec(name);
	if (!match && name !== '%Symbol.toStringTag%') return;
	const [, family, member, symbolMember] = match || [];
	if (symbolMember && !(['GeneratorPrototype', 'AsyncGeneratorPrototype'].includes(family) && symbolMember === 'toStringTag') && !(family === 'AsyncIteratorPrototype' && symbolMember === 'asyncIterator')) return;
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [], requires: [] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type)); return input(name);
	};
	const done = (value: unknown, note: string) => recipe({ ...p, steps: [...p.steps!, ...returns(value)] }, 'interactive', note);
	const capture = (key: string, expression: unknown) => [declare(key, null), { op: 'try', body: [assign(key, object({ status: 'fulfilled', value: awaited(expression) }))], error: 'error', catch: [assign(key, object({ status: 'rejected', error: describeError() }))] }];
	if (name === '%Symbol.toStringTag%') {
		p.steps!.push(declare('target', object({ value: param('value', 'Object value', 'Thingtime', 'text') })),
			perform(method(global('Reflect'), 'set', [v('target'), symbol('toStringTag'), param('tag', 'Object tag', 'Thingtime', 'text')])));
		return done(object({ symbol: symbol('toStringTag'), tag: get(v('target'), symbol('toStringTag')), nativeString: method(global('Reflect'), 'apply', [get(get(global('Object'), 'prototype'), 'toString'), v('target'), array()]), ownSymbols: method(global('Object'), 'getOwnPropertySymbols', [v('target')]), target: v('target') }), 'Set the actual well-known symbol on a fresh object and observe its effect on the native Object.prototype.toString operation.');
	}
	if (family === 'ForInIteratorPrototype') {
		p.steps!.push(declare('target', method(global('Object'), 'assign', [method(global('Object'), 'create', [param('parent', 'Inherited enumerable properties', { inherited: 3, shadowed: 4 })]), param('own', 'Own enumerable properties', { first: 1, second: 2 })])),
			perform(method(global('Object'), 'defineProperty', [v('target'), 'shadowed', object({ value: 'non-enumerable own property', enumerable: false })])), declare('visited', array()),
			{ op: 'for-in', name: 'key', value: v('target'), body: [perform(method(v('visited'), 'push', [object({ key: v('key'), value: get(v('target'), v('key')), own: method(global('Object'), 'hasOwn', [v('target'), v('key')]) })])),
				{ op: 'if', test: binary('===', get(v('visited'), 'length'), 1), then: [perform(method(global('Reflect'), 'deleteProperty', [v('target'), param('remove', 'Delete after first iteration (empty preserves fields)', '', 'text')]))] }] });
		return done(object({ visited: v('visited'), remainingOwnKeys: method(global('Object'), 'keys', [v('target')]) }), 'The internal ForIn iterator is exercised by the real for-in statement. Observe own/inherited enumeration, non-enumerable shadowing and a deletion before the next step. The internal object is not exposed as a public constructor.');
	}
	if (family === 'AsyncFromSyncIteratorPrototype' || family === 'WrapForValidIteratorPrototype') {
		const adapter = family === 'AsyncFromSyncIteratorPrototype';
		if (!adapter) p.requires = [['Iterator', 'from']];
		const values = param('values', 'Synchronous source values', [1, 2, 3]);
		const returnValue = param('returnValue', 'Source return value', 'closed', 'text');
		const includeReturn = param('includeReturn', 'Source has a return method', true, 'boolean');
		p.steps!.push(declare('index', 0), declare('closed', false), declare('trace', array()));
		const wrapValue = (value: unknown) => adapter ? method(global('Promise'), 'resolve', [value]) : value;
		const nextBody = [append(object({ operation: 'next', sent: v('sent') })),
			{ op: 'if', test: binary('||', v('closed'), binary('>=', v('index'), get(values, 'length'))), then: returns(object({ done: true, value: { op: 'undefined' } })) },
			declare('value', get(values, v('index'))), perform({ op: 'update', target: v('index'), operator: '++' }), ...returns(object({ done: false, value: wrapValue(v('value')) }))];
		const returnBody = [append(object({ operation: 'return', sent: v('sent') })), assign('closed', true), ...returns(object({ done: true, value: wrapValue(returnValue) }))];
		p.steps!.push(declare('source', object({ next: functionNode(['sent'], nextBody), return: functionNode(['sent'], returnBody) })),
			{ op: 'if', test: { op: 'unary', operator: '!', value: includeReturn }, then: [perform(method(global('Reflect'), 'deleteProperty', [v('source'), 'return']))] });
		if (adapter) {
			const includeThrow = param('includeThrow', 'Source has a throw method', true, 'boolean');
			p.steps!.push(perform(method(global('Reflect'), 'set', [v('source'), symbol('iterator'), fn([], v('source'))])),
				{ op: 'if', test: includeThrow, then: [perform(method(global('Reflect'), 'set', [v('source'), 'throw', functionNode(['reason'], [append(object({ operation: 'throw', reason: v('reason') })), ...returns(object({ done: false, value: wrapValue(param('recovered', 'Source recovery value', 'recovered', 'text')) }))])]))] },
				declare('factory', { op: 'function-expression', params: [], async: true, generator: true, body: returns({ op: 'yield', delegate: true, value: v('source') }) }), declare('iterator', call(v('factory'))));
		} else p.steps!.push(declare('iterator', method(global('Iterator'), 'from', [v('source')])));
		p.steps!.push(...capture('first', method(v('iterator'), 'next')));
		const args = adapter ? [param('signal', 'Sent value / return value / exception', 'signal', 'text')] : [];
		p.steps!.push(...capture('operation', method(v('iterator'), member, args)), declare('traceAtOperation', traceSnapshot()), ...capture('after', method(v('iterator'), 'next')));
		const cleanupObserved = method(v('traceAtOperation'), 'some', [fn(['entry'], binary('===', get(v('entry'), 'operation'), 'return'))]);
		const missingThrowCheck = adapter && member === 'throw' ? {
			missingThrowCheck: choose(input('includeThrow'), null, object({
				expected: 'Close the source when return is present, then reject with TypeError (ECMA-262 2026).',
				cleanupObserved,
				matchesPublishedBehavior: binary('&&', binary('===', { ...get(get(v('operation'), 'error'), 'name'), optional: true }, 'TypeError'), binary('||', { op: 'unary', operator: '!', value: includeReturn }, cleanupObserved))
			}))
		} : {};
		return done(object({ first: v('first'), operation: v('operation'), after: v('after'), traceAtOperation: v('traceAtOperation'), trace: v('trace'), ...missingThrowCheck, ...(adapter ? { observedThrough: 'async generator yield*' } : { distinctWrapper: binary('!==', v('iterator'), v('source')) }) }), adapter
			? 'An actual async generator yield* delegates to a synchronous iterable, exercising the engine\'s hidden AsyncFromSync adapter. Observe awaited values, forwarded next/return/throw calls and native errors when throw is missing. This is a protocol trace, not a separately exposed adapter object. The missing-throw check compares native cleanup and rejection against ECMA-262 2026; older engines may report a mismatch.'
			: 'Iterator.from creates the actual native wrapper around a plain iterator object. Calls forward to the source; when return is absent, a completed return result does not invent source cleanup or prevent subsequent next calls.');
	}
	if (['GeneratorPrototype', 'AsyncGeneratorPrototype', 'AsyncIteratorPrototype'].includes(family)) {
		const async = family !== 'GeneratorPrototype';
		const firstValue = param('first', 'First yielded value', 'first', 'text');
		const secondValue = param('second', 'Second yielded value', 'second', 'text');
		const complete = param('complete', 'Normal completion value', 'complete', 'text');
		const handleThrow = param('handleThrow', 'Catch thrown exception', true, 'boolean');
		const yieldCleanup = param('yieldCleanup', 'Yield during finally cleanup', false, 'boolean');
		const cleanup = param('cleanup', 'Cleanup yield value', 'cleanup', 'text');
		p.steps!.push(declare('trace', array()), declare('factory', { op: 'function-expression', params: [], generator: true, async,
			body: [{ op: 'try', body: [declare('sent', { op: 'yield', value: firstValue }), append(object({ received: v('sent') })), perform({ op: 'yield', value: secondValue }), ...returns(complete)],
				error: 'error', catch: [append(object({ caught: call(global('String'), [v('error')]) })), { op: 'if', test: { op: 'unary', operator: '!', value: handleThrow }, then: [{ op: 'throw', value: v('error') }] }, perform({ op: 'yield', value: 'recovered' }), ...returns(complete)],
				finally: [append('finally'), { op: 'if', test: yieldCleanup, then: [perform({ op: 'yield', value: cleanup })] }] }] }), declare('iterator', call(v('factory'))));
		if (symbolMember === 'asyncIterator') {
			p.steps!.push(declare('returned', call(get(v('iterator'), symbol('asyncIterator')))), ...capture('first', method(v('returned'), 'next')));
			return done(object({ sameIterator: binary('===', v('returned'), v('iterator')), first: v('first') }), 'Invoke the real AsyncIterator prototype symbol method on an async generator. It returns the same iterator; next resolves to the actual yielded value.');
		}
		p.steps!.push(declare('prototype', proto(proto(v('iterator')))), ...capture('firstResult', method(v('iterator'), 'next')));
		if (symbolMember === 'toStringTag' || member === 'constructor') {
			p.steps!.push(declare('descriptor', method(global('Object'), 'getOwnPropertyDescriptor', [v('prototype'), member === 'constructor' ? 'constructor' : symbol('toStringTag')])));
			return done(object({ first: v('firstResult'), descriptor: v('descriptor'), receiverUsesPrototype: method(v('prototype'), 'isPrototypeOf', [v('iterator')]), ...(member === 'constructor' ? { expectedConstructor: binary('===', get(v('descriptor'), 'value'), proto(v('factory'))) } : { tag: get(v('iterator'), symbol('toStringTag')) }) }), 'Observe the actual shared generator prototype descriptor and run a generator of that family. Constructor identity is compared through reflection without evaluating source-string constructors.');
		}
		const signal = param('signal', 'Sent value / return value / exception', 'signal', 'text');
		p.steps!.push(...capture('operation', method(v('iterator'), member, [async && member === 'return' ? method(global('Promise'), 'resolve', [signal]) : signal])), declare('traceAtOperation', traceSnapshot()), ...capture('after', method(v('iterator'), 'next')), ...capture('final', method(v('iterator'), 'next')));
		return done(object({ first: v('firstResult'), operation: v('operation'), after: v('after'), final: v('final'), traceAtOperation: v('traceAtOperation'), trace: v('trace') }), 'Drive the native generator state with next, return or throw. Toggle exception handling and a yield inside finally to observe suspended cleanup and final completion. Async return values are genuinely awaited.');
	}
	if (family === 'IteratorHelperPrototype') {
		p.requires = [['Iterator', 'prototype', 'map']];
		p.steps!.push(declare('trace', array()), declare('factory', { op: 'function-expression', params: [], generator: true,
			body: [{ op: 'try', body: [{ op: 'for-of', name: 'value', value: param('values', 'Source values', [1, 2, 3]), body: [perform({ op: 'yield', value: v('value') })] }], error: 'error', catch: [{ op: 'throw', value: v('error') }], finally: [append('source closed')] }] }),
			declare('source', call(v('factory'))), declare('iterator', method(v('source'), 'map', [functionNode(['value'], [append(v('value')), ...returns(binary('*', v('value'), param('factor', 'Multiplier', 2, 'number')))])])),
			declare('first', method(v('iterator'), 'next')), declare('operation', method(v('iterator'), member)), declare('traceAtOperation', traceSnapshot()), declare('after', method(v('iterator'), 'next')));
		return done(object({ first: v('first'), operation: v('operation'), after: v('after'), traceAtOperation: v('traceAtOperation'), trace: v('trace') }), 'Use the real helper iterator returned by native Iterator.map. Each next consumes only its needed value; return closes the source generator and executes its finally block.');
	}
	let iterator: unknown;
	if (family === 'ArrayIteratorPrototype') iterator = method(param('values', 'Array values', [1, 2, 3]), 'values');
	else if (family === 'MapIteratorPrototype') iterator = method(make('Map', [param('entries', 'Map entries', [['one', 1], ['two', 2], ['three', 3]])]), 'entries');
	else if (family === 'SetIteratorPrototype') iterator = method(make('Set', [param('values', 'Set values (duplicates collapse)', [1, 2, 2, 3])]), 'values');
	else if (family === 'StringIteratorPrototype') iterator = call(get(param('text', 'Unicode text', 'A🌈B', 'text'), symbol('iterator')));
	else if (family === 'RegExpStringIteratorPrototype') iterator = method(param('text', 'Text to match', 'one two three', 'text'), 'matchAll', [make('RegExp', [param('pattern', 'Pattern', '[a-z]+', 'text'), param('flags', 'Flags (must include g)', 'gu', 'text')])]);
	else if (family === 'IntlSegmentIteratorPrototype' || family === 'IntlSegmentsPrototype') {
		p.requires = [['Intl', 'Segmenter']];
		p.steps!.push(declare('segments', method({ op: 'new', target: get(global('Intl'), 'Segmenter'), args: [param('locale', 'Locale', 'en-AU', 'text'), param('options', 'Segmentation options', { granularity: 'grapheme' })] }, 'segment', [param('text', 'Text to segment', 'A🌈 B', 'text')])));
		if (family === 'IntlSegmentsPrototype') return done(method(v('segments'), 'containing', [param('index', 'UTF-16 index', 2, 'number')]), 'Use the actual segments receiver. The index is measured in UTF-16 code units, so both halves of a surrogate pair select the same native segment.');
		iterator = call(get(v('segments'), symbol('iterator')));
	} else return;
	p.steps!.push(declare('iterator', iterator), declare('first', method(v('iterator'), 'next')), declare('second', method(v('iterator'), 'next')), declare('remaining', from(v('iterator'))), declare('afterCompletion', method(v('iterator'), 'next')));
	return done(object({ first: v('first'), second: v('second'), remaining: v('remaining'), afterCompletion: v('afterCompletion') }), 'Step the actual native iterator twice, consume its remaining values, then observe its completed next result. Editable inputs reveal collection ordering, deduplication, Unicode iteration or native segmentation behavior.');
}
