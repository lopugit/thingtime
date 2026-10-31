import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	variable as v,
	object as obj,
	array as arr,
	fn,
	call,
	awaited as wait,
	declare as decl,
	perform as act,
	setProperty as set,
	base,
	get,
	global,
	input,
	make,
	method,
	parameter,
	recipe,
	returns
} from './programBuilders';

export function streamApiRecipe(f: Feature): Recipe | undefined {
	const name = f.interface || f.name,
		member = f.member || '',
		summary = ['interface', 'constructor', 'interface mixin'].includes(f.kind);
	if (
		![
			'ReadableStream',
			'WritableStream',
			'TransformStream',
			'ReadableStreamDefaultReader',
			'ReadableStreamBYOBReader',
			'ReadableStreamGenericReader',
			'WritableStreamDefaultWriter',
			'ByteLengthQueuingStrategy',
			'CountQueuingStrategy',
			'TextEncoderStream',
			'TextDecoderStream',
			'CompressionStream',
			'DecompressionStream'
		].includes(name)
	)
		return undefined;
	const p: PlatformProgram = {
		...base(f),
		parameters: [],
		steps: [],
		requires: [[name === 'ReadableStreamGenericReader' ? 'ReadableStreamDefaultReader' : name]]
	};
	const param = (key: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'json') => {
		p.parameters!.push(parameter(key, label, value, type));
		return input(key);
	};
	const add = (...steps: PlatformExpression[]) => p.steps!.push(...steps);
	const require = (...path: string[]) => p.requires!.push(path);
	const done = (value: unknown) =>
		recipe(
			{ ...p, steps: [...p.steps!, ...returns(value)] },
			'interactive',
			'This editable program creates and consumes local streams. Change chunks, cancellation reasons or strategies to observe the browser implementation. No request is sent.'
		);
	const stream = v('stream'),
		reader = v('reader'),
		writer = v('writer'),
		log = v('log'),
		state = v('state');
	const collect = (source: unknown) => {
		require('Array', 'fromAsync');
		return wait(method(global('Array'), 'fromAsync', [source]));
	};
	const readable = (chunks: unknown, open = false) =>
		make('ReadableStream', [
			obj({
				start: fn(
					['controller'],
					arr(
						method(chunks, 'forEach', [fn(['chunk'], method(v('controller'), 'enqueue', [v('chunk')]))]),
						...(open ? [] : [method(v('controller'), 'close')])
					)
				),
				...(open ? { cancel: fn(['reason'], method(log, 'push', [v('reason')])) } : {})
			})
		]);
	if (name === 'ByteLengthQueuingStrategy' || name === 'CountQueuingStrategy') {
		if (!summary && !['highWaterMark', 'size'].includes(member)) return undefined;
		const highWaterMark = param('highWaterMark', 'High water mark', 3, 'number');
		const chunk =
			name === 'ByteLengthQueuingStrategy'
				? make('Uint8Array', [param('bytes', 'Chunk bytes', [10, 20, 30, 40])])
				: param('chunk', 'Chunk', { hello: 'Thingtime' });
		add(decl('strategy', make(name, [obj({ highWaterMark })])));
		// size is an IDL attribute whose value is a callable function.
		return done(obj({ highWaterMark: get(v('strategy'), 'highWaterMark'), chunkSize: method(v('strategy'), 'size', [chunk]) }));
	}
	if (['TextEncoderStream', 'TextDecoderStream', 'CompressionStream', 'DecompressionStream'].includes(name)) {
		require('ReadableStream');
		require('TextEncoder');
		require('Response');
		const compression = name === 'CompressionStream' || name === 'DecompressionStream';
		let source: unknown;
		if (compression) {
			require('CompressionStream');
			require('DecompressionStream');
			const text = param('text', 'Text', 'Hello 🌈 Thingtime', 'text'),
				format = param('format', 'Compression format', 'gzip', 'text');
			source = readable(arr(method(make('TextEncoder'), 'encode', [text])));
			add(decl('compressed', wait(method(make('Response', [method(source, 'pipeThrough', [make('CompressionStream', [format])])]), 'arrayBuffer'))));
			const compressed = v('compressed');
			add(
				decl(
					'decoded',
					wait(
						method(
							make('Response', [method(readable(arr(make('Uint8Array', [compressed]))), 'pipeThrough', [make('DecompressionStream', [format])])]),
							'text'
						)
					)
				)
			);
			return done(obj({ compressedBytes: get(compressed, 'byteLength'), roundTrip: v('decoded') }));
		}
		if (name === 'TextEncoderStream') source = readable(param('chunks', 'Text chunks', ['Hello ', '🌈']));
		else
			source = readable(
				method(
					param('chunks', 'Byte chunks (JSON)', [
						[240, 159],
						[140, 136]
					]),
					'map',
					[fn(['bytes'], make('Uint8Array', [v('bytes')]))]
				)
			);
		const args =
			name === 'TextDecoderStream'
				? [param('encoding', 'Encoding', 'utf-8', 'text'), obj({ fatal: param('fatal', 'Reject invalid byte sequences', false, 'boolean') })]
				: [];
		return done(collect(method(source, 'pipeThrough', [make(name, args)])));
	}
	if (name === 'ReadableStreamBYOBReader') {
		require('ReadableStream');
		const bytes = param('bytes', 'Source bytes', [10, 20, 30, 40, 50]);
		add(
			decl(
				'stream',
				make('ReadableStream', [
					obj({
						type: 'bytes',
						start: fn(['controller'], arr(method(v('controller'), 'enqueue', [make('Uint8Array', [bytes])]), method(v('controller'), 'close')))
					})
				])
			)
		);
		add(decl('reader', make('ReadableStreamBYOBReader', [stream])));
		if (member === 'releaseLock') {
			add(act(method(reader, 'releaseLock')));
			return done(obj({ locked: get(stream, 'locked') }));
		}
		if (!summary && member !== 'read') return undefined;
		add(decl('read', wait(method(reader, 'read', [make('Uint8Array', [param('capacity', 'Destination byte capacity', 4, 'number')])]))));
		add(act(wait(method(reader, 'cancel'))), act(method(reader, 'releaseLock')));
		return done(obj({ read: v('read'), lockedAfterRelease: get(stream, 'locked') }));
	}
	if (['ReadableStream', 'ReadableStreamDefaultReader', 'ReadableStreamGenericReader'].includes(name)) {
		if (!summary && !['locked', 'cancel', 'from', 'getReader', 'pipeThrough', 'pipeTo', 'tee', 'read', 'releaseLock', 'closed'].includes(member))
			return undefined;
		require('ReadableStream');
		if (member === 'from') require('ReadableStream', 'from');
		const chunks = param('chunks', 'Source chunks', ['Hello', 'Thingtime', '🌈']);
		add(
			decl('log', arr()),
			decl('stream', member === 'from' ? method(global('ReadableStream'), 'from', [chunks]) : readable(chunks, member === 'cancel'))
		);
		if (member === 'from') return done(collect(stream));
		if (member === 'tee') {
			add(decl('branches', method(stream, 'tee')));
			require('Array', 'fromAsync');
			return done(
				wait(
					method(global('Promise'), 'all', [
						arr(method(global('Array'), 'fromAsync', [get(v('branches'), 0)]), method(global('Array'), 'fromAsync', [get(v('branches'), 1)]))
					])
				)
			);
		}
		if (member === 'pipeTo') {
			require('WritableStream');
			add(decl('state', obj({ closed: false })));
			const sink = make('WritableStream', [
				obj({ write: fn(['chunk'], method(log, 'push', [v('chunk')])), close: fn([], set(state, 'closed', true)) })
			]);
			add(act(wait(method(stream, 'pipeTo', [sink]))));
			return done(obj({ received: log, closed: get(state, 'closed'), sourceLocked: get(stream, 'locked') }));
		}
		if (member === 'pipeThrough') {
			require('TransformStream');
			const prefix = param('prefix', 'Text prefix', '→ ', 'text');
			const transformed = { op: 'binary', operator: '+', left: prefix, right: call(global('String'), [v('chunk')]) };
			const transformer = make('TransformStream', [
				obj({ transform: fn(['chunk', 'controller'], method(v('controller'), 'enqueue', [transformed])) })
			]);
			return done(collect(method(stream, 'pipeThrough', [transformer])));
		}
		if (name === 'ReadableStream' && member === 'cancel') {
			add(act(wait(method(stream, 'cancel', [param('reason', 'Cancellation reason', 'No more chunks', 'text')]))));
			add(decl('reader', method(stream, 'getReader')), decl('after', wait(method(reader, 'read'))), act(method(reader, 'releaseLock')));
			return done(obj({ cancellations: log, readAfterCancel: v('after') }));
		}
		add(decl('lockedBefore', get(stream, 'locked')));
		add(
			decl('reader', name === 'ReadableStreamDefaultReader' ? make(name, [stream]) : method(stream, 'getReader')),
			decl('lockedDuring', get(stream, 'locked'))
		);
		if (member === 'releaseLock' || member === 'locked') {
			add(act(method(reader, 'releaseLock')));
			return done(obj({ before: v('lockedBefore'), during: v('lockedDuring'), after: get(stream, 'locked') }));
		}
		if (member === 'cancel') {
			add(act(wait(method(reader, 'cancel', [param('reason', 'Cancellation reason', 'Reader stopped', 'text')]))));
			add(decl('after', wait(method(reader, 'read'))), act(method(reader, 'releaseLock')));
			return done(obj({ cancellations: log, readAfterCancel: v('after') }));
		}
		add(decl('values', arr()), {
			op: 'while',
			test: true,
			body: [
				decl('item', wait(method(reader, 'read'))),
				{ op: 'if', test: get(v('item'), 'done'), then: [{ op: 'break' }] },
				act(method(v('values'), 'push', [get(v('item'), 'value')]))
			]
		});
		if (member === 'closed') add(act(wait(get(reader, 'closed'))));
		add(act(method(reader, 'releaseLock')));
		return done(obj({ chunks: v('values'), lockedBefore: v('lockedBefore'), lockedDuring: v('lockedDuring'), lockedAfter: get(stream, 'locked') }));
	}
	if (name === 'TransformStream') {
		require('ReadableStream');
		const chunks = param('chunks', 'Source chunks', ['Hello', 'Thingtime']),
			prefix = param('prefix', 'Text prefix', '→ ', 'text');
		const transformed = { op: 'binary', operator: '+', left: prefix, right: call(global('String'), [v('chunk')]) };
		add(
			decl('stream', make('TransformStream', [obj({ transform: fn(['chunk', 'controller'], method(v('controller'), 'enqueue', [transformed])) })]))
		);
		const source = readable(chunks);
		// The readable side is consumed concurrently; awaiting writes first deadlocks
		// under the transform's default backpressure.
		require('Array', 'fromAsync');
		add(
			decl(
				'pipeline',
				wait(
					method(global('Promise'), 'all', [
						arr(method(source, 'pipeTo', [get(stream, 'writable')]), method(global('Array'), 'fromAsync', [get(stream, 'readable')]))
					])
				)
			)
		);
		return done(obj({ writeResult: get(v('pipeline'), 0), output: get(v('pipeline'), 1) }));
	}
	if (name === 'WritableStream' || name === 'WritableStreamDefaultWriter') {
		if (!summary && !['locked', 'abort', 'close', 'getWriter', 'closed', 'desiredSize', 'ready', 'releaseLock', 'write'].includes(member))
			return undefined;
		require('WritableStream');
		add(decl('log', arr()), decl('state', obj({ closed: false, abortReason: null })));
		add(
			decl(
				'stream',
				make('WritableStream', [
					obj({
						write: fn(['chunk'], method(log, 'push', [v('chunk')])),
						close: fn([], set(state, 'closed', true)),
						abort: fn(['reason'], set(state, 'abortReason', v('reason')))
					})
				])
			)
		);
		if (name === 'WritableStream' && ['abort', 'close'].includes(member)) {
			add(act(wait(method(stream, member, member === 'abort' ? [param('reason', 'Abort reason', 'Sink stopped', 'text')] : []))));
			return done(obj({ received: log, ...{ closed: get(state, 'closed'), abortReason: get(state, 'abortReason') }, locked: get(stream, 'locked') }));
		}
		add(
			decl('lockedBefore', get(stream, 'locked')),
			decl('writer', name === 'WritableStreamDefaultWriter' ? make(name, [stream]) : method(stream, 'getWriter')),
			decl('lockedDuring', get(stream, 'locked'))
		);
		if (member === 'releaseLock' || member === 'locked') {
			add(act(method(writer, 'releaseLock')));
			return done(obj({ before: v('lockedBefore'), during: v('lockedDuring'), after: get(stream, 'locked') }));
		}
		if (member === 'abort') {
			add(act(wait(method(writer, 'abort', [param('reason', 'Abort reason', 'Writer stopped', 'text')]))), act(method(writer, 'releaseLock')));
			return done(obj({ abortReason: get(state, 'abortReason'), locked: get(stream, 'locked') }));
		}
		if (member === 'ready' || member === 'desiredSize') {
			add(
				decl('before', get(writer, 'desiredSize')),
				decl('pending', method(writer, 'write', [param('chunk', 'Chunk', 'Hello')])),
				decl('queued', get(writer, 'desiredSize'))
			);
			add(act(wait(v('pending'))), act(wait(get(writer, 'ready'))), decl('readySize', get(writer, 'desiredSize')));
			add(act(wait(method(writer, 'close'))), act(method(writer, 'releaseLock')));
			return done(obj({ before: v('before'), queued: v('queued'), ready: v('readySize'), received: log }));
		}
		const chunks = param('chunks', 'Chunks to write', ['Hello', 'Thingtime']);
		add({ op: 'for-of', name: 'chunk', value: chunks, body: [act(wait(method(writer, 'write', [v('chunk')])))] });
		add(act(wait(method(writer, 'close'))));
		if (member === 'closed') add(act(wait(get(writer, 'closed'))));
		add(act(method(writer, 'releaseLock')));
		return done(obj({ received: log, closed: get(state, 'closed'), lockedAfter: get(stream, 'locked') }));
	}
	return undefined;
}
