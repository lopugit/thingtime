import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	variable as v,
	object as obj,
	array as arr,
	fn,
	awaited as wait,
	declare as decl,
	perform as act,
	setProperty as set,
	project as projection,
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
const rejection = (promise: unknown) => wait(method(promise, 'catch', [fn(['error'], v('error'))]));

export function controllerApiRecipe(f: Feature): Recipe | undefined {
	const name = f.interface || f.name,
		member = f.member || '',
		summary = f.kind === 'interface';
	if (
		![
			'ReadableStreamDefaultController',
			'ReadableByteStreamController',
			'ReadableStreamBYOBRequest',
			'WritableStreamDefaultController',
			'TransformStreamDefaultController'
		].includes(name)
	)
		return undefined;
	const p: PlatformProgram = { ...base(f), parameters: [], steps: [], requires: [[name]] };
	const param = (key: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => {
		p.parameters!.push(parameter(key, label, value, type));
		return input(key);
	};
	const add = (...steps: PlatformExpression[]) => p.steps!.push(...steps);
	const require = (...path: string[]) => p.requires!.push(path);
	const done = (value: unknown) =>
		recipe(
			{ ...p, steps: [...p.steps!, ...returns(value)] },
			'interactive',
			'An in-memory stream supplies the real controller or BYOB request. The editable program observes queue state, data delivery and closure or failure. No request is sent.'
		);
	const state = v('state'),
		stream = v('stream'),
		reader = v('reader'),
		writer = v('writer'),
		controller = get(state, 'controller');
	const capture = fn(['controller'], set(state, 'controller', v('controller')));
	add(decl('state', obj({})));
	if (name === 'ReadableStreamBYOBRequest' || (name === 'ReadableByteStreamController' && member === 'byobRequest')) {
		require('ReadableStream');
		if (name === 'ReadableStreamBYOBRequest' && !summary && !['view', 'respond', 'respondWithNewView'].includes(member)) return undefined;
		const bytes = param('bytes', 'Source bytes', [10, 20, 30], 'json'),
			capacity = param('capacity', 'Requested byte capacity', 4, 'number');
		const request = get(state, 'request'),
			view = get(request, 'view'),
			count = get(state, 'respondedBytes');
		const actions = [
			set(state, 'request', get(v('controller'), 'byobRequest')),
			set(state, 'requestedBytes', get(view, 'byteLength')),
			set(state, 'respondedBytes', method(global('Math'), 'min', [get(bytes, 'length'), get(view, 'byteLength')])),
			method(view, 'set', [method(bytes, 'slice', [0, count])]),
			member === 'respondWithNewView'
				? method(request, 'respondWithNewView', [method(view, 'subarray', [0, count])])
				: method(request, 'respond', [count]),
			set(state, 'viewAfterRespond', get(request, 'view')),
			method(v('controller'), 'close')
		];
		add(decl('stream', make('ReadableStream', [obj({ type: 'bytes', pull: fn(['controller'], arr(...actions)) })])));
		add(decl('reader', method(stream, 'getReader', [obj({ mode: 'byob' })])));
		add(
			decl('read', wait(method(reader, 'read', [make('Uint8Array', [capacity])]))),
			act(wait(get(reader, 'closed'))),
			act(method(reader, 'releaseLock'))
		);
		return done(
			obj({
				request: projection(state, ['requestedBytes', 'respondedBytes', 'viewAfterRespond']),
				read: v('read'),
				lockedAfter: get(stream, 'locked')
			})
		);
	}
	if (name === 'ReadableStreamDefaultController' || name === 'ReadableByteStreamController') {
		if (!summary && !['desiredSize', 'close', 'enqueue', 'error'].includes(member)) return undefined;
		require('ReadableStream');
		const byteStream = name === 'ReadableByteStreamController';
		add(
			decl(
				'stream',
				make('ReadableStream', [
					obj({ start: capture, ...(byteStream ? { type: 'bytes' } : {}) }),
					obj({ highWaterMark: param('highWaterMark', byteStream ? 'Queue capacity (bytes)' : 'Queue capacity (chunks)', 8, 'number') })
				])
			)
		);
		if (member === 'error') {
			add(act(method(controller, 'error', [param('reason', 'Failure reason', 'Producer failed')])));
			add(
				decl('reader', method(stream, 'getReader')),
				decl('closedReason', rejection(get(reader, 'closed'))),
				decl('readReason', rejection(method(reader, 'read'))),
				act(method(reader, 'releaseLock'))
			);
			return done(obj({ closedReason: v('closedReason'), readReason: v('readReason'), desiredSize: get(controller, 'desiredSize') }));
		}
		const chunk = byteStream
			? make('Uint8Array', [param('bytes', 'Bytes to enqueue', [10, 20, 30], 'json')])
			: param('chunk', 'Chunk to enqueue', 'Hello Thingtime');
		add(decl('before', get(controller, 'desiredSize')), act(method(controller, 'enqueue', [chunk])), decl('queued', get(controller, 'desiredSize')));
		add(act(method(controller, 'close')), decl('reader', method(stream, 'getReader')));
		add(decl('first', wait(method(reader, 'read'))), decl('finished', wait(method(reader, 'read'))), act(method(reader, 'releaseLock')));
		return done(
			obj({
				desiredSizeBefore: v('before'),
				desiredSizeQueued: v('queued'),
				read: v('first'),
				afterClose: v('finished'),
				lockedAfter: get(stream, 'locked')
			})
		);
	}
	if (name === 'WritableStreamDefaultController') {
		if (!summary && !['signal', 'error'].includes(member)) return undefined;
		require('WritableStream');
		add(decl('stream', make('WritableStream', [obj({ start: capture, abort: fn(['reason'], set(state, 'abortReason', v('reason'))) })])));
		const reason = param('reason', 'Stop reason', 'Sink stopped');
		if (member === 'error') {
			add(act(method(controller, 'error', [reason])), decl('writer', method(stream, 'getWriter')));
			add(
				decl('closedReason', rejection(get(writer, 'closed'))),
				decl('writeReason', rejection(method(writer, 'write', ['data']))),
				act(method(writer, 'releaseLock'))
			);
			return done(obj({ closedReason: v('closedReason'), writeReason: v('writeReason'), signalAborted: get(get(controller, 'signal'), 'aborted') }));
		}
		add(decl('before', get(get(controller, 'signal'), 'aborted')), act(wait(method(stream, 'abort', [reason]))));
		return done(
			obj({
				before: v('before'),
				after: projection(get(controller, 'signal'), ['aborted', 'reason']),
				abortCallbackReason: get(state, 'abortReason')
			})
		);
	}
	if (name === 'TransformStreamDefaultController') {
		if (!summary && !['desiredSize', 'enqueue', 'error', 'terminate'].includes(member)) return undefined;
		require('TransformStream');
		add(decl('stream', make('TransformStream', [obj({ start: capture })])));
		if (member === 'error' || member === 'terminate') {
			add(act(method(controller, member, member === 'error' ? [param('reason', 'Failure reason', 'Transform failed')] : [])));
			add(decl('reader', method(get(stream, 'readable'), 'getReader')), decl('writer', method(get(stream, 'writable'), 'getWriter')));
			add(decl('readClosed', rejection(get(reader, 'closed'))), decl('writeClosed', rejection(get(writer, 'closed'))));
			add(decl('read', rejection(method(reader, 'read'))), decl('writeError', rejection(method(writer, 'write', ['data']))));
			add(act(method(reader, 'releaseLock')), act(method(writer, 'releaseLock')));
			return done(
				obj({
					read: v('read'),
					writeError: member === 'terminate' ? get(v('writeError'), 'name') : v('writeError'),
					desiredSize: get(controller, 'desiredSize')
				})
			);
		}
		add(
			decl('before', get(controller, 'desiredSize')),
			act(method(controller, 'enqueue', [param('chunk', 'Chunk to enqueue', 'Hello Thingtime')])),
			decl('queued', get(controller, 'desiredSize'))
		);
		add(
			decl('reader', method(get(stream, 'readable'), 'getReader')),
			decl('first', wait(method(reader, 'read'))),
			decl('drained', get(controller, 'desiredSize'))
		);
		add(
			decl('writer', method(get(stream, 'writable'), 'getWriter')),
			act(wait(method(writer, 'close'))),
			decl('finished', wait(method(reader, 'read')))
		);
		add(act(method(reader, 'releaseLock')), act(method(writer, 'releaseLock')));
		return done(obj({ before: v('before'), queued: v('queued'), drained: v('drained'), read: v('first'), afterClose: v('finished') }));
	}
	return undefined;
}
