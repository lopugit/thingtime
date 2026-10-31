import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES } from './catalogue';
import { javascriptIteratorRecipe } from './javascriptIteratorFixtures';
import { javascriptTypedArrayRecipe } from './javascriptTypedArrayFixtures';
import { compilePlatformWorker } from './workerSource';
import { snapshotPlatformDraft } from './draft';
import type { PlatformProgram } from './types';

const examples = WEB_FEATURES.flatMap(feature => {
	const result = javascriptTypedArrayRecipe(feature) || javascriptIteratorRecipe(feature);
	return result ? [{ name: feature.name, program: result.program }] : [];
});
const find = (name: string) => {
	const result = examples.find(f => f.name === name || f.name.startsWith(`${name} (`));
	assert.ok(result, name); return result.program;
};
async function execute(program: PlatformProgram, edits: Record<string, unknown> = {}) {
	let response: any;
	const inputs = { ...Object.fromEntries((program.parameters || []).map(p => [p.name, p.default])), ...edits };
	await vm.runInNewContext(compilePlatformWorker(program) + ';onmessage({data:inputs})', { inputs, postMessage: (value: unknown) => { response = value; } }, { timeout: 1000 });
	return JSON.parse(JSON.stringify(response));
}
async function run(name: string, edits: Record<string, unknown> = {}) {
	const response = await execute(find(name), edits);
	assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`); return response.result;
}
const operation = (result: any) => result.operation.value;

test('every newly authored intrinsic runs its default native program', async () => {
	assert.equal(examples.length, 67);
	for (const { name, program } of examples) {
		const response = await execute(program);
		assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`);
		for (const key of ['expectedConstructor', 'receiverUsesIntrinsic', 'receiverUsesPrototype', 'sameIterator', 'distinctWrapper'])
			if (key in response.result) assert.equal(response.result[key], true, `${name}: ${key}`);
	}
});

test('typed-array operations work across native numeric widths and BigInt constructors', async () => {
	const types = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
	for (const { name, program } of examples.filter(f => f.name.includes('%TypedArray%'))) for (const type of types) {
		const response = await execute(program, { type });
		assert.equal(response.ok, true, `${name} / ${type}: ${JSON.stringify(response)}`);
		if (response.result.status === 'unsupported') assert.deepEqual(response.result.missing, [type]);
	}
	const invalid = await execute(find('%TypedArray%.of'), { type: 'Function' });
	assert.equal(invalid.ok, false); assert.match(invalid.result, /standard typed array/);
	const abstract = await run('%TypedArray%'); assert.equal(abstract.abstractConstruction.name, 'TypeError');
});

test('typed-array byte windows preserve truncation, signedness, clamping, precision and native errors', async () => {
	assert.deepEqual((await run('%TypedArray%.prototype.values', { values: [-1, 256, 300] })).result, [255, 0, 44]);
	assert.deepEqual((await run('%TypedArray%.prototype.values', { type: 'Int8Array', values: [255, 128, 127] })).result, [-1, -128, 127]);
	assert.deepEqual((await run('%TypedArray%.prototype.values', { type: 'Uint8ClampedArray', values: [-1, 1.5, 2.5, 300] })).result, [0, 2, 2, 255]);
	assert.deepEqual((await run('%TypedArray%.of', { type: 'BigInt64Array', values: ['9007199254740993', '-9007199254740993'] })).result, ['9007199254740993n', '-9007199254740993n']);
	assert.equal((await run('get %TypedArray%.prototype.byteOffset', { type: 'Float64Array', prefix: 3 })).result, 24);
	assert.equal((await run('get %TypedArray%.prototype.byteLength', { type: 'Int16Array', values: [1, 2, 3] })).result, 6);
	assert.equal((await run('get %TypedArray%.prototype.buffer')).result.byteLength, 9);
	assert.equal((await execute(find('get %TypedArray%.prototype.byteOffset'), { prefix: 5 })).ok, false);
	assert.equal((await execute(find('%TypedArray%.prototype.set'), { offset: 5 })).ok, false);
});

test('typed-array callbacks and copy operations expose real visitation, mutation and shared storage', async () => {
	const mapped = await run('%TypedArray%.prototype.map', { factor: 3 });
	assert.deepEqual(mapped.result, [9, 3, 12, 3, 15]); assert.equal(mapped.sharesBackingBuffer, false);
	assert.deepEqual(mapped.visited.map((v: any) => v.index), [0, 1, 2, 3, 4]);
	const every = await run('%TypedArray%.prototype.every'); assert.equal(every.result, false); assert.deepEqual(every.visited.map((v: any) => v.value), [3, 1]);
	const from = await run('%TypedArray%.from', { values: [300], factor: 2 }); assert.deepEqual(from.visited, [{ value: 300, index: 0 }]); assert.deepEqual(from.result, [88]);
	const reduced = await run('%TypedArray%.prototype.reduceRight', { type: 'BigInt64Array', initial: '9007199254740993' });
	assert.equal(reduced.result, '9007199254741007n'); assert.deepEqual(reduced.visited.map((v: any) => v.index), [4, 3, 2, 1, 0]);
	const sorted = await run('%TypedArray%.prototype.sort', { descending: true }); assert.deepEqual(sorted.result, [5, 4, 3, 1, 1]); assert.equal(sorted.sameReceiver, true);
	const copy = await run('%TypedArray%.prototype.toSorted'); assert.equal(copy.sameReceiver, false); assert.deepEqual(copy.receiver.values, [3, 1, 4, 1, 5]);
	assert.equal((await run('%TypedArray%.prototype.subarray')).sharesBackingBuffer, true);
	assert.equal((await run('%TypedArray%.prototype.slice')).sharesBackingBuffer, false);
});

test('native iterators expose completion, uniqueness, Unicode code points and UTF-16 segmentation', async () => {
	const array = await run('%ArrayIteratorPrototype%.next', { values: [] }); assert.deepEqual(array.first, { value: '[undefined]', done: true });
	const set = await run('%SetIteratorPrototype%.next'); assert.deepEqual(set.remaining, [3]); assert.equal(set.afterCompletion.done, true);
	const string = await run('%StringIteratorPrototype%.next'); assert.equal(string.second.value, '🌈'); assert.deepEqual(string.remaining, ['B']);
	const segment = await run('%IntlSegmentsPrototype%.containing'); assert.equal(segment.segment, '🌈'); assert.equal(segment.index, 1);
	assert.equal(await run('%IntlSegmentsPrototype%.containing', { index: 100 }), '[undefined]');
	const regexp = await run('%RegExpStringIteratorPrototype%.next'); assert.deepEqual(regexp.first.value, ['one']); assert.deepEqual(regexp.remaining, [['three']]);
	const inherited = await run('%ForInIteratorPrototype%.next', { remove: 'second' }); assert.deepEqual(inherited.visited.map((v: any) => v.key), ['first', 'inherited']);
});

test('generator return and throw preserve suspended finally cleanup and observed exceptions', async () => {
	for (const family of ['GeneratorPrototype', 'AsyncGeneratorPrototype']) {
		const next = await run(`%${family}%.next`, { signal: 'sent' }); assert.deepEqual(next.traceAtOperation, [{ received: 'sent' }]); assert.deepEqual(operation(next), { value: 'second', done: false });
		const returned = await run(`%${family}%.return`, { yieldCleanup: true, signal: 'requested return' });
		assert.deepEqual(operation(returned), { value: 'cleanup', done: false }); assert.deepEqual(returned.after.value, { value: 'requested return', done: true }); assert.deepEqual(returned.trace, ['finally']);
		const recovered = await run(`%${family}%.throw`); assert.equal(operation(recovered).value, 'recovered'); assert.deepEqual(recovered.trace, [{ caught: 'signal' }, 'finally']);
		const thrown = await run(`%${family}%.throw`, { handleThrow: false }); assert.equal(thrown.operation.status, 'rejected'); assert.equal(thrown.operation.error.message, 'signal'); assert.equal(thrown.after.value.done, true);
	}
});

test('async-from-sync delegation awaits source values and traces missing protocol methods honestly', async () => {
	const next = await run('%AsyncFromSyncIteratorPrototype%.next'); assert.equal(next.first.value.value, 1); assert.equal(operation(next).value, 2); assert.equal(next.traceAtOperation[1].sent, 'signal');
	const returned = await run('%AsyncFromSyncIteratorPrototype%.return'); assert.deepEqual(operation(returned), { value: 'closed', done: true }); assert.equal(returned.traceAtOperation[1].operation, 'return');
	const absentReturn = await run('%AsyncFromSyncIteratorPrototype%.return', { includeReturn: false }); assert.deepEqual(operation(absentReturn), { value: 'signal', done: true }); assert.equal(absentReturn.trace.length, 1);
	// The host Node version may predate the published missing-throw cleanup fix.
	// Compare with an independent native protocol trace, and require the saved
	// program to identify compliance rather than replacing the engine result.
	let closed = false, nativeError: any;
	const source = { next: () => ({ done: false, value: Promise.resolve(1) }), return: () => { closed = true; return { done: true, value: undefined }; }, [Symbol.iterator]() { return this; } };
	const native = (async function* () { yield* source; })();
	await native.next(); try { await native.throw('signal'); } catch (error) { nativeError = error; }
	const absentThrow = await run('%AsyncFromSyncIteratorPrototype%.throw', { includeThrow: false });
	assert.equal(absentThrow.operation.status, 'rejected'); assert.equal(absentThrow.operation.error.name, nativeError?.name ?? '[undefined]');
	assert.equal(absentThrow.missingThrowCheck.cleanupObserved, closed);
	assert.equal(absentThrow.missingThrowCheck.matchesPublishedBehavior, nativeError?.name === 'TypeError' && closed);
	assert.match(absentThrow.missingThrowCheck.expected, /TypeError.*2026/);
	assert.equal(absentThrow.observedThrough, 'async generator yield*');
});

test('native helper return closes a generator while wrapper fallback return does not invent source cleanup', async () => {
	const helper = await run('%IteratorHelperPrototype%.return'); assert.deepEqual(helper.traceAtOperation, [1, 'source closed']); assert.equal(helper.after.done, true);
	const wrapper = await run('%WrapForValidIteratorPrototype%.return', { includeReturn: false }); assert.deepEqual(operation(wrapper), { value: '[undefined]', done: true }); assert.equal(wrapper.after.value.value, 2); assert.deepEqual(wrapper.trace.map((v: any) => v.operation), ['next', 'next']);
	const tag = await run('%Symbol.toStringTag%', { tag: 'My Thing' }); assert.equal(tag.nativeString, '[object My Thing]');
});

test('saved intrinsic programs retain actual edited inputs and protocol behavior', async () => {
	for (const [name, edits] of [
		['%TypedArray%.prototype.map', { type: 'BigInt64Array', values: ['9007199254740993'], factor: '3' }],
		['%GeneratorPrototype%.return', { yieldCleanup: true, signal: 'Saved return' }],
		['%AsyncFromSyncIteratorPrototype%.throw', { includeThrow: false }]
	] as const) {
		const original = find(name);
		const overrides = Object.fromEntries(Object.entries(edits).map(([name, value]) => { const p = original.parameters!.find(p => p.name === name)!; return [name, { type: p.type, value: p.type === 'json' ? JSON.stringify(value) : value }]; }));
		const saved = snapshotPlatformDraft(JSON.stringify(original), overrides).program;
		assert.notDeepEqual(saved.parameters, original.parameters); assert.deepEqual(saved.steps, original.steps);
		assert.deepEqual(await execute(saved), await execute(original, edits));
	}
});
