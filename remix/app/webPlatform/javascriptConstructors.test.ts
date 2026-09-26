import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES } from './catalogue';
import { javascriptConstructorRecipe } from './javascriptConstructorFixtures';
import { compilePlatformWorker } from './workerSource';
import { snapshotPlatformDraft } from './draft';
import { TYPED_ARRAY_CONSTRUCTORS } from './javascriptTypedArrayFixtures';
import type { PlatformProgram } from './types';

const examples = WEB_FEATURES.flatMap(f => { const r = javascriptConstructorRecipe(f); return r ? [{ feature: f, program: r.program }] : []; });
const find = (root: string) => { const item = examples.find(e => e.feature.name.startsWith(root + ' (')); assert.ok(item, root); return item.program; };
async function execute(program: PlatformProgram, edits: Record<string, unknown> = {}) {
	// Match postMessage's copy boundary: native mutations must not alter the
	// catalogue defaults retained by this test process between worker runs.
	let output: any; const input = structuredClone({ ...Object.fromEntries(program.parameters!.map(p => [p.name, p.default])), ...edits });
	await vm.runInNewContext(compilePlatformWorker(program) + ';onmessage({data:input})', { input, postMessage: (value: unknown) => { output = value; } }, { timeout: 1500 });
	return JSON.parse(JSON.stringify(output));
}
async function run(root: string, edits: Record<string, unknown> = {}) {
	const output = await execute(find(root), edits); assert.equal(output.ok, true, `${root}: ${JSON.stringify(output)}`); return output.result;
}
const nativeError = (result: any, name: string) => { assert.equal(result.status, 'threw'); assert.equal(result.error.name, name); };

test('all constructor signatures run complete native programs or report native unavailability', async () => {
	assert.equal(examples.length, 66);
	for (const { feature, program } of examples) {
		const output = await execute(program);
		if (output.result?.status === 'unsupported') { assert.ok(output.result.missing.length); continue; }
		assert.equal(output.ok, true, feature.name + ': ' + JSON.stringify(output));
		assert.equal(output.result.status, 'ok', feature.name + ': ' + JSON.stringify(output));
	}
});

test('call versus new exposes native construction requirements without evaluating source', async () => {
	for (const root of ['Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry', 'Promise', 'Proxy', 'ArrayBuffer', 'DataView', 'Uint8Array', 'Iterator']) nativeError(await run(root, { useNew: false }), 'TypeError');
	for (const root of ['BigInt', 'Symbol']) nativeError(await run(root, { useNew: true }), 'TypeError');
	for (const root of ['Object', 'Boolean', 'Number', 'String', 'Array', 'Error', 'AggregateError', 'Date', 'RegExp']) assert.equal((await run(root, { useNew: false })).status, 'ok', root);
	nativeError(await run('Iterator', { subclass: false }), 'TypeError');
	assert.deepEqual((await run('Iterator', { values: [3, 4] })).values, [3, 4]);
	nativeError(await run('Iterator', { values: { length: 5000 } }), 'RangeError');
});

test('primitive wrappers retain truthiness, omitted arguments, exact integers, symbols and identity', async () => {
	const boxed = await run('Boolean', { value: false }); assert.equal(boxed.value, false); assert.equal(boxed.truthy, true); assert.equal(boxed.type, 'object');
	const primitive = await run('Boolean', { value: false, useNew: false }); assert.equal(primitive.truthy, false); assert.equal(primitive.type, 'boolean');
	assert.equal((await run('Number', { value: '-0' })).negativeZero, true);
	assert.equal((await run('Number', { omit: true })).value, 0);
	assert.equal((await run('Number', { value: 'bad' })).value, 'NaN');
	assert.equal((await run('String', { omit: true })).value, '');
	assert.equal((await run('BigInt', { value: '9007199254740993' })).value, '9007199254740993n');
	nativeError(await run('BigInt', { value: 1.5 }), 'RangeError'); nativeError(await run('BigInt', { omit: true }), 'TypeError');
	const symbol = await run('Symbol', { omit: true }); assert.equal(symbol.description, '[undefined]'); assert.equal(symbol.sameDescriptionIsSameSymbol, false);
	assert.equal((await run('Object', { value: { test: true } })).sameInputIdentity, true);
	assert.equal((await run('Object', { value: null })).sameInputIdentity, false);
});

test('Array construction distinguishes holes from elements and retains native invalid-length errors', async () => {
	const holes = await run('Array', { args: [3] }); assert.equal(holes.length, 3); assert.deepEqual(holes.ownIndexes, []); assert.equal(holes.hasFirstElement, false); assert.deepEqual(holes.values, ['[undefined]', '[undefined]', '[undefined]']);
	const singleString = await run('Array', { args: ['3'] }); assert.deepEqual(singleString.values, ['3']); assert.equal(singleString.hasFirstElement, true);
	nativeError(await run('Array', { args: [1.5] }), 'RangeError'); nativeError(await run('Array', { args: [-1] }), 'RangeError');
	const bounded = await run('Array', { args: [1e9] }); nativeError(bounded, 'RangeError'); assert.match(bounded.error.message, /demo limits allocation/);
});

test('all typed-array overloads use real copying, byte windows, native conversion and bounds', async () => {
	for (const type of TYPED_ARRAY_CONSTRUCTORS) {
		for (const mode of ['values', 'length', 'copy', 'buffer', 'array-like']) {
			const output = await execute(find('TypedArray'), { type, mode });
			assert.equal(output.ok, true, type + '/' + mode + ': ' + JSON.stringify(output));
			if (output.result.status === 'unsupported') { assert.deepEqual(output.result.missing, [type]); continue; }
			assert.equal(output.result.status, 'ok', type + '/' + mode + ': ' + JSON.stringify(output));
			assert.equal(output.result.sharesBuffer, mode === 'buffer');
		}
	}
	assert.deepEqual((await run('Uint8Array', { values: [-1, 256, 300] })).beforeMutation, [255, 0, 44]);
	assert.deepEqual((await run('Uint8ClampedArray', { values: [-1, 1.5, 2.5, 300] })).beforeMutation, [0, 2, 2, 255]);
	assert.deepEqual((await run('BigInt64Array', { values: ['9007199254740993'] })).beforeMutation, ['9007199254740993n']);
	const copy = await run('Uint16Array', { mode: 'copy' }); assert.equal(copy.beforeMutation[0], 3); assert.equal(copy.afterMutation[0], 3); assert.equal(copy.source[0], 9);
	const shared = await run('Uint16Array', { mode: 'buffer' }); assert.equal(shared.beforeMutation[0], 3); assert.equal(shared.afterMutation[0], 9);
	assert.deepEqual((await run('Uint8Array', { mode: 'array-like', values: [7], length: 3 })).beforeMutation, [7, 0, 0]);
	nativeError(await run('Uint16Array', { mode: 'buffer', offset: 1 }), 'RangeError'); nativeError(await run('Uint8Array', { mode: 'buffer', length: 10 }), 'RangeError');
	nativeError(await run('TypedArray', { type: 'Function' }), 'RangeError'); nativeError(await run('TypedArray', { mode: 'bogus' }), 'RangeError');
});

test('buffers, view construction and Date preserve their native initialization and invalid states', async () => {
	const buffer = await run('ArrayBuffer'); assert.equal(buffer.resizable, true); assert.equal(buffer.maxByteLength, 32); assert.deepEqual(buffer.bytes, Array(8).fill(0));
	const fixed = await run('ArrayBuffer', { resizable: false }); assert.equal(fixed.resizable, false); assert.equal(fixed.maxByteLength, 8);
	nativeError(await run('ArrayBuffer', { length: 9, maximum: 8 }), 'RangeError'); nativeError(await run('ArrayBuffer', { length: 5000 }), 'RangeError');
	const view = await run('DataView', { offset: 2, length: 2, value: 300 }); assert.deepEqual(view.bytes, [1, 2, 44, 4, 5, 6]); assert.equal(view.byteOffset, 2); assert.equal(view.sharesBuffer, true);
	nativeError(await run('DataView', { offset: 6, length: 1 }), 'RangeError');
	for (const bytes of [5000, '5000', { length: 5000 }]) { const limited = await run('DataView', { bytes }); nativeError(limited, 'RangeError'); assert.match(limited.error.message, /This demo limits allocation/); }
	assert.deepEqual((await run('DataView', { bytes: 6 })).bytes, [0, 255, 0, 0, 0, 0]);
	const date = await run('Date', { args: [0] }); assert.equal(date.iso, '1970-01-01T00:00:00.000Z'); assert.equal(date.epoch, 0);
	const invalid = await run('Date', { args: ['not a date'] }); assert.equal(invalid.iso, null); assert.equal(invalid.epoch, 'NaN');
});

test('native error descriptors, collection construction and weak identities remain observable', async () => {
	const cause = await run('Error', { options: { cause: 'Nested cause' } }); assert.equal(cause.cause, 'Nested cause'); assert.equal(cause.causeDescriptor.enumerable, false);
	assert.equal((await run('NativeError', { type: 'URIError' })).name, 'URIError');
	const aggregate = await run('AggregateError', { errors: 'abc' }); assert.deepEqual(aggregate.errors, ['a', 'b', 'c']); assert.equal(aggregate.errorsDescriptor.enumerable, false);
	assert.deepEqual((await run('Map')).entries, [['one', 3], ['two', 2]]);
	assert.deepEqual((await run('Set')).entries, [1, 2, 3]); assert.equal((await run('Map', { iterable: null })).size, 0);
	nativeError(await run('Map', { iterable: [1] }), 'TypeError');
	const weak = await run('WeakMap'); assert.equal(weak.hasOriginal, true); assert.equal(weak.hasEqualLookingObject, false); assert.equal(weak.value, 'last');
	nativeError(await run('WeakMap', { key: 2 }), 'TypeError'); nativeError(await run('WeakRef', { key: 2 }), 'TypeError');
	const registry = await run('FinalizationRegistry'); assert.equal(registry.removed, true); assert.equal(registry.secondRemoval, false); assert.deepEqual(registry.cleanup, []);
	nativeError(await run('FinalizationRegistry', { callable: false }), 'TypeError');
});

test('Promise executor, assimilation jobs and reactions preserve first-settlement semantics', async () => {
	const resolved = await run('Promise', { thenable: true }); assert.deepEqual(resolved.beforeAwait, ['executor started', 'first settlement requested']); assert.deepEqual(resolved.trace, ['executor started', 'first settlement requested', 'thenable called', 'fulfilled reaction']); assert.deepEqual(resolved.settled, { state: 'fulfilled', value: 'Thingtime' });
	assert.equal((await run('Promise', { settlement: 'reject', value: 'Original rejection' })).settled.reason, 'Original rejection');
	assert.equal((await run('Promise', { settlement: 'throw' })).settled.reason, 'Error: Thingtime');
	assert.equal((await run('Promise', { settlement: 'resolve-then-throw', thenable: true })).settled.state, 'fulfilled');
	nativeError(await run('Promise', { callable: false }), 'TypeError');
});

test('Proxy invariants and RegExp constructor identity use actual engine outcomes', async () => {
	const proxy = await run('Proxy'); assert.equal(proxy.read, 5); assert.equal(proxy.targetValue, 10); assert.equal(proxy.writeAccepted, true);
	const refused = await run('Proxy', { allowWrite: false }); assert.equal(refused.writeAccepted, false); assert.equal(refused.targetValue, 2);
	nativeError(await run('Proxy', { fixed: true }), 'TypeError'); assert.equal((await run('Proxy', { fixed: true, delta: 0 })).writeAccepted, false);
	const same = await run('RegExp', { existing: true, omitFlags: true, useNew: false }); assert.equal(same.sameInputIdentity, true); assert.equal(same.indexAfterFirst, 3); assert.equal(same.indexAfterSecond, 7);
	assert.equal((await run('RegExp', { existing: true, omitFlags: true })).sameInputIdentity, false);
	const noGlobal = await run('RegExp', { flags: '' }); assert.equal(noGlobal.indexAfterFirst, 0); assert.equal(noGlobal.second.index, 0);
	nativeError(await run('RegExp', { pattern: '[' }), 'SyntaxError');
});

test('edited constructor Components preserve operation nodes and exact native behavior after saving', async () => {
	for (const [root, edits] of [['Array', { args: [4] }], ['BigInt64Array', { values: ['9007199254740993'], mode: 'copy' }], ['Promise', { thenable: true, settlement: 'resolve-then-throw' }], ['Proxy', { allowWrite: false }]] as const) {
		const original = find(root); const overrides = Object.fromEntries(Object.entries(edits).map(([name, value]) => { const p = original.parameters!.find(p => p.name === name)!; return [name, { type: p.type, value: p.type === 'json' ? JSON.stringify(value) : value }]; }));
		const saved = snapshotPlatformDraft(JSON.stringify(original), overrides).program;
		assert.notDeepEqual(saved.parameters, original.parameters); assert.deepEqual(saved.steps, original.steps); assert.deepEqual(await execute(saved), await execute(original, edits));
	}
});
