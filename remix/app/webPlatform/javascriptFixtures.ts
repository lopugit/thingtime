import type { Feature, PlatformProgram, Recipe } from './types';
import { parameter, global, input, literal, get, method, make, returns, base, recipe } from './programBuilders';
const variable = (name: string) => ({ op: 'variable', name });
const call = (target: unknown, args: unknown[] = []) => ({ op: 'call', target, args });
const fn = (params: string[], value: unknown) => ({ op: 'function', params, value });
const object = (entries: [string, unknown][]) => ({ op: 'object', entries });
const array = (items: unknown[]) => ({ op: 'array', items });
const big = (value: unknown) => call(global('BigInt'), [value]);
const done = (p: PlatformProgram, value: unknown, note?: string): Recipe =>
	recipe({ ...p, steps: [...(p.steps || []), ...returns(value)] }, 'interactive', note);
const twice = fn(['value'], { op: 'binary', operator: '*', left: variable('value'), right: 2 });
const sample = { hello: 'Thingtime', count: 3 };

/** Purposeful receivers and callbacks are authored data nodes, copied intact
 * into saved Components. The runtime never dispatches by standard/feature ID. */
export function javascriptFixture(f: Feature, name: string): Recipe | null {
	const parts = name.split('.'),
		root = parts[0],
		member = parts.at(-1)!;
	if (f.kind !== 'built-in' || ['constructor', '__proto__'].includes(member) || parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)))
		return null;
	const p: PlatformProgram = { ...base(f), parameters: [], requires: [[root]] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type));
		return input(name);
	};
	if (root === 'Intl') {
		if (parts.length === 2 && member === 'supportedValuesOf') {
			p.requires = [['Intl', 'supportedValuesOf']];
			return done(p, method(global('Intl'), member, [param('key', 'Value family', 'calendar', 'text')]));
		}
		const type = parts[1],
			ctor = get(global('Intl'), type);
		if (
			![
				'Collator',
				'DateTimeFormat',
				'DisplayNames',
				'DurationFormat',
				'ListFormat',
				'Locale',
				'NumberFormat',
				'PluralRules',
				'RelativeTimeFormat',
				'Segmenter'
			].includes(type)
		)
			return null;
		p.requires = [['Intl', type]];
		if (parts.includes('prototype') && !['prototype', 'constructor'].includes(member)) p.requires.push(['Intl', type, 'prototype', member]);
		const locale = param('locale', 'Locale', type === 'Locale' ? 'en-Latn-AU-u-ca-gregory-hc-h23-nu-latn' : 'en-AU', 'text');
		const options = param(
			'options',
			'Options',
			type === 'DisplayNames'
				? { type: 'region' }
				: type === 'DateTimeFormat'
				? { dateStyle: 'medium', timeZone: 'UTC' }
				: type === 'Segmenter'
				? { granularity: 'word' }
				: {}
		);
		if (member === 'supportedLocalesOf') return done(p, method(ctor, member, [locale, options]));
		const target = { op: 'new', target: ctor, args: [locale, options] };
		if (parts.length === 2 || ['prototype', 'constructor'].includes(member))
			return done(p, type === 'Locale' ? method(target, 'toString') : method(target, 'resolvedOptions'));
		if (f.name.startsWith('get ') && !['format', 'compare'].includes(member)) return done(p, get(target, member));
		let args: unknown[] = [];
		if (type === 'Collator' && member === 'compare')
			args = [param('left', 'Left text', 'apple', 'text'), param('right', 'Right text', 'banana', 'text')];
		else if (type === 'DateTimeFormat' && member.startsWith('format')) {
			args = [param('start', 'Timestamp (milliseconds)', 1781956800000, 'number')];
			if (member.includes('Range')) args.push(param('end', 'End timestamp', 1782129600000, 'number'));
		} else if (type === 'NumberFormat' && member.startsWith('format')) {
			args = [param('value', 'Number', 12345.67, 'number')];
			if (member.includes('Range')) args.push(param('end', 'End number', 23456.78, 'number'));
		} else if (type === 'DisplayNames' && member === 'of') args = [param('code', 'Region/language code', 'AU', 'text')];
		else if (type === 'DurationFormat' && member.startsWith('format'))
			args = [param('duration', 'Duration fields', { hours: 1, minutes: 23, seconds: 45 })];
		else if (type === 'ListFormat' && member.startsWith('format')) args = [param('items', 'List of strings', ['HTML', 'CSS', 'JavaScript'])];
		else if (type === 'PluralRules' && member.startsWith('select')) {
			args = [param('value', 'Number', 2, 'number')];
			if (member.endsWith('Range')) args.push(param('end', 'End number', 5, 'number'));
		} else if (type === 'RelativeTimeFormat' && member.startsWith('format'))
			args = [param('value', 'Relative amount', -2, 'number'), param('unit', 'Unit', 'day', 'text')];
		else if (type === 'Segmenter' && member === 'segment') args = [param('text', 'Text', 'Hello Thingtime 🌈', 'text')];
		let value: unknown = method(target, member, args);
		if (member === 'segment') value = method(global('Array'), 'from', [value]);
		return done(p, value);
	}
	if (root === 'Atomics' && !['isLockFree', 'pause'].includes(member)) {
		p.requires = [['Atomics', member]];
		// Arithmetic Atomics accept an ordinary integer typed array. Only waiting
		// and notifying need a shared backing buffer/cross-origin isolation.
		const shared = ['wait', 'waitAsync', 'notify'].includes(member);
		if (shared) p.requires.push(['SharedArrayBuffer']);
		const target = shared
			? make('Int32Array', [make('SharedArrayBuffer', [16])])
			: make('Int32Array', [param('values', 'Integer values', [3, 5, 8, 13])]);
		p.steps = [{ op: 'let', name: 'buffer', value: target }];
		const args: unknown[] = [variable('buffer'), param('index', 'Index', 0, 'number')];
		if (!['load', 'notify'].includes(member)) args.push(param('value', 'Value / expected value', 3, 'number'));
		if (member === 'compareExchange') args.push(param('replacement', 'Replacement', 9, 'number'));
		if (member === 'notify') args.push(param('count', 'Maximum waiters', 1, 'number'));
		if (member === 'wait' || member === 'waitAsync') args.push(param('timeout', 'Timeout (milliseconds)', 10, 'number'));
		p.steps.push({ op: 'let', name: 'outcome', value: method(global('Atomics'), member, args) });
		return done(
			p,
			object([
				['result', variable('outcome')],
				['values', method(global('Array'), 'from', [variable('buffer')])]
			])
		);
	}
	if (root === 'BigInt' && ['asIntN', 'asUintN'].includes(member))
		return done(p, method(global(root), member, [param('bits', 'Bit width', 8, 'number'), big(param('value', 'Integer string', '300', 'text'))]));
	if (root === 'ArrayBuffer' && parts[1] === 'prototype' && member === 'resize') {
		p.requires.push(['ArrayBuffer', 'prototype', 'resize']);
		p.steps = [
			{ op: 'let', name: 'buffer', value: make('ArrayBuffer', [8, literal({ maxByteLength: 64 })]) },
			{ op: 'expression', value: method(variable('buffer'), 'resize', [param('size', 'New byte length', 16, 'number')]) }
		];
		return done(p, get(variable('buffer'), 'byteLength'));
	}
	if (root === 'SharedArrayBuffer') {
		p.requires = [['SharedArrayBuffer']];
		const target = make(root, [param('size', 'Byte length', 8, 'number'), literal({ maxByteLength: 64 })]);
		p.steps = [{ op: 'let', name: 'buffer', value: target }];
		if (member === 'grow') {
			p.requires.push([root, 'prototype', 'grow']);
			p.steps.push({ op: 'expression', value: method(variable('buffer'), 'grow', [param('newSize', 'New byte length', 16, 'number')]) });
			return done(p, get(variable('buffer'), 'byteLength'));
		}
		if (member === 'slice') return done(p, method(variable('buffer'), 'slice', [0, 4]));
		return done(p, get(variable('buffer'), member === 'prototype' ? 'byteLength' : member));
	}
	if (root === 'Array' && member === 'fromAsync') {
		p.requires.push(['Array', 'fromAsync']);
		return done(p, method(global(root), member, [param('items', 'Items', [1, 2, 3]), twice]));
	}
	if (root === 'Object' || root === 'Reflect') {
		if (member === 'groupBy')
			return done(
				p,
				method(global(root), member, [
					param('items', 'Numbers', [1, 2, 3, 4]),
					fn(['value'], { op: 'binary', operator: '%', left: variable('value'), right: 2 })
				])
			);
		if (['__defineGetter__', '__defineSetter__'].includes(member)) {
			p.steps = [
				{ op: 'let', name: 'target', value: literal({}) },
				{ op: 'expression', value: method(variable('target'), member, ['demo', fn(['value'], param('value', 'Accessor value', 'Hello', 'text'))]) }
			];
			return done(
				p,
				member === '__defineGetter__'
					? get(variable('target'), 'demo')
					: method(global('Object'), 'getOwnPropertyDescriptor', [variable('target'), 'demo'])
			);
		}
		if (parts.includes('prototype')) return null;
		let args: unknown[] = [];
		const target = () => param('target', 'Target object', sample),
			key = () => param('key', 'Property name', 'hello', 'text');
		if (member === 'create') args = [param('prototype', 'Prototype fields', { category: 'example' })];
		else if (member === 'defineProperties')
			args = [target(), param('descriptors', 'Property descriptors', { answer: { value: 42, enumerable: true } })];
		else if (member === 'defineProperty')
			args = [target(), key(), param('descriptor', 'Property descriptor', { value: 'Updated', enumerable: true, configurable: true })];
		else if (['getOwnPropertyDescriptor', 'get', 'has', 'hasOwn', 'deleteProperty'].includes(member)) args = [target(), key()];
		else if (member === 'set') args = [target(), key(), param('value', 'New value', 'Updated', 'text')];
		else if (member === 'setPrototypeOf') args = [target(), param('prototype', 'Prototype object', { category: 'example' })];
		else if (member === 'apply') args = [twice, null, array([param('value', 'Number', 7, 'number')])];
		else if (member === 'construct') args = [global('Date'), array([param('timestamp', 'Timestamp', 1781956800000, 'number')])];
		else if (
			[
				'getOwnPropertyDescriptors',
				'getOwnPropertyNames',
				'getOwnPropertySymbols',
				'getPrototypeOf',
				'ownKeys',
				'isExtensible',
				'preventExtensions',
				'freeze',
				'seal',
				'isFrozen',
				'isSealed'
			].includes(member)
		)
			args = [target()];
		else return null;
		return done(p, method(global(root), member, args));
	}
	if ((root === 'Map' || root === 'Set') && member === 'forEach') {
		const receiver =
			root === 'Map'
				? param('entries', 'Map entries', [
						['one', 1],
						['two', 2]
				  ])
				: param('items', 'Set items', [1, 2, 3]);
		p.steps = [
			{ op: 'let', name: 'seen', value: literal([]) },
			{
				op: 'expression',
				value: method(make(root, [receiver]), 'forEach', [
					fn(
						['value', 'key'],
						method(variable('seen'), 'push', [
							object([
								['key', variable('key')],
								['value', variable('value')]
							])
						])
					)
				])
			}
		];
		return done(p, variable('seen'));
	}
	if (root === 'Map' && member === 'groupBy')
		return done(
			p,
			method(global(root), member, [
				param('items', 'Numbers', [1, 2, 3, 4]),
				fn(['value'], { op: 'binary', operator: '%', left: variable('value'), right: 2 })
			])
		);
	if (root === 'Map' && ['getOrInsert', 'getOrInsertComputed'].includes(member)) {
		p.requires.push(['Map', 'prototype', member]);
		const target = make('Map', [param('entries', 'Map entries', [['one', 1]])]);
		const value = param('fallback', 'Fallback value', 42, 'number');
		return done(p, method(target, member, [param('key', 'Key', 'two', 'text'), member.endsWith('Computed') ? fn(['key'], value) : value]));
	}
	if (
		root === 'Set' &&
		['difference', 'intersection', 'union', 'symmetricDifference', 'isDisjointFrom', 'isSubsetOf', 'isSupersetOf'].includes(member)
	) {
		p.requires.push(['Set', 'prototype', member]);
		return done(p, method(make(root, [param('left', 'Left set', [1, 2, 3])]), member, [make(root, [param('right', 'Right set', [2, 3, 4])])]));
	}
	if (root === 'Promise' && !parts.includes('prototype')) {
		p.requires.push(['Promise', member]);
		if (['all', 'allSettled', 'any', 'race'].includes(member)) return done(p, method(global(root), member, [param('values', 'Values', [1, 2, 3])]));
		if (member === 'try') return done(p, method(global(root), member, [twice, param('value', 'Value', 7, 'number')]));
		if (member === 'reject')
			return done(
				p,
				method(method(global(root), 'reject', [param('reason', 'Rejection reason', 'Demonstration rejection', 'text')]), 'catch', [
					fn(
						['reason'],
						object([
							['status', 'rejected'],
							['reason', variable('reason')]
						])
					)
				])
			);
		if (member === 'resolve') return done(p, method(global(root), member, [param('value', 'Resolved value', 'Hello', 'text')]));
		if (member === 'withResolvers') {
			p.steps = [
				{ op: 'let', name: 'deferred', value: method(global(root), member) },
				{ op: 'expression', value: call(get(variable('deferred'), 'resolve'), [param('value', 'Resolved value', 'Hello', 'text')]) }
			];
			return done(p, get(variable('deferred'), 'promise'));
		}
	}
	if (root === 'Proxy' && member === 'revocable') {
		p.steps = [{ op: 'let', name: 'revocable', value: method(global(root), member, [param('target', 'Target', sample), literal({})]) }];
		return done(p, get(variable('revocable'), 'proxy'));
	}
	if (root === 'JSON' && member === 'rawJSON') {
		p.requires.push(['JSON', 'rawJSON']);
		return done(p, method(global(root), 'stringify', [method(global(root), member, [param('json', 'Raw JSON primitive', '12345', 'text')])]));
	}
	if (root === 'Math' && member === 'sumPrecise') {
		p.requires.push(['Math', 'sumPrecise']);
		return done(p, method(global(root), member, [param('values', 'Numbers', [1e20, 1, -1e20])]));
	}
	if (root === 'RegExp' && member === 'escape') {
		p.requires.push(['RegExp', 'escape']);
		return done(p, method(global(root), member, [param('text', 'Literal search text', 'Hello. (Thingtime)?', 'text')]));
	}
	if (root === 'String' && member === 'raw')
		return done(
			p,
			method(global(root), member, [
				object([['raw', param('parts', 'Raw template parts', ['Hello\\n', '!'])]]),
				param('value', 'Substitution', 'Thingtime', 'text')
			])
		);
	if (root === 'Symbol' && member === 'keyFor')
		return done(p, method(global(root), member, [method(global(root), 'for', [param('key', 'Registry key', 'thingtime', 'text')])]));
	if (root === 'TypedArray' && member === 'BYTES_PER_ELEMENT') {
		p.requires = [['Uint8Array']];
		return done(
			p,
			get(global('Uint8Array'), member),
			'TypedArray is an intrinsic abstract family. This example uses its Uint8Array concrete implementation.'
		);
	}
	if (root === 'Uint8Array' && ['fromBase64', 'fromHex', 'setFromBase64', 'setFromHex'].includes(member)) {
		p.requires.push(parts.includes('prototype') ? [root, 'prototype', member] : [root, member]);
		const encoded = param('encoded', 'Encoded bytes', member.endsWith('Hex') ? '48656c6c6f' : 'SGVsbG8=', 'text');
		if (member.startsWith('from')) return done(p, method(global(root), member, [encoded]));
		p.steps = [
			{ op: 'let', name: 'bytes', value: make(root, [8]) },
			{ op: 'let', name: 'result', value: method(variable('bytes'), member, [encoded]) }
		];
		return done(
			p,
			object([
				['result', variable('result')],
				['bytes', method(global('Array'), 'from', [variable('bytes')])]
			])
		);
	}
	return null;
}
