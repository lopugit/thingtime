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
