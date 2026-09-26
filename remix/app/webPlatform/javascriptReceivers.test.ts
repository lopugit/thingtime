import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { WEB_FEATURES } from './catalogue';
import { javascriptReceiverRecipe } from './javascriptReceiverFixtures';
import { javascriptPrototypeRecipe } from './javascriptPrototypeFixtures';
import { compilePlatformWorker } from './workerSource';
import { snapshotPlatformDraft } from './draft';
import type { PlatformProgram } from './types';

const examples = WEB_FEATURES.flatMap(feature => {
	const result = javascriptReceiverRecipe(feature) || javascriptPrototypeRecipe(feature);
	return result ? [{ name: feature.name, program: result.program }] : [];
});
const find = (name: string) => {
	const result = examples.find(f => f.name === name || f.name.startsWith(`${name} (`));
	assert.ok(result, name); return result.program;
};
async function execute(program: PlatformProgram, edits: Record<string, unknown> = {}) {
	let response: any;
	const inputs = Object.fromEntries((program.parameters || []).map(p => [p.name, p.default]));
	Object.assign(inputs, edits);
	await vm.runInNewContext(compilePlatformWorker(program) + ';onmessage({data:inputs})', { inputs, postMessage: (value: unknown) => { response = value; } }, { timeout: 1000 });
	return JSON.parse(JSON.stringify(response));
}
async function run(name: string, edits: Record<string, unknown> = {}) {
	const response = await execute(find(name), edits);
	assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`); return response.result;
}

test('all receiver programs execute native defaults or explicitly identify unavailable native members', async () => {
	assert.equal(examples.length, 158);
	for (const { name, program } of examples) {
		const response = await execute(program);
		if (!response.ok) {
			assert.equal(response.result?.status, 'unsupported', `${name}: ${JSON.stringify(response)}`);
			assert.ok(response.result.missing.length); continue;
		}
		const result = response.result;
		if (result && typeof result === 'object') {
			for (const key of ['receiverUsesPrototype', 'expectedConstructor', 'intrinsicUnchanged', 'intrinsicPrototypeUnchanged'])
				if (key in result) assert.equal(result[key], true, `${name}: ${key}`);
		}
	}
});

test('DataView programs preserve byte windows, endian order, truncation, BigInt precision and native bounds errors', async () => {
	const little = await run('DataView.prototype.getUint16');
	assert.equal(little.result, 258); assert.equal(little.oppositeEndian, 513); assert.deepEqual(little.bytes.slice(5, 7), [2, 1]);
	const big = await run('DataView.prototype.setUint16', { littleEndian: false });
	assert.equal(big.result, '[undefined]'); assert.equal(big.readBack, 258); assert.deepEqual(big.bytes.slice(5, 7), [1, 2]);
	assert.equal((await run('DataView.prototype.setInt8')).readBack, 2);
	assert.equal((await run('DataView.prototype.getBigInt64')).readBack, '9007199254740993n');
	assert.equal((await run('get DataView.prototype.byteOffset', { viewOffset: 7 })).value, 7);
	assert.equal((await run('get DataView.prototype.byteLength', { viewLength: 10 })).value, 10);
	const invalid = await execute(find('DataView.prototype.getUint16'), { offset: 24 });
	assert.equal(invalid.ok, false); assert.match(invalid.result, /bounds|offset/i);
});

test('iterator helpers expose lazy callback execution, early stopping and the remaining original iterator', async () => {
	const map = await run('Iterator.prototype.map');
	assert.equal(map.visitedBeforeConsumption, 0); assert.deepEqual(map.visited, [1, 2, 3, 4, 5]); assert.deepEqual(map.result, [2, 4, 6, 8, 10]);
	const found = await run('Iterator.prototype.find');
	assert.equal(found.result, 3); assert.deepEqual(found.visited, [1, 2, 3]); assert.deepEqual(found.remaining, [4, 5]);
	assert.deepEqual((await run('Iterator.prototype.take')).result, [1, 2]);
	assert.equal((await run('Iterator.prototype.reduce', { values: [], initial: 7 })).result, 7);
	assert.deepEqual((await run('Iterator.prototype.flatMap', { values: [2, 3], factor: 3 })).result, [2, 6, 3, 9]);
	const negative = await execute(find('Iterator.prototype.take'), { limit: -1 }); assert.equal(negative.ok, false);
});

test('weak receivers demonstrate identity and registration without promising garbage collection', async () => {
	const weakMap = await run('WeakMap.prototype.set');
	assert.equal(weakMap.result, 'same collection'); assert.equal(weakMap.hasKey, true); assert.equal(weakMap.hasEqualLookingObject, false); assert.equal(weakMap.stored, 'new value');
	assert.equal((await run('WeakMap.prototype.delete')).hasKey, false);
	assert.equal((await run('WeakSet.prototype.add')).hasKey, true);
	assert.equal((await run('WeakSet.prototype.delete')).hasKey, false);
	assert.equal((await run('WeakRef.prototype.deref')).sameIdentity, true);
	for (const member of ['register', 'unregister']) {
		const result = await run(`FinalizationRegistry.prototype.${member}`);
		assert.equal(result.unregistered, true); assert.equal(result.secondUnregister, false); assert.deepEqual(result.cleanup, []);
	}
	const insertion = find('WeakMap.prototype.getOrInsertComputed');
	for (const present of [true, false]) {
		const response = await execute(insertion, { present });
		if (response.result?.status === 'unsupported') continue;
		assert.equal(response.ok, true); assert.equal(response.result.computedCalls, present ? 0 : 1);
		assert.equal(response.result.stored, present ? 'existing' : 'new value');
	}
});

test('promise callbacks preserve settlement and expose finally replacement only when cleanup throws', async () => {
	assert.deepEqual(await run('Promise.prototype.then', { reject: true, value: 'reason' }), { result: { status: 'fulfilled', value: { handled: 'rejected', value: 'reason' } }, trace: ['rejected'] });
	assert.deepEqual(await run('Promise.prototype.catch'), { result: { status: 'fulfilled', value: { handled: 'caught', value: 'Thingtime' } }, trace: ['caught'] });
	assert.deepEqual(await run('Promise.prototype.finally'), { result: { status: 'fulfilled', value: 'Thingtime' }, trace: ['finally'] });
	assert.deepEqual((await run('Promise.prototype.finally', { reject: true })).result, { status: 'rejected', reason: 'Thingtime' });
	assert.deepEqual((await run('Promise.prototype.finally', { cleanupThrows: true })).result, { status: 'rejected', reason: 'Error: cleanup failed' });
});

test('function receivers, errors, symbols and coercing globals return their native semantics', async () => {
	assert.equal(await run('Function.prototype.apply'), 20); assert.equal(await run('Function.prototype.call', { base: 5, factor: 3, first: 2, second: 1 }), 12);
	const bound = await run('Function.prototype.bind'); assert.equal(bound.result, 20); assert.equal(bound.changedThisIgnored, 20); assert.equal(bound.length, 1); assert.equal(bound.name, 'bound compute');
	assert.equal((await run('Error.prototype.message', { message: 'edited' })).value, 'edited');
		assert.equal((await run('NativeError.prototype.name')).value, 'TypeError');
		const namedError = await run('Error.prototype.name', { name: 'BuilderError' });
		assert.equal(namedError.value, 'BuilderError'); assert.equal(namedError.inheritedDefault, 'Error');
	assert.equal((await run('get Symbol.prototype.description', { description: 'edited' })).value, 'edited');
	assert.deepEqual(await run('isFinite'), { result: true, withoutCoercion: false });
	assert.deepEqual(await run('isNaN', { value: 'not a number' }), { result: true, withoutCoercion: false });
	assert.equal((await run('parseInt')).result, 42); assert.equal((await run('parseFloat')).result, 3.14);
	assert.equal((await run('decodeURI', { value: 'https://example.invalid/%F0%9F%8C%88?q=1%262' })).result, 'https://example.invalid/🌈?q=1%262');
});

test('prototype examples extend only fresh receivers and invoke actual accessor setters', async () => {
	const array = await run('Array.prototype.constructor', { label: 'My inherited value' });
	assert.equal(array.constructor.name, 'Array'); assert.equal(array.expectedConstructor, true); assert.equal(array.inheritedLabel, 'My inherited value'); assert.equal(array.intrinsicUnchanged, true);
	for (const name of ['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction', 'Function']) {
		const result = await run(`${name}.prototype.constructor`, { value: 'edited' }); assert.equal(result.expectedConstructor, true);
		assert.deepEqual(result.invoked, name.includes('Generator') ? { value: 'edited', done: false } : 'edited');
	}
	const iterator = await run('set Iterator.prototype.constructor', { replacement: 'local replacement' });
	assert.equal(iterator.ownProperty.value, 'local replacement'); assert.equal(iterator.prototypeStillAccessor, 'function');
	const tag = await run('set Iterator.prototype [ %Symbol.toStringTag% ]', { replacement: 'local tag' }); assert.equal(tag.ownProperty.value, 'local tag'); assert.equal(tag.inheritedGetter, 'Iterator');
	const legacy = await run('set Object.prototype.__proto__', { replacement: { inherited: 'new parent' } });
	assert.equal(legacy.inherited, 'new parent'); assert.equal(legacy.agreesWithGetPrototypeOf, true); assert.equal(legacy.intrinsicPrototypeUnchanged, true);
});

test('saved receiver programs retain callbacks, native calls and edited defaults without source substitution', async () => {
	for (const name of ['DataView.prototype.getBigInt64', 'Iterator.prototype.map', 'Promise.prototype.finally', 'Array.prototype.constructor']) {
		const original = find(name), first = original.parameters![0];
		const edits = { [first.name]: { type: first.type, value: first.type === 'json' ? JSON.stringify(first.default) : first.default } };
		const saved = snapshotPlatformDraft(JSON.stringify(original), edits);
		assert.deepEqual(saved.program.steps, original.steps);
		assert.deepEqual(await execute(snapshotPlatformDraft(JSON.stringify(saved.program)).program), await execute(original));
	}
});
