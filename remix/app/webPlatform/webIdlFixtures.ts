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
	project,
	recipe,
	awaited,
	fn
} from './programBuilders';

export const nativeFunction = (params: string[], body: unknown[]) => ({ op: 'function-expression', params, body });
export const equal = (left: unknown, right: unknown) => ({ op: 'binary', operator: '===', left, right });
export const choose = (test: unknown, then: unknown, otherwise: unknown) => ({ op: 'conditional', test, then, else: otherwise });
export const boundedOptionArray = (value: unknown, max = 4096) => ({
	op: 'if',
	test: {
		op: 'unary',
		operator: '!',
		value: {
			op: 'binary',
			operator: '&&',
			left: method(global('Array'), 'isArray', [value]),
			right: { op: 'binary', operator: '<=', left: get(value, 'length'), right: max }
		}
	},
	then: [{ op: 'throw', value: make('RangeError', [`This demo requires an array of at most ${max} values`]) }]
});
/** Authoring helpers produce complete saved data, not runtime catalogue dispatch. */
export function optionProgram(f: Feature, requires: string[][]) {
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [], requires };
	const param = (name: string, label: string, value: unknown, type: 'json' | 'text' | 'boolean' | 'number' = 'json') => {
		p.parameters!.push(parameter(name, label, value, type));
		return input(name);
	};
	const done = (result: unknown, note: string) =>
		recipe(
			{
				...p,
				steps: [
					{
						op: 'try',
						body: [...p.steps!, ...returns(object({ status: 'ok', result }))],
						error: 'error',
						catch: returns(object({ status: 'threw', name: get(v('error'), 'name'), message: call(global('String'), [v('error')]) }))
					}
				]
			},
			'interactive',
			note +
				' The complete editable program is saved in the Component; dictionaries and callbacks are passed to the real API, not treated as global constructors.'
		);
	return { p, param, done };
}

const fields: Record<string, string[]> = {
	EventInit: ['bubbles', 'cancelable', 'composed'],
	CustomEventInit: ['detail'],
	EventListenerOptions: ['capture'],
	AddEventListenerOptions: ['once', 'passive', 'signal'],
	BlobPropertyBag: ['type', 'endings'],
	FilePropertyBag: ['lastModified'],
	RequestInit: [
		'body',
		'cache',
		'credentials',
		'duplex',
		'headers',
		'integrity',
		'keepalive',
		'method',
		'mode',
		'redirect',
		'referrer',
		'referrerPolicy',
		'signal',
		'window'
	],
	ResponseInit: ['status', 'statusText', 'headers'],
	TextDecoderOptions: ['fatal', 'ignoreBOM'],
	TextDecodeOptions: ['stream'],
	DOMPointInit: ['x', 'y', 'z', 'w'],
	DOMRectInit: ['x', 'y', 'width', 'height'],
	DOMMatrix2DInit: ['a', 'b', 'c', 'd', 'e', 'f', 'm11', 'm12', 'm21', 'm22', 'm41', 'm42'],
	DOMMatrixInit: ['is2D', 'm13', 'm14', 'm23', 'm24', 'm31', 'm32', 'm33', 'm34', 'm43', 'm44']
};
const aliases: Record<string, string> = {
	EndingType: 'BlobPropertyBag',
	EventListener: 'AddEventListenerOptions',
	HeadersInit: 'HeadersInit',
	RequestMode: 'RequestInit',
	RequestCredentials: 'RequestInit',
	RequestCache: 'RequestInit',
	RequestRedirect: 'RequestInit',
	RequestDuplex: 'RequestInit',
	ReferrerPolicy: 'RequestInit'
};
export function webIdlRecipe(f: Feature): Recipe | undefined {
	if (f.language !== 'webapi') return;
	const name = f.interface || f.name;
	const family =
		f.kind === 'dictionary' && fields[name]
			? name
			: f.kind === 'field' && fields[name]?.includes(f.member || '')
			? name
			: ['enum', 'typedef', 'callback interface'].includes(f.kind)
			? aliases[f.name]
			: undefined;
	if (!family) return;
	const { p, param, done } = optionProgram(f, []);
	const require = (...path: string[]) => p.requires!.push(path);
	if (family === 'HeadersInit') {
		require('Headers');
		p.steps!.push(
			declare(
				'headers',
				make('Headers', [
					param('headers', 'Header pairs or record (JSON)', [
						['X-Example', 'first'],
						['x-example', 'second']
					])
				])
			)
		);
		return done(
			method(global('Array'), 'from', [method(v('headers'), 'entries')]),
			'Pass a record or a sequence of name/value pairs through the native HeadersInit union. Names are normalized and duplicate fields are combined according to native Headers rules; invalid names and values are rejected.'
		);
	}
	if (family === 'EventInit' || family === 'CustomEventInit') {
		const ctor = family === 'EventInit' ? 'Event' : 'CustomEvent';
		require(ctor);
		require('EventTarget');
		const options = param('options', 'Event dictionary (JSON)', {
			bubbles: true,
			cancelable: true,
			composed: true,
			...(ctor === 'CustomEvent' ? { detail: { message: 'Thingtime' } } : {})
		});
		p.steps!.push(
			declare('event', make(ctor, [param('type', 'Event type', 'thingtime', 'text'), options])),
			declare('target', make('EventTarget')),
			perform(
				method(v('target'), 'addEventListener', [
					get(v('event'), 'type'),
					fn(
						['event'],
						choose(param('preventDefault', 'Prevent default in the listener', true, 'boolean'), method(v('event'), 'preventDefault'), null)
					)
				])
			),
			declare('accepted', method(v('target'), 'dispatchEvent', [v('event')]))
		);
		return done(
			object({
				event: project(v('event'), [
					'type',
					'bubbles',
					'cancelable',
					'composed',
					'defaultPrevented',
					'isTrusted',
					...(ctor === 'CustomEvent' ? ['detail'] : [])
				]),
				dispatchAccepted: v('accepted')
			}),
			'Edit or omit dictionary members to observe native defaults and Web IDL boolean conversion. Cancellation affects dispatch only for a cancelable event. The standalone target has no DOM ancestors.'
		);
	}
	if (family === 'EventListenerOptions' || family === 'AddEventListenerOptions') {
		require('EventTarget');
		require('Event');
		require('AbortController');
		const options = param('options', 'Listener options (JSON or capture boolean)', { capture: false, once: false, passive: false });
		const useSignal = param('useSignal', 'Attach an AbortSignal (object options required)', f.member === 'signal', 'boolean');
		const abortAt = param('abortAt', 'Abort: before, between or never', f.member === 'signal' ? 'between' : 'never', 'text');
		const remove = param('remove', 'Remove between dispatches', family === 'EventListenerOptions', 'boolean');
		const removeOptions = param('removeOptions', 'Removal options (JSON or capture boolean)', { capture: false });
		p.steps!.push(
			declare('target', make('EventTarget')),
			declare('controller', make('AbortController')),
			declare('log', array()),
			declare('options', options),
			{
				op: 'if',
				test: useSignal,
				then: [
					perform(
						method(global('Object'), 'defineProperty', [v('options'), 'signal', object({ value: get(v('controller'), 'signal'), enumerable: true })])
					)
				]
			},
			{ op: 'if', test: equal(abortAt, 'before'), then: [perform(method(v('controller'), 'abort', ['before']))] },
			declare(
				'listener',
				object({
					label: param('label', 'Callback object label', 'Thingtime', 'text'),
					handleEvent: nativeFunction(
						['event'],
						[
							perform(method(v('event'), 'preventDefault')),
							perform(
								method(v('log'), 'push', [object({ label: get({ op: 'this' }, 'label'), defaultPrevented: get(v('event'), 'defaultPrevented') })])
							)
						]
					)
				})
			),
			perform(method(v('target'), 'addEventListener', ['example', v('listener'), v('options')])),
			declare('first', method(v('target'), 'dispatchEvent', [make('Event', ['example', object({ cancelable: true })])])),
			{ op: 'if', test: remove, then: [perform(method(v('target'), 'removeEventListener', ['example', v('listener'), removeOptions]))] },
			{ op: 'if', test: equal(abortAt, 'between'), then: [perform(method(v('controller'), 'abort', ['between']))] },
			declare('second', method(v('target'), 'dispatchEvent', [make('Event', ['example', object({ cancelable: true })])]))
		);
		return done(
			object({ received: v('log'), dispatchAccepted: array(v('first'), v('second')), aborted: get(get(v('controller'), 'signal'), 'aborted') }),
			'The real handleEvent callback object receives its own this value. Compare once, passive prevention, matching capture on removal, and abort before or between two dispatches. A native signal can be attached to object options; no ancestor propagation is implied.'
		);
	}
	if (family === 'BlobPropertyBag' || family === 'FilePropertyBag') {
		const file = family === 'FilePropertyBag',
			ctor = file ? 'File' : 'Blob';
		require(ctor);
		const text = param('text', 'Text, including line endings', 'Hello\r\nThingtime\rworld', 'text');
		const options = param('options', 'File/blob property bag (JSON)', {
			type: 'TEXT/PLAIN',
			endings: 'transparent',
			...(file ? { lastModified: 1234567890000 } : {})
		});
		p.steps!.push(
			declare('value', make(ctor, file ? [array(text), param('name', 'File name', 'example.txt', 'text'), options] : [array(text), options]))
		);
		return done(
			object({
				metadata: project(v('value'), ['size', 'type', ...(file ? ['name', 'lastModified'] : [])]),
				text: awaited(method(v('value'), 'text')),
				bytes: method(global('Array'), 'from', [make('Uint8Array', [awaited(method(v('value'), 'arrayBuffer'))])])
			}),
			'The native property bag normalizes MIME type and converts line endings. Compare transparent with native endings; the latter follows the browser operating system. File lastModified exposes the actual engine conversion; some Node versions retain fractional timestamps.'
		);
	}
	if (family === 'RequestInit' || family === 'ResponseInit') {
		const request = family === 'RequestInit',
			ctor = request ? 'Request' : 'Response';
		require(ctor);
		const options = param(
			'options',
			request ? 'RequestInit dictionary (JSON)' : 'ResponseInit dictionary (JSON)',
			request
				? {
						method: 'POST',
						body: 'Hello Thingtime',
						headers: { 'X-Example': 'editable' },
						mode: 'cors',
						credentials: 'omit',
						cache: 'no-store',
						redirect: 'manual',
						referrer: '',
						referrerPolicy: 'no-referrer',
						integrity: '',
						keepalive: false,
						duplex: 'half',
						window: null
				  }
				: { status: 201, statusText: 'Created', headers: { 'Content-Type': 'text/plain', 'X-Example': 'editable' } }
		);
		p.steps!.push(declare('options', options));
		if (request) {
			require('AbortController');
			p.steps!.push(declare('controller', make('AbortController')), {
				op: 'if',
				test: param('useSignal', 'Attach an AbortSignal (object options required)', f.member === 'signal', 'boolean'),
				then: [
					perform(
						method(global('Object'), 'defineProperty', [v('options'), 'signal', object({ value: get(v('controller'), 'signal'), enumerable: true })])
					)
				]
			});
		}
		p.steps!.push(
			declare(
				'value',
				make(ctor, [
					request
						? param('url', 'Request URL (constructed only)', 'https://example.com/thingtime', 'text')
						: param('body', 'Response body (JSON value)', 'Hello Thingtime'),
					v('options')
				])
			)
		);
		if (request)
			p.steps!.push({
				op: 'if',
				test: param('abort', 'Abort the source signal', true, 'boolean'),
				then: [perform(method(v('controller'), 'abort', [param('reason', 'Abort reason', 'demonstration')]))]
			});
		const metadata = project(
			v('value'),
			request
				? ['url', 'method', 'mode', 'credentials', 'cache', 'redirect', 'referrer', 'referrerPolicy', 'integrity', 'keepalive', 'duplex']
				: ['status', 'statusText', 'ok', 'type']
		);
		return done(
			object({
				metadata,
				headers: method(global('Array'), 'from', [method(get(v('value'), 'headers'), 'entries')]),
				body: awaited(method(v('value'), 'text')),
				...(request ? { signal: project(get(v('value'), 'signal'), ['aborted', 'reason']) } : {})
			}),
			'Construct and inspect native metadata, normalized headers and body bytes as text. Invalid methods, enums, headers, status/body combinations and non-null window values reach native validation. Some worker engines ignore window and accept a non-null value; that behavior stays visible. No request is sent; priority, private-token and address-space network effects need their own context.'
		);
	}
	if (family === 'TextDecoderOptions' || family === 'TextDecodeOptions') {
		require('TextDecoder');
		require('Uint8Array');
		const options = param('options', 'TextDecoderOptions (JSON)', { fatal: false, ignoreBOM: false });
		const decodeOptions = param('decodeOptions', 'First TextDecodeOptions (JSON)', { stream: family === 'TextDecodeOptions' });
		const firstBytes = param('firstBytes', 'First byte chunk', family === 'TextDecodeOptions' ? [226, 130] : [239, 187, 191, 65]),
			secondBytes = param('secondBytes', 'Second byte chunk', family === 'TextDecodeOptions' ? [172] : [66]);
		p.steps!.push(
			boundedOptionArray(firstBytes),
			boundedOptionArray(secondBytes),
			declare('decoder', make('TextDecoder', [param('label', 'Encoding label', 'utf-8', 'text'), options])),
			declare('first', method(v('decoder'), 'decode', [make('Uint8Array', [firstBytes]), decodeOptions])),
			declare('second', method(v('decoder'), 'decode', [make('Uint8Array', [secondBytes])]))
		);
		return done(
			object({
				configuration: project(v('decoder'), ['encoding', 'fatal', 'ignoreBOM']),
				first: v('first'),
				second: v('second'),
				combined: { op: 'binary', operator: '+', left: v('first'), right: v('second') }
			}),
			'Compare fatal replacement/error handling and BOM retention, or split a multi-byte character across two decode calls. The first call can retain incomplete bytes with stream; the second flushes the decoder.'
		);
	}
	if (family.startsWith('DOM')) {
		const matrix = family.startsWith('DOMMatrix'),
			rect = family === 'DOMRectInit',
			ctor = matrix ? 'DOMMatrix' : rect ? 'DOMRect' : 'DOMPoint';
		require(ctor);
		const defaults: Record<string, unknown> = matrix
			? family === 'DOMMatrixInit'
				? { m11: 2, m22: 3, m33: 1, m44: 1, m41: 5, m42: 7, is2D: true }
				: { a: 2, d: 3, e: 5, f: 7 }
			: rect
			? { x: 10, y: 20, width: -30, height: 40 }
			: { x: 3, y: 4, z: 0, w: 1 };
		const options = param('options', 'Geometry dictionary (JSON)', defaults);
		p.steps!.push(declare('value', method(global(ctor), matrix ? 'fromMatrix' : rect ? 'fromRect' : 'fromPoint', [options])));
		return done(
			object({
				value: method(v('value'), 'toJSON'),
				...(matrix
					? { transformed: method(method(v('value'), 'transformPoint', [param('point', 'Point dictionary', { x: 3, y: 4, z: 0, w: 1 })]), 'toJSON') }
					: {})
			}),
			'The native dictionary conversion applies omitted coordinate defaults and computes the result. Matrix aliases must agree, and is2D must match the 3D coefficients. Rectangles with negative dimensions retain them and compute their edges.'
		);
	}
}
