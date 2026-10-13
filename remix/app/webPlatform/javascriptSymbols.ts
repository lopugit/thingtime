import type { Feature, Recipe } from './types';
import { base, parameter, input, global, literal, get, method, make, recipe, returns } from './programBuilders';

/** Well-known symbol members use ordinary computed-property program nodes. */
export function javascriptSymbolRecipe(f: Feature): Recipe | null {
	const match = f.name.match(/^(?:get |set )?(.+?) \[ %Symbol\.(\w+)% \](?: \(.*\))?$/);
	if (!match) return null;
	const [, path, symbol] = match;
	const p = { ...base(f), parameters: [] as ReturnType<typeof parameter>[], requires: [['Symbol', symbol]] };
	const param = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters.push(parameter(name, label, value, type));
		return input(name);
	};
	const call = (target: unknown, args: unknown[] = []) => ({ op: 'call', target, args });
	const from = (target: unknown) => method(global('Array'), 'from', [target]);
	const key = get(global('Symbol'), symbol);
	const proto = (value: unknown) => method(global('Object'), 'getPrototypeOf', [value]);
	let target: unknown;
	const root = path.split('.')[0];
	if (root === '%TypedArray%') {
		p.requires.push(['Uint8Array']);
		target = path.endsWith('.prototype') ? make('Uint8Array', [param('values', 'Byte values', [1, 2, 255])]) : proto(global('Uint8Array'));
	} else if (path === '%ArrayIteratorPrototype%') target = proto(method(literal([]), 'values'));
	else if (path === '%MapIteratorPrototype%') target = proto(method(make('Map'), 'entries'));
	else if (path === '%SetIteratorPrototype%') target = proto(method(make('Set'), 'values'));
	else if (path === '%StringIteratorPrototype%') target = proto(call(get('', get(global('Symbol'), 'iterator'))));
	else if (path === '%RegExpStringIteratorPrototype%') target = proto(method('', 'matchAll', [{ op: 'regex', pattern: '.', flags: 'g' }]));
	else if (path === '%IteratorHelperPrototype%') {
		p.requires.push(['Iterator', 'prototype', 'map']);
		target = proto(method(method(literal([1]), 'values'), 'map', [{ op: 'function', params: ['value'], value: { op: 'variable', name: 'value' } }]));
	} else if (path.startsWith('%IntlSegment')) {
		p.requires.push(['Intl', 'Segmenter']);
		const segments = method({ op: 'new', target: get(global('Intl'), 'Segmenter'), args: ['en', literal({ granularity: 'word' })] }, 'segment', [
			param('text', 'Text', 'Hello Thingtime', 'text')
		]);
		target = path === '%IntlSegmentsPrototype%' ? segments : proto(call(get(segments, get(global('Symbol'), 'iterator'))));
	} else if (
		/^[A-Za-z]+(?:\.[A-Za-z]+)*$/.test(path) &&
		!['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction', 'Function'].includes(root)
	) {
		p.requires.push(path.split('.'));
		target = path
			.split('.')
			.slice(1)
			.reduce<unknown>((value, part) => get(value, part), global(root));
	} else if (path === 'Function.prototype' && symbol === 'hasInstance') {
		const check = get(proto({ op: 'function', params: [], value: null }), key);
		return recipe({
			...p,
			steps: returns(
				method(global('Reflect'), 'apply', [
					check,
					global('Array'),
					{ op: 'array', items: [param('value', 'Value to check as an Array', [1, 2, 3])] }
				])
			)
		});
	} else return null;

	if (symbol === 'species') return recipe({ ...p, steps: returns(get(get(target, key), 'name')) });
	if (symbol === 'toStringTag' && !f.name.startsWith('set ')) return recipe({ ...p, steps: returns(get(target, key)) });
	if (symbol === 'unscopables') return recipe({ ...p, steps: returns(get(target, key)) });
	if (symbol === 'iterator') {
		if (root === 'Array') target = param('values', 'Values', [1, 2, 3]);
		else if (root === 'String') target = param('text', 'Text', 'Hello 🌈', 'text');
		else if (root === 'Map')
			target = make('Map', [
				param('entries', 'Entries', [
					['one', 1],
					['two', 2]
				])
			]);
		else if (root === 'Set') target = make('Set', [param('values', 'Values', [1, 2, 2, 3])]);
		else if (root === 'Iterator') target = method(param('values', 'Values', [1, 2, 3]), 'values');
		return recipe({ ...p, steps: returns(from(call(get(target, key)))) });
	}
	if (root === 'RegExp' && ['match', 'matchAll', 'search', 'replace', 'split'].includes(symbol)) {
		target = make('RegExp', [param('pattern', 'Pattern', '[a-z]+', 'text'), param('flags', 'Flags', 'g', 'text')]);
		const args = [param('text', 'Text', 'Hello Thingtime', 'text')];
		if (symbol === 'replace') args.push(param('replacement', 'Replacement', '🌈', 'text'));
		if (symbol === 'split') args.push(param('limit', 'Maximum segments', 10, 'number'));
		let value: unknown = call(get(target, key), args);
		if (symbol === 'matchAll') value = from(value);
		return recipe({ ...p, steps: returns(value) });
	}
	if (symbol === 'toPrimitive' && ['Date', 'Symbol'].includes(root)) {
		target =
			root === 'Date'
				? make('Date', [param('date', 'Date (ISO)', '2026-09-23T12:00:00Z', 'text')])
				: call(global('Symbol'), [param('description', 'Description', 'Thingtime', 'text')]);
		return recipe({ ...p, steps: returns(call(get(target, key), [param('hint', 'Primitive hint', 'number', 'text')])) });
	}
	return null;
}
