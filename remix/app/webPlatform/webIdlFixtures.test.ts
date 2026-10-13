import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES } from './catalogue';
import { webIdlRecipe } from './webIdlFixtures';
import { webIdlStreamRecipe } from './webIdlStreamFixtures';
import { compilePlatformWorker } from './workerSource';
import { snapshotPlatformDraft } from './draft';

const nativeNames = [
	'Event',
	'CustomEvent',
	'EventTarget',
	'AbortController',
	'AbortSignal',
	'Blob',
	'File',
	'Request',
	'Response',
	'Headers',
	'TextDecoder',
	'ReadableStream',
	'ReadableStreamBYOBReader',
	'WritableStream',
	'TransformStream',
	'CountQueuingStrategy',
	'ByteLengthQueuingStrategy'
];
const native = Object.fromEntries(nativeNames.map((name) => [name, (globalThis as any)[name]]));
const examples = WEB_FEATURES.flatMap((feature) => {
	const r = webIdlRecipe(feature) || webIdlStreamRecipe(feature);
	return r ? [{ feature, program: r.program }] : [];
});
const find = (name: string) => {
	const item = examples.find((e) => e.feature.name === name);
	assert.ok(item, name);
	return item.program;
};
async function execute(program: any, edits: Record<string, unknown> = {}) {
	let output: any;
	await vm.runInNewContext(
		compilePlatformWorker(program) + ';onmessage({data:input})',
		{
			...native,
			input: structuredClone({ ...Object.fromEntries(program.parameters.map((p: any) => [p.name, p.default])), ...edits }),
			postMessage: (value: unknown) => {
				output = value;
			}
		},
		{ timeout: 1500 }
	);
	assert.ok(output, 'Worker produced a terminal result');
	if (output.result?.status !== 'unsupported') assert.equal(output.ok, true, JSON.stringify(output));
	return JSON.parse(JSON.stringify(output.result));
}
const run = (name: string, edits = {}) => execute(find(name), edits);
test('132 dictionary, field, enum, typedef and callback entries contain complete executable programs', async () => {
	assert.equal(examples.length, 132);
	for (const { feature, program } of examples) {
		const result = await execute(program);
		if (feature.name.startsWith('DOM')) assert.equal(result.status, 'unsupported', feature.name);
		else if (['UnderlyingSink.type', 'Transformer.readableType', 'Transformer.writableType'].includes(feature.name))
			assert.equal(result.name, 'RangeError', feature.name);
		else if (['Transformer.cancel', 'TransformerCancelCallback'].includes(feature.name)) assert.ok(['ok', 'unsupported'].includes(result.status));
		else assert.equal(result.status, 'ok', feature.name + ': ' + JSON.stringify(result));
	}
	for (const name of ['RequestInit.priority', 'RequestInit.privateToken', 'RequestInit.targetAddressSpace'])
		assert.ok(!examples.some((e) => e.feature.name === name));
});
test('event dictionaries preserve defaults, native booleans, cancellation and arbitrary detail', async () => {
	assert.equal((await run('EventInit', { options: {}, preventDefault: true })).result.dispatchAccepted, true);
	const value = (await run('EventInit', { options: { bubbles: 'false', cancelable: 1, composed: 0 } })).result;
	assert.equal(value.event.bubbles, true);
	assert.equal(value.event.composed, false);
	assert.equal(value.event.defaultPrevented, true);
	assert.equal(value.dispatchAccepted, false);
	assert.equal(value.event.isTrusted, false);
	assert.deepEqual((await run('CustomEventInit', { options: { detail: { op: 'input', name: 'literal data' } } })).result.event.detail, {
		op: 'input',
		name: 'literal data'
	});
});
test('listener callback objects preserve this, once, capture removal and AbortSignal lifetime', async () => {
	const basic = (await run('EventListener', { label: 'custom' })).result;
	assert.deepEqual(
		basic.received.map((e: any) => e.label),
		['custom', 'custom']
	);
	assert.equal((await run('AddEventListenerOptions.once', { options: { once: true } })).result.received.length, 1);
	assert.equal(
		(await run('EventListenerOptions.capture', { options: { capture: true }, removeOptions: { capture: false } })).result.received.length,
		2
	);
	assert.equal(
		(await run('EventListenerOptions.capture', { options: { capture: true }, removeOptions: { capture: true } })).result.received.length,
		1
	);
	assert.equal((await run('AddEventListenerOptions.signal', { abortAt: 'before' })).result.received.length, 0);
	assert.equal((await run('AddEventListenerOptions.signal')).result.received.length, 1);
	assert.equal((await run('AddEventListenerOptions.signal', { abortAt: 'never' })).result.received.length, 2);
	const target = new EventTarget();
	const event = new Event('example', { cancelable: true });
	target.addEventListener('example', (e) => e.preventDefault(), { passive: true });
	const accepted = target.dispatchEvent(event);
	assert.equal(
		(await run('AddEventListenerOptions.passive', { options: { passive: true } })).result.dispatchAccepted[0],
		accepted,
		'Preserve the actual engine passive behavior'
	);
	assert.equal((await run('AddEventListenerOptions.signal', { options: { signal: 1 }, useSignal: false })).name, 'TypeError');
});
test('file property bags use native MIME, endings and timestamp conversion', async () => {
	const transparent = (await run('BlobPropertyBag', { text: 'a\r\nb\rc', options: { type: 'TEXT/PLAIN', endings: 'transparent' } })).result;
	assert.equal(transparent.text, 'a\r\nb\rc');
	assert.equal(transparent.metadata.type, 'text/plain');
	assert.deepEqual(transparent.bytes, [97, 13, 10, 98, 13, 99]);
	const actual = new Blob(['a\r\nb\rc'], { endings: 'native' });
	assert.equal((await run('EndingType', { text: 'a\r\nb\rc', options: { endings: 'native' } })).result.text, await actual.text());
	assert.equal((await run('BlobPropertyBag', { options: { type: 'text/💫' } })).result.metadata.type, '');
	assert.equal((await run('BlobPropertyBag', { options: { endings: 'invalid' } })).name, 'TypeError');
	assert.equal(
		(await run('FilePropertyBag', { options: { lastModified: 7.9 }, name: 'custom.txt' })).result.metadata.lastModified,
		new File([], 'custom.txt', { lastModified: 7.9 }).lastModified
	);
});
test('fetch options construct native metadata and bodies without fetching', async () => {
	const request = (
		await run('RequestInit', {
			options: {
				method: 'post',
				body: 'custom',
				headers: [
					['X-A', 'one'],
					['x-a', 'two']
				],
				cache: 'reload',
				credentials: 'same-origin',
				redirect: 'error',
				referrer: '',
				duplex: 'half'
			},
			useSignal: true,
			reason: { code: 4 }
		})
	).result;
	assert.equal(request.metadata.method, 'POST');
	assert.equal(request.metadata.cache, 'reload');
	assert.equal(request.body, 'custom');
	assert.ok(request.headers.some((entry: any) => entry[0] === 'x-a' && entry[1] === 'one, two'));
	assert.deepEqual(request.signal, { aborted: true, reason: { code: 4 } });
	for (const options of [
		{ method: 'GET', body: 'forbidden' },
		{ method: 'TRACE' },
		{ mode: 'invalid' },
		{ duplex: 'full' },
		{ window: {} },
		{ headers: { 'bad name': 'value' } }
	])
		assert.equal((await run('RequestInit', { options })).name, 'TypeError');
	assert.equal((await run('ResponseInit', { options: { status: 204 }, body: null })).result.metadata.status, 204);
	assert.equal((await run('ResponseInit', { options: { status: 204 }, body: 'not allowed' })).name, 'TypeError');
	assert.equal((await run('ResponseInit', { options: { status: 99 } })).name, 'RangeError');
	assert.deepEqual(
		(
			await run('HeadersInit', {
				headers: [
					['X-A', 'one'],
					['x-a', 'two']
				]
			})
		).result,
		[['x-a', 'one, two']]
	);
});
test('decoder dictionaries preserve BOM, fatal errors and streaming state with bounded byte allocation', async () => {
	assert.equal((await run('TextDecoderOptions')).result.first, 'A');
	assert.equal((await run('TextDecoderOptions', { options: { ignoreBOM: true } })).result.first, '\uFEFFA');
	assert.equal((await run('TextDecoderOptions', { options: { fatal: true }, firstBytes: [255] })).name, 'TypeError');
	assert.equal((await run('TextDecoderOptions', { firstBytes: [255] })).result.first, '\uFFFD');
	assert.equal((await run('TextDecodeOptions')).result.combined, '€');
	assert.equal((await run('TextDecodeOptions', { decodeOptions: { stream: false } })).result.combined, '\uFFFD\uFFFD');
	for (const firstBytes of [2 ** 30, { length: 2 ** 30 }, Array(4097).fill(0)])
		assert.equal((await run('TextDecoderOptions', { firstBytes })).name, 'RangeError');
});
test('native queuing callbacks account sizes and validate queue limits', async () => {
	const value = (await run('QueuingStrategy', { chunks: [2, 3], highWaterMark: 8 })).result;
	assert.deepEqual(value.trace, [{ before: 8 }, { sizeCalledWith: 2 }, { after: 6 }, { sizeCalledWith: 3 }, { after: 3 }]);
	assert.deepEqual(value.first, { value: 2, done: false });
	assert.equal((await run('QueuingStrategy', { chunks: [-1] })).name, 'RangeError');
	assert.equal((await run('QueuingStrategy', { highWaterMark: -1 })).name, 'RangeError');
	assert.equal((await run('QueuingStrategyInit', { options: {} })).name, 'TypeError');
	assert.equal((await run('QueuingStrategyInit', { options: { highWaterMark: 6 }, chunk: { byteLength: 9 } })).result.bytes.size, 9);
});
test('pipe options preserve error, close and abort propagation independently', async () => {
	assert.deepEqual((await run('StreamPipeOptions')).result.trace, [{ write: 'Thingtime' }, 'close']);
	assert.deepEqual((await run('StreamPipeOptions', { options: { preventClose: true } })).result.trace, [{ write: 'Thingtime' }]);
	for (const [mode, option, callback] of [
		['source-error', 'preventAbort', 'abort'],
		['sink-error', 'preventCancel', 'cancel']
	]) {
		const before = (await run('StreamPipeOptions', { mode })).result;
		assert.equal(before.settlement.status, 'rejected');
		assert.ok(before.trace.some((event: any) => event[callback] === 'demo reason'));
		const after = (await run('StreamPipeOptions', { mode, options: { [option]: true } })).result;
		assert.equal(after.settlement.status, 'rejected');
		assert.ok(!after.trace.some((event: any) => event[callback]));
		assert.equal(after.sourceLocked, false);
		assert.equal(after.sinkLocked, false);
	}
	const aborted = (await run('StreamPipeOptions.signal')).result;
	assert.deepEqual(aborted.trace, [{ abort: 'demo reason' }, { cancel: 'demo reason' }]);
	assert.deepEqual((await run('StreamPipeOptions.signal', { options: { preventAbort: true, preventCancel: true } })).result.trace, []);
});
test('reader options choose the reader and preserve BYOB transfer and native min validation', async () => {
	const byob = (await run('ReadableStreamBYOBReaderReadOptions')).result;
	assert.equal(byob.byob, true);
	assert.deepEqual(byob.value, [10, 20, 30, 40]);
	assert.equal(byob.originalViewByteLength, 0);
	assert.equal(byob.locked, false);
	const regular = (await run('ReadableStreamGetReaderOptions', { options: {} })).result;
	assert.equal(regular.byob, false);
	assert.equal(regular.originalViewByteLength, 8);
	assert.equal((await run('ReadableStreamGetReaderOptions', { options: { mode: 'invalid' } })).name, 'TypeError');
	assert.equal((await run('ReadableStreamBYOBReaderReadOptions', { readOptions: { min: 9 } })).name, 'RangeError');
	assert.equal((await run('ReadableStreamBYOBReaderReadOptions', { readOptions: { min: 0 } })).name, 'TypeError');
	assert.equal((await run('ReadableStreamBYOBReaderReadOptions', { capacity: 2 ** 30 })).name, 'RangeError');
});
test('underlying source and sink callbacks execute native lifecycles, errors and allocation bounds', async () => {
	assert.deepEqual((await run('UnderlyingSource.cancel')).result.trace, ['start', { cancel: 'finished' }]);
	assert.deepEqual((await run('UnderlyingSource.autoAllocateChunkSize')).result.trace, ['start', { pull: true, autoAllocatedBytes: 8 }]);
	assert.equal((await run('UnderlyingSource', { options: { type: 'invalid' } })).name, 'TypeError');
	for (const size of [2 ** 30, String(2 ** 30)])
		assert.equal((await run('UnderlyingSource', { options: { type: 'bytes', autoAllocateChunkSize: size } })).name, 'RangeError');
	assert.equal((await run('UnderlyingSource', { options: { type: 'bytes', autoAllocateChunkSize: 0 } })).name, 'TypeError');
	assert.deepEqual((await run('UnderlyingSink')).result.trace, ['start', { write: 'one' }, { write: 'two' }, 'close']);
	assert.deepEqual((await run('UnderlyingSink.abort', { chunks: [] })).result.trace, ['start', { abort: 'demo reason' }]);
	assert.equal((await run('UnderlyingSink', { action: 'write-error' })).result.settlement.status, 'rejected');
	assert.equal((await run('UnderlyingSink.type')).name, 'RangeError');
});
test('transformer callbacks preserve backpressure, flush and native cancellation availability', async () => {
	const transformed = (await run('Transformer', { chunks: ['a', 'b'], prefix: 'first', suffix: '?', last: 'last' })).result;
	assert.deepEqual(transformed.values, ['first', 'a?', 'b?', 'last']);
	assert.deepEqual(transformed.trace, ['start', { transform: 'a' }, { transform: 'b' }, 'flush']);
	const canceled = await run('Transformer.cancel', { reason: 'custom' });
	if (canceled.status === 'ok') assert.deepEqual(canceled.result.trace, ['start', { cancel: 'custom' }]);
	else assert.equal(canceled.status, 'unsupported');
	for (const name of ['Transformer.readableType', 'Transformer.writableType']) assert.equal((await run(name)).name, 'RangeError');
});
test('edited dictionary inputs and callback definitions survive saved Component snapshots', async () => {
	const program = find('StreamPipeOptions');
	const edited = snapshotPlatformDraft(JSON.stringify(program), {
		options: { type: 'json', value: JSON.stringify({ preventClose: true }) },
		chunk: { type: 'json', value: JSON.stringify({ name: '{name}', op: 'literal', value: '$input.foo' }) }
	}).program;
	const saved = JSON.parse(JSON.stringify(edited));
	assert.deepEqual(saved.steps, program.steps);
	const result = (await execute(saved)).result;
	assert.deepEqual(result.trace, [{ write: { name: '{name}', op: 'literal', value: '$input.foo' } }]);
});
