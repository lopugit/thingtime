import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES } from './catalogue';
import { featureRecipe } from './recipes';
import { compilePlatformWorker } from './workerSource';

async function execute(program: unknown, globals: Record<string, unknown> = {}, input = {}) {
	let response: any;
	const context = {
		...globals,
		inputJSON: JSON.stringify(input),
		postMessage: (value: unknown) => {
			response = value;
		}
	};
	// A worker's structured-clone input belongs to its own realm. Recreate JSON
	// there so prototype/instanceof examples do not accidentally test VM hosts.
	await vm.runInNewContext(`${compilePlatformWorker(program)}; onmessage({data: JSON.parse(inputJSON)})`, context, { timeout: 500 });
	return JSON.parse(JSON.stringify(response));
}

test('authored fixtures exercise receivers, callbacks and async results in the actual worker source', async () => {
	for (const [name, expected] of [
		['Reflect.apply', 14],
		['Object.defineProperties', { hello: 'Thingtime', count: 3, answer: 42 }],
		['Set.prototype.union', { type: 'Set', values: [1, 2, 3, 4] }],
		[
			'Map.prototype.forEach',
			[
				{ key: 'one', value: 1 },
				{ key: 'two', value: 2 }
			]
		],
		['Promise.withResolvers', 'Hello'],
		['Array.fromAsync', [2, 4, 6]],
		['ArrayBuffer.prototype.resize', 16],
		['BigInt.asUintN', '44n'],
		['Symbol.keyFor', 'thingtime'],
		['Intl.Collator.prototype.compare', -1]
	] as const) {
		const feature = WEB_FEATURES.find((f) => f.language === 'javascript' && f.name.replace(/^get /, '').split(' (')[0].trim() === name);
		assert.ok(feature, name);
		const { program, coverage } = featureRecipe(feature);
		assert.equal(coverage, 'interactive', name);
		const input = Object.fromEntries((program.parameters || []).map((p) => [p.name, p.default]));
		assert.deepEqual(await execute(program, {}, input), { ok: true, result: expected }, name);
	}
});

test('missing browser features are reported before program execution', async () => {
	const result = await execute({
		version: 1,
		title: 'Missing feature',
		requires: [['AbsentStandard']],
		steps: [{ op: 'throw', value: 'must not run' }]
	});
	assert.equal(result.ok, false);
	assert.equal(result.result.status, 'unsupported');
	assert.deepEqual(result.result.missing, ['AbsentStandard']);
});

test('symbol clauses use computed symbol keys rather than ordinary Intl method names', async () => {
	const feature = WEB_FEATURES.find((f) => f.name === 'Intl.Collator.prototype [ %Symbol.toStringTag% ]');
	assert.ok(feature);
	const { program, coverage } = featureRecipe(feature);
	assert.equal(coverage, 'interactive');
	assert.deepEqual(await execute(program), { ok: true, result: 'Intl.Collator' });
});

test('syntax fixtures exercise the named operations and symbol methods preserve their receivers', async () => {
	for (const [name, expected] of [
		['Bitwise NOT Operator ( ~ )', -4],
		['The Unsigned Right Shift Operator ( >>> )', { '>>>': 0 }],
		['Additive Operators', { '+': 5, '-': 1 }],
		['The break Statement', [1, 2]],
		['The continue Statement', [1, 2, 4, 5]],
		['The try Statement', ['Example error', 'finally ran']],
		['Async Arrow Function Definitions', 8],
		['Array.prototype [ %Symbol.iterator% ] ( )', [1, 2, 3]],
		['get Array [ %Symbol.species% ]', 'Array'],
		['RegExp.prototype [ %Symbol.search% ] ( string )', 1],
		['Function.prototype [ %Symbol.hasInstance% ] ( V )', true]
	] as const) {
		const f = WEB_FEATURES.find((f) => f.language === 'javascript' && f.name === name);
		assert.ok(f, name);
		const { program, coverage } = featureRecipe(f);
		assert.equal(coverage, 'interactive', name);
		const input = Object.fromEntries((program.parameters || []).map((p) => [p.name, p.default]));
		assert.deepEqual(await execute(program, {}, input), { ok: true, result: expected }, name);
	}
	const optional = WEB_FEATURES.find((f) => f.name === 'Optional Chains')!;
	assert.deepEqual(await execute(featureRecipe(optional).program, {}, { object: null, key: 'name' }), { ok: true, result: '[undefined]' });
});

test('availability detection never calls final or intermediate accessors', async () => {
	let reads = 0;
	const Fixture = {
		prototype: Object.defineProperty({}, 'size', {
			get() {
				reads++;
				throw new Error('wrong receiver');
			}
		})
	};
	const base = { version: 1, title: 'Getter support', steps: [{ op: 'return', value: 42 }] };
	assert.deepEqual(await execute({ ...base, requires: [['Fixture', 'prototype', 'size']] }, { Fixture }), { ok: true, result: 42 });
	const intermediate = Object.create(
		Object.defineProperty({}, 'child', {
			get() {
				reads++;
				throw new Error('must not run');
			}
		})
	);
	const unsupported = await execute({ ...base, requires: [['Fixture', 'child', 'size']] }, { Fixture: intermediate });
	assert.equal(unsupported.result.status, 'unsupported');
	assert.equal(reads, 0);
});

test('availability paths remain bounded and data only', () => {
	for (const requires of ['Array', [[]], [['Array', 'constructor']], [['x);postMessage(1)//']], [Array(9).fill('a')], Array(33).fill(['Array'])]) {
		assert.throws(() => compilePlatformWorker({ version: 1, title: 'Invalid requirement', requires }), /availability paths/);
	}
});

test('Web API recipes exercise mutable receivers, byte conversion and body consumption', async () => {
	const globals = { URL, URLSearchParams, Headers, Request, Response, FormData, Blob, File, TextEncoder, TextDecoder, DOMException };
	const run = async (name: string, overrides = {}) => {
		const f = WEB_FEATURES.find((f) => f.language === 'webapi' && f.name === name);
		assert.ok(f, name);
		const { program, coverage } = featureRecipe(f);
		assert.equal(coverage, 'interactive', name);
		const input = { ...Object.fromEntries((program.parameters || []).map((p) => [p.name, p.default])), ...overrides };
		return execute(program, globals, input);
	};
	assert.deepEqual(await run('URLSearchParams.append', { key: 'color', value: 'gold' }), {
		ok: true,
		result: [
			['color', 'purple'],
			['color', 'teal'],
			['name', 'Thingtime'],
			['color', 'gold']
		]
	});
	assert.deepEqual(await run('URLSearchParams.getAll'), { ok: true, result: ['purple', 'teal'] });
	assert.deepEqual(await run('Headers.getSetCookie'), { ok: true, result: ['demo=a', 'demo=b'] });
	assert.deepEqual(await run('FormData.set', { key: 'color', value: 'gold' }), {
		ok: true,
		result: [
			['color', 'gold'],
			['name', 'Thingtime']
		]
	});
	assert.deepEqual(await run('Blob.slice'), { ok: true, result: 'Hello' });
	assert.deepEqual(await run('Body.json', { body: '{"answer":42}' }), { ok: true, result: { answer: 42 } });
	assert.deepEqual(await run('Body.formData'), {
		ok: true,
		result: [
			['name', 'Thingtime'],
			['color', 'purple']
		]
	});
	assert.deepEqual(await run('TextEncoder.encodeInto', { text: '🌈x', capacity: 4 }), {
		ok: true,
		result: { read: 2, written: 4, bytes: { type: 'Uint8Array', values: [240, 159, 140, 136] } }
	});
	assert.deepEqual(await run('TextDecoder.decode', { bytes: [240, 159, 140, 136] }), { ok: true, result: '🌈' });
	assert.deepEqual(await run('DOMException.code'), { ok: true, result: 11 });
	assert.deepEqual(await run('DOMException.ABORT_ERR'), { ok: true, result: 20 });
	const constant = WEB_FEATURES.find((f) => f.name === 'DOMException.ABORT_ERR')!;
	assert.deepEqual(featureRecipe(constant).program.parameters, []);
	assert.deepEqual(await run('URL.canParse', { url: 'http://[' }), { ok: true, result: false });
	assert.deepEqual(await run('URL.parse', { url: 'http://[' }), { ok: true, result: null });
	const invalid = await run('Body.json', { body: 'not json' });
	assert.equal(invalid.ok, false);
	assert.match(invalid.result, /JSON/);
});

test('Web API members retain missing-capability reporting and unimplemented contexts', async () => {
	const f = WEB_FEATURES.find((f) => f.language === 'webapi' && f.name === 'Blob.textStream')!;
	const missing = await execute(featureRecipe(f).program, { Blob: class Blob {} });
	assert.equal(missing.ok, false);
	assert.equal(missing.result.status, 'unsupported');
	assert.deepEqual(missing.result.missing, ['Blob.prototype.textStream']);
	for (const name of ['DOMMatrix.setMatrixValue', 'Geolocation']) {
		const feature = WEB_FEATURES.find((f) => f.language === 'webapi' && f.name === name)!;
		assert.equal(featureRecipe(feature).coverage, 'requires-context');
	}
});

async function runWebApiFeature(name: string, globals: Record<string, unknown>, overrides = {}) {
	const feature = WEB_FEATURES.find((f) => f.language === 'webapi' && f.name === name);
	assert.ok(feature, name);
	const { program, coverage } = featureRecipe(feature);
	assert.equal(coverage, 'interactive', name);
	return execute(program, globals, { ...Object.fromEntries((program.parameters || []).map((p) => [p.name, p.default])), ...overrides });
}

test('event programs observe cancellation, listener identity and abort lifecycles', async () => {
	const globals = { Event, CustomEvent, EventTarget, AbortController, AbortSignal, DOMException };
	const run = (name: string, overrides = {}) => runWebApiFeature(name, globals, overrides);
	const prevented = await run('Event.preventDefault');
	assert.equal(prevented.ok, true);
	assert.equal(prevented.result.dispatchAccepted, false);
	assert.equal(prevented.result.configuration.defaultPrevented, true);
	assert.equal((await run('Event.preventDefault', { cancelable: false })).result.dispatchAccepted, true);
	assert.deepEqual(
		(await run('Event.stopPropagation')).result.delivery.map((entry: any) => entry.listener),
		['first', 'second']
	);
	assert.deepEqual(
		(await run('Event.stopImmediatePropagation')).result.delivery.map((entry: any) => entry.listener),
		['first']
	);
	assert.deepEqual((await run('Event.returnValue')).result, { before: true, after: false, defaultPrevented: true });
	assert.equal((await run('Event.returnValue', { cancelable: false })).result.defaultPrevented, false);
	assert.deepEqual(await run('CustomEvent.detail', { detail: { answer: 42 } }), { ok: true, result: { answer: 42 } });
	assert.equal((await run('EventTarget.addEventListener', { once: true })).result.received.length, 1);
	assert.equal((await run('EventTarget.removeEventListener')).result.received.length, 1);
	assert.deepEqual((await run('EventTarget.dispatchEvent')).result.dispatchAccepted, [false, false]);
	const any = await run('AbortSignal.any', { useSecond: false, reason: 'custom reason' });
	assert.deepEqual(any.result.after, { aborted: true, reason: 'custom reason' });
	assert.equal(any.result.firstAborted, true);
	assert.equal(any.result.secondAborted, false);
	assert.deepEqual((await run('AbortSignal.onabort', { reason: 'Changed' })).result.events, [{ aborted: true, reason: 'Changed' }]);
	assert.deepEqual((await run('AbortSignal.throwIfAborted', { abort: false })).result, { aborted: false, outcome: 'No exception' });
	assert.deepEqual((await run('AbortSignal.throwIfAborted', { reason: 'Stopped' })).result, { aborted: true, outcome: 'Stopped' });
	// Node's native AbortSignal.timeout timer is unref'ed. Keep this one test alive
	// while awaiting the real signal instead of substituting a timer mock.
	const keepAlive = setTimeout(() => {}, 1000);
	try {
		assert.deepEqual(await run('AbortSignal.timeout'), { ok: true, result: { aborted: true, reasonName: 'TimeoutError' } });
	} finally {
		clearTimeout(keepAlive);
	}
	const missing = await runWebApiFeature('EventTarget.when', { EventTarget: class EventTarget {}, Event, AbortController });
	assert.equal(missing.result.status, 'unsupported');
	assert.deepEqual(missing.result.missing, ['EventTarget.prototype.when']);
});

test('stream programs consume data and preserve cancellation, pressure and lock semantics', async () => {
	const globals = {
		ReadableStream,
		WritableStream,
		TransformStream,
		ReadableStreamDefaultReader,
		ReadableStreamBYOBReader,
		WritableStreamDefaultWriter,
		CountQueuingStrategy,
		ByteLengthQueuingStrategy,
		TextEncoderStream,
		TextDecoderStream,
		CompressionStream,
		DecompressionStream,
		TextEncoder,
		Response
	};
	const run = (name: string, overrides = {}) => runWebApiFeature(name, globals, overrides);
	assert.deepEqual((await run('ReadableStream.tee', { chunks: ['one', 'two'] })).result, [
		['one', 'two'],
		['one', 'two']
	]);
	assert.deepEqual((await run('ReadableStream.pipeTo', { chunks: [1, 2] })).result, { received: [1, 2], closed: true, sourceLocked: false });
	assert.deepEqual((await run('ReadableStream.pipeThrough', { chunks: ['one'], prefix: '!' })).result, ['!one']);
	const cancelled = (await run('ReadableStream.cancel', { reason: 'Finished' })).result;
	assert.deepEqual(cancelled.cancellations, ['Finished']);
	assert.equal(cancelled.readAfterCancel.done, true);
	assert.deepEqual((await run('ReadableStream.locked')).result, { before: false, during: true, after: false });
	assert.deepEqual((await run('ReadableStreamBYOBReader.read', { capacity: 2, bytes: [1, 2, 3] })).result, {
		read: { done: false, value: { type: 'Uint8Array', values: [1, 2] } },
		lockedAfterRelease: false
	});
	assert.deepEqual((await run('WritableStreamDefaultWriter.ready', { chunk: 'Changed' })).result, {
		before: 1,
		queued: 0,
		ready: 1,
		received: ['Changed']
	});
	assert.deepEqual((await run('WritableStreamDefaultWriter.abort', { reason: 'Stopped' })).result, { abortReason: 'Stopped', locked: false });
	assert.deepEqual((await run('TransformStream', { chunks: ['one', 'two'], prefix: '!' })).result.output, ['!one', '!two']);
	assert.deepEqual((await run('ByteLengthQueuingStrategy.size', { bytes: [1, 2], highWaterMark: 4 })).result, { highWaterMark: 4, chunkSize: 2 });
	assert.deepEqual((await run('TextDecoderStream')).result, ['🌈']);
	assert.equal((await run('CompressionStream', { text: 'A changed payload' })).result.roundTrip, 'A changed payload');
	assert.equal((await run('TextDecoderStream', { chunks: [[255]], fatal: true })).ok, false);
	const missing = await runWebApiFeature('ReadableStream.from', { ReadableStream: class ReadableStream {} });
	assert.equal(missing.result.status, 'unsupported');
	assert.deepEqual(missing.result.missing, ['ReadableStream.from']);
});

test('controller programs obtain live controllers and demonstrate queue closure, errors and BYOB response', async () => {
	const globals = {
		ReadableStream,
		WritableStream,
		TransformStream,
		ReadableStreamDefaultController,
		ReadableByteStreamController,
		ReadableStreamBYOBRequest,
		WritableStreamDefaultController,
		TransformStreamDefaultController
	};
	const run = (name: string, overrides = {}) => runWebApiFeature(name, globals, overrides);
	const queue = (await run('ReadableByteStreamController.enqueue', { bytes: [1, 2], highWaterMark: 8 })).result;
	assert.equal(queue.desiredSizeBefore, 8);
	assert.equal(queue.desiredSizeQueued, 6);
	assert.deepEqual(queue.read.value, { type: 'Uint8Array', values: [1, 2] });
	assert.equal(queue.afterClose.done, true);
	assert.equal(queue.lockedAfter, false);
	for (const name of ['ReadableStreamBYOBRequest.respond', 'ReadableStreamBYOBRequest.respondWithNewView']) {
		const byob = (await run(name, { bytes: [10, 20, 30], capacity: 2 })).result;
		assert.deepEqual(byob.request, { requestedBytes: 2, respondedBytes: 2, viewAfterRespond: null });
		assert.deepEqual(byob.read.value, { type: 'Uint8Array', values: [10, 20] });
		assert.equal(byob.lockedAfter, false);
	}
	assert.deepEqual((await run('ReadableStreamDefaultController.error', { reason: 'Producer failed' })).result, {
		closedReason: 'Producer failed',
		readReason: 'Producer failed',
		desiredSize: null
	});
	assert.deepEqual((await run('WritableStreamDefaultController.error', { reason: 'Sink failed' })).result, {
		closedReason: 'Sink failed',
		writeReason: 'Sink failed',
		signalAborted: false
	});
	const aborted = (await run('WritableStreamDefaultController.signal', { reason: 'Cancelled' })).result;
	assert.equal(aborted.before, false);
	assert.deepEqual(aborted.after, { aborted: true, reason: 'Cancelled' });
	assert.equal(aborted.abortCallbackReason, 'Cancelled');
	const terminated = (await run('TransformStreamDefaultController.terminate')).result;
	assert.equal(terminated.read.done, true);
	assert.equal(terminated.writeError, 'TypeError');
	assert.equal((await run('TransformStreamDefaultController.error', { reason: 'Bad chunk' })).result.read, 'Bad chunk');
});

test('event and stream Components retain exactly the inputs used by their complete saved programs', () => {
	const families = new Set([
		'Event',
		'CustomEvent',
		'EventTarget',
		'AbortController',
		'AbortSignal',
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
		'DecompressionStream',
		'ReadableStreamDefaultController',
		'ReadableByteStreamController',
		'ReadableStreamBYOBRequest',
		'WritableStreamDefaultController',
		'TransformStreamDefaultController'
	]);
	let checked = 0;
	for (const feature of WEB_FEATURES.filter((f) => f.language === 'webapi' && families.has(f.interface || f.name))) {
		const { program, coverage } = featureRecipe(feature);
		if (coverage !== 'interactive') continue;
		const used = new Set<string>();
		const visit = (value: any) => {
			if (!value || typeof value !== 'object' || value.op === 'literal') return;
			if (value.op === 'input') used.add(value.name);
			Object.values(value).forEach(visit);
		};
		visit(program.steps);
		const parameters = (program.parameters || []).map((p) => p.name);
		assert.equal(new Set(parameters).size, parameters.length, feature.name);
		assert.deepEqual([...used].sort(), parameters.sort(), feature.name);
		assert.doesNotThrow(() => compilePlatformWorker(JSON.parse(JSON.stringify(program))), feature.name);
		checked++;
	}
	assert.ok(checked >= 124);
});
