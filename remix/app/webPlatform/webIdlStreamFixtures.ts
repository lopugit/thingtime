import type { Feature, Recipe } from './types';
import {
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
	awaited,
	fn
} from './programBuilders';
import { optionProgram, nativeFunction, equal, choose, boundedOptionArray } from './webIdlFixtures';

const fields: Record<string, string[]> = {
	QueuingStrategy: ['highWaterMark', 'size'],
	QueuingStrategyInit: ['highWaterMark'],
	StreamPipeOptions: ['preventAbort', 'preventCancel', 'preventClose', 'signal'],
	ReadableStreamGetReaderOptions: ['mode'],
	ReadableStreamBYOBReaderReadOptions: ['min'],
	UnderlyingSource: ['autoAllocateChunkSize', 'cancel', 'pull', 'start', 'type'],
	UnderlyingSink: ['abort', 'close', 'start', 'type', 'write'],
	Transformer: ['cancel', 'flush', 'readableType', 'start', 'transform', 'writableType']
};
const aliases: Record<string, string> = {
	QueuingStrategySize: 'QueuingStrategy',
	ReadableStreamReaderMode: 'ReadableStreamGetReaderOptions',
	ReadableStreamType: 'UnderlyingSource',
	UnderlyingSourceCancelCallback: 'UnderlyingSource',
	UnderlyingSourcePullCallback: 'UnderlyingSource',
	UnderlyingSourceStartCallback: 'UnderlyingSource',
	UnderlyingSinkAbortCallback: 'UnderlyingSink',
	UnderlyingSinkCloseCallback: 'UnderlyingSink',
	UnderlyingSinkStartCallback: 'UnderlyingSink',
	UnderlyingSinkWriteCallback: 'UnderlyingSink',
	TransformerCancelCallback: 'Transformer',
	TransformerFlushCallback: 'Transformer',
	TransformerStartCallback: 'Transformer',
	TransformerTransformCallback: 'Transformer'
};
export function webIdlStreamRecipe(f: Feature): Recipe | undefined {
	if (f.language !== 'webapi') return;
	const name = f.interface || f.name;
	const family =
		f.kind === 'dictionary' && fields[name]
			? name
			: f.kind === 'field' && fields[name]?.includes(f.member || '')
			? name
			: ['callback', 'enum'].includes(f.kind)
			? aliases[f.name]
			: undefined;
	if (!family) return;
	const { p, param, done } = optionProgram(f, []);
	const require = (...path: string[]) => p.requires!.push(path);
	const trace = (value: unknown) => perform(method(v('trace'), 'push', [value]));
	const callback = (params: string[], body: unknown[]) => nativeFunction(params, body);
	const settle = (promise: unknown) =>
		awaited(
			method(promise, 'then', [
				fn(['value'], object({ status: 'fulfilled', value: v('value') })),
				fn(['error'], object({ status: 'rejected', name: get(v('error'), 'name'), message: call(global('String'), [v('error')]) }))
			])
		);
	const bounded = (value: unknown, max = 32) => boundedOptionArray(value, max);
	p.steps!.push(declare('trace', array()));
	if (family === 'QueuingStrategyInit') {
		require('CountQueuingStrategy');
		require('ByteLengthQueuingStrategy');
		const options = param('options', 'QueuingStrategyInit (JSON)', { highWaterMark: 4 });
		p.steps!.push(declare('count', make('CountQueuingStrategy', [options])), declare('bytes', make('ByteLengthQueuingStrategy', [options])));
		return done(
			object({
				count: object({
					highWaterMark: get(v('count'), 'highWaterMark'),
					size: method(v('count'), 'size', [param('chunk', 'Chunk value', { byteLength: 6 })])
				}),
				bytes: object({ highWaterMark: get(v('bytes'), 'highWaterMark'), size: method(v('bytes'), 'size', [input('chunk')]) })
			}),
			'Both native strategies require highWaterMark. Count size returns one; byte-length size reads the actual chunk byteLength. Streams perform their own high-water-mark validity checks when a strategy is used.'
		);
	}
	if (family === 'QueuingStrategy') {
		require('ReadableStream');
		const chunks = param('chunks', 'Chunks to queue', [2, 3, 1]);
		p.steps!.push(bounded(chunks));
		const size = param('size', 'Size callback: count or numeric chunk', 'numeric', 'text');
		const strategy = object({
			highWaterMark: param('highWaterMark', 'High water mark', 8, 'number'),
			size: callback(
				['chunk'],
				[trace(object({ sizeCalledWith: v('chunk') })), ...returns(choose(equal(size, 'count'), 1, call(global('Number'), [v('chunk')])))]
			)
		});
		p.steps!.push(
			declare(
				'stream',
				make('ReadableStream', [
					object({
						start: callback(
							['controller'],
							[
								trace(object({ before: get(v('controller'), 'desiredSize') })),
								{
									op: 'for-of',
									name: 'chunk',
									value: chunks,
									body: [perform(method(v('controller'), 'enqueue', [v('chunk')])), trace(object({ after: get(v('controller'), 'desiredSize') }))]
								},
								perform(method(v('controller'), 'close'))
							]
						)
					}),
					strategy
				])
			),
			declare('read', awaited(method(method(v('stream'), 'getReader'), 'read')))
		);
		return done(
			object({ trace: v('trace'), first: v('read') }),
			'A data-defined size callback controls the native queue total and desiredSize. Compare numeric chunk sizes with count size. Negative, infinite and NaN sizes are rejected by the stream; the demo limits the number of chunks.'
		);
	}
	if (family === 'StreamPipeOptions') {
		require('ReadableStream');
		require('WritableStream');
		require('AbortController');
		const mode = param(
			'mode',
			'Scenario: close, source-error, sink-error or abort',
			f.member === 'preventAbort' ? 'source-error' : f.member === 'preventCancel' ? 'sink-error' : f.member === 'signal' ? 'abort' : 'close',
			'text'
		);
		const options = param('options', 'StreamPipeOptions (JSON)', { preventAbort: false, preventCancel: false, preventClose: false });
		const reason = param('reason', 'Error or abort reason', 'demo reason');
		p.steps!.push(
			{
				op: 'if',
				test: { op: 'unary', operator: '!', value: method(array('close', 'source-error', 'sink-error', 'abort'), 'includes', [mode]) },
				then: [{ op: 'throw', value: make('RangeError', ['Choose a supported pipe scenario']) }]
			},
			declare('controller', make('AbortController')),
			declare('options', options),
			{
				op: 'if',
				test: equal(mode, 'abort'),
				then: [
					perform(
						method(global('Object'), 'defineProperty', [v('options'), 'signal', object({ value: get(v('controller'), 'signal'), enumerable: true })])
					),
					perform(method(v('controller'), 'abort', [reason]))
				]
			},
			declare(
				'source',
				make('ReadableStream', [
					object({
						start: callback(
							['controller'],
							[
								{
									op: 'if',
									test: equal(mode, 'source-error'),
									then: [perform(method(v('controller'), 'error', [reason]))],
									else: [
										perform(method(v('controller'), 'enqueue', [param('chunk', 'Chunk', 'Thingtime')])),
										{ op: 'if', test: equal(mode, 'close'), then: [perform(method(v('controller'), 'close'))] }
									]
								}
							]
						),
						cancel: callback(['reason'], [trace(object({ cancel: v('reason') }))])
					})
				])
			),
			declare(
				'sink',
				make('WritableStream', [
					object({
						write: callback(
							['chunk'],
							[trace(object({ write: v('chunk') })), { op: 'if', test: equal(mode, 'sink-error'), then: [{ op: 'throw', value: reason }] }]
						),
						close: callback([], [trace('close')]),
						abort: callback(['reason'], [trace(object({ abort: v('reason') }))])
					})
				])
			),
			declare('settlement', settle(method(v('source'), 'pipeTo', [v('sink'), v('options')])))
		);
		return done(
			object({ settlement: v('settlement'), trace: v('trace'), sourceLocked: get(v('source'), 'locked'), sinkLocked: get(v('sink'), 'locked') }),
			'Compare native propagation of source errors, destination errors, closure and an already-aborted signal. Toggle the matching prevent option and inspect which cancel, abort or close callback actually ran. Prevented cleanup leaves only this run-local in-memory stream open.'
		);
	}
	if (family === 'ReadableStreamGetReaderOptions' || family === 'ReadableStreamBYOBReaderReadOptions') {
		require('ReadableStream');
		require('ReadableStreamBYOBReader');
		require('Uint8Array');
		const bytes = param('bytes', 'Source byte values', [10, 20, 30, 40]);
		const capacity = param('capacity', 'BYOB view capacity (1–4096)', 8, 'number');
		p.steps!.push(
			bounded(bytes, 4096),
			{
				op: 'if',
				test: {
					op: 'unary',
					operator: '!',
					value: {
						op: 'binary',
						operator: '&&',
						left: method(global('Number'), 'isInteger', [capacity]),
						right: {
							op: 'binary',
							operator: '&&',
							left: { op: 'binary', operator: '>=', left: capacity, right: 1 },
							right: { op: 'binary', operator: '<=', left: capacity, right: 4096 }
						}
					}
				},
				then: [{ op: 'throw', value: make('RangeError', ['This demo limits the BYOB view to 1–4096 bytes']) }]
			},
			declare(
				'stream',
				make('ReadableStream', [
					object({
						type: 'bytes',
						start: callback(
							['controller'],
							[perform(method(v('controller'), 'enqueue', [make('Uint8Array', [bytes])])), perform(method(v('controller'), 'close'))]
						)
					})
				])
			),
			declare('reader', method(v('stream'), 'getReader', [param('options', 'Reader options (JSON)', { mode: 'byob' })])),
			declare('view', make('Uint8Array', [capacity])),
			declare('byob', { op: 'binary', operator: 'instanceof', left: v('reader'), right: global('ReadableStreamBYOBReader') }),
			declare(
				'read',
				awaited(
					choose(
						v('byob'),
						method(v('reader'), 'read', [v('view'), param('readOptions', 'BYOB read options (JSON)', { min: 2 })]),
						method(v('reader'), 'read')
					)
				)
			),
			perform(awaited(method(v('reader'), 'cancel'))),
			perform(method(v('reader'), 'releaseLock'))
		);
		return done(
			object({
				byob: v('byob'),
				done: get(v('read'), 'done'),
				value: method(global('Array'), 'from', [get(v('read'), 'value')]),
				originalViewByteLength: get(v('view'), 'byteLength'),
				locked: get(v('stream'), 'locked')
			}),
			'The mode selects a real default or BYOB reader. min constrains native BYOB fulfillment; invalid values are rejected. The caller view is transferred by a BYOB read. This finite source is closed before reading and remaining bytes are canceled after the first receipt.'
		);
	}
	if (family === 'UnderlyingSource') {
		require('ReadableStream');
		require('Uint8Array');
		const bytes = param('bytes', 'Byte source values', [7, 8, 9]);
		p.steps!.push(bounded(bytes, 4096));
		const options = param(
			'options',
			'Source data properties (JSON)',
			f.member === 'type' || f.member === 'autoAllocateChunkSize' || f.name === 'ReadableStreamType'
				? { type: 'bytes', autoAllocateChunkSize: 8 }
				: {}
		);
		const action = param(
			'action',
			'Action: read or cancel',
			f.member === 'cancel' || f.name === 'UnderlyingSourceCancelCallback' ? 'cancel' : 'read',
			'text'
		);
		p.steps!.push(
			{
				op: 'if',
				test: {
					op: 'binary',
					operator: '>',
					left: call(global('Number'), [{ ...get(options, 'autoAllocateChunkSize'), optional: true }]),
					right: 4096
				},
				then: [{ op: 'throw', value: make('RangeError', ['This demo limits automatic byte allocation to 4096']) }]
			},
			declare(
				'source',
				method(global('Object'), 'assign', [
					object({}),
					options,
					object({
						start: callback([], [trace('start')]),
						pull: callback(
							['controller'],
							[
								trace(
									object({
										pull: true,
										autoAllocatedBytes: choose(
											get(v('controller'), 'byobRequest'),
											get(get(get(v('controller'), 'byobRequest'), 'view'), 'byteLength'),
											null
										)
									})
								),
								perform(
									method(v('controller'), 'enqueue', [
										choose(
											equal({ ...get(options, 'type'), optional: true }, 'bytes'),
											make('Uint8Array', [bytes]),
											param('chunk', 'Regular source chunk', 'Thingtime')
										)
									])
								),
								perform(method(v('controller'), 'close'))
							]
						),
						cancel: callback(['reason'], [trace(object({ cancel: v('reason') }))])
					})
				])
			),
			declare('stream', make('ReadableStream', [v('source')])),
			declare(
				'receipt',
				awaited(
					choose(
						equal(action, 'cancel'),
						method(v('stream'), 'cancel', [param('reason', 'Cancellation reason', 'finished')]),
						method(method(v('stream'), 'getReader'), 'read')
					)
				)
			)
		);
		return done(
			object({ trace: v('trace'), receipt: v('receipt') }),
			'The source combines editable data properties with saved start, pull and cancel functions. Read once or cancel before consumption. A byte source can allocate a BYOB view for a default reader; the pull trace shows its actual capacity.'
		);
	}
	if (family === 'UnderlyingSink') {
		require('WritableStream');
		const chunks = param('chunks', 'Chunks to write', ['one', 'two']);
		p.steps!.push(bounded(chunks));
		const action = param(
			'action',
			'Finish: close, abort or write-error',
			f.member === 'abort' || f.name === 'UnderlyingSinkAbortCallback' ? 'abort' : 'close',
			'text'
		);
		const reason = param('reason', 'Abort or write error reason', 'demo reason');
		p.steps!.push(
			declare(
				'sink',
				method(global('Object'), 'assign', [
					object({}),
					param('options', 'Sink data properties (JSON; type is reserved)', f.member === 'type' ? { type: 'bytes' } : {}),
					object({
						start: callback([], [trace('start')]),
						write: callback(
							['chunk'],
							[trace(object({ write: v('chunk') })), { op: 'if', test: equal(action, 'write-error'), then: [{ op: 'throw', value: reason }] }]
						),
						close: callback([], [trace('close')]),
						abort: callback(['reason'], [trace(object({ abort: v('reason') }))])
					})
				])
			),
			declare('stream', make('WritableStream', [v('sink')])),
			declare('writer', method(v('stream'), 'getWriter')),
			declare(
				'settlement',
				settle(
					call({
						...callback(
							[],
							[
								{ op: 'for-of', name: 'chunk', value: chunks, body: [perform(awaited(method(v('writer'), 'write', [v('chunk')])))] },
								perform(awaited(choose(equal(action, 'abort'), method(v('writer'), 'abort', [reason]), method(v('writer'), 'close'))))
							]
						),
						async: true
					})
				)
			),
			perform(method(v('writer'), 'releaseLock'))
		);
		return done(
			object({ trace: v('trace'), settlement: v('settlement'), locked: get(v('stream'), 'locked') }),
			'Saved start, write, close and abort callbacks drive a real writable stream. Writes are awaited in order and errors preserve native rejection behavior. A supplied type is reserved and rejected by current Streams semantics.'
		);
	}
	if (family === 'Transformer') {
		require('TransformStream');
		const chunks = param('chunks', 'Chunks to transform', ['one', 'two']);
		p.steps!.push(bounded(chunks));
		const cancel = param('cancel', 'Cancel the readable side', f.member === 'cancel' || f.name === 'TransformerCancelCallback', 'boolean');
		p.steps!.push(
			declare(
				'transformer',
				method(global('Object'), 'assign', [
					object({}),
					param(
						'options',
						'Transformer data properties (JSON; types are reserved)',
						f.member === 'readableType' || f.member === 'writableType' ? { [f.member]: 'bytes' } : {}
					),
					object({
						start: callback(
							['controller'],
							[trace('start'), perform(method(v('controller'), 'enqueue', [param('prefix', 'Prefix chunk', 'start')]))]
						),
						transform: callback(
							['chunk', 'controller'],
							[
								trace(object({ transform: v('chunk') })),
								perform(
									method(v('controller'), 'enqueue', [
										{
											op: 'binary',
											operator: '+',
											left: call(global('String'), [v('chunk')]),
											right: param('suffix', 'Append to each chunk', '!', 'text')
										}
									])
								)
							]
						),
						flush: callback(['controller'], [trace('flush'), perform(method(v('controller'), 'enqueue', [param('last', 'Flush chunk', 'done')]))]),
						cancel: callback(['reason'], [trace(object({ cancel: v('reason') }))])
					})
				])
			),
			declare('stream', make('TransformStream', [v('transformer')])),
			declare('values', array()),
			{
				op: 'if',
				test: cancel,
				then: [
					perform(awaited(method(get(v('stream'), 'readable'), 'cancel', [param('reason', 'Cancellation reason', 'finished')]))),
					{
						op: 'if',
						test: equal(get(v('trace'), 'length'), 1),
						then: returns(
							object({
								status: 'unsupported',
								missing: array('Transformer.cancel callback'),
								message: 'This engine did not invoke the native transformer cancellation callback.',
								trace: v('trace')
							})
						)
					}
				],
				else: [
					declare('reader', method(get(v('stream'), 'readable'), 'getReader')),
					declare('writer', method(get(v('stream'), 'writable'), 'getWriter')),
					declare(
						'read',
						call({
							...callback(
								[],
								[
									{
										op: 'while',
										test: true,
										body: [
											declare('item', awaited(method(v('reader'), 'read'))),
											{ op: 'if', test: get(v('item'), 'done'), then: [{ op: 'break' }] },
											perform(method(v('values'), 'push', [get(v('item'), 'value')]))
										]
									}
								]
							),
							async: true
						})
					),
					declare(
						'write',
						call({
							...callback(
								[],
								[
									{ op: 'for-of', name: 'chunk', value: chunks, body: [perform(awaited(method(v('writer'), 'write', [v('chunk')])))] },
									perform(awaited(method(v('writer'), 'close')))
								]
							),
							async: true
						})
					),
					perform(awaited(method(global('Promise'), 'all', [array(v('read'), v('write'))]))),
					perform(method(v('reader'), 'releaseLock')),
					perform(method(v('writer'), 'releaseLock'))
				]
			}
		);
		return done(
			object({ trace: v('trace'), values: v('values') }),
			'The native transform stream runs saved start, transform and flush callbacks while reads and writes progress together under backpressure. Cancellation invokes cancel where supported; older engines report its absence. readableType and writableType are reserved and reject supplied values.'
		);
	}
}
