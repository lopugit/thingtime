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
		input: structuredClone(input),
		postMessage: (value: unknown) => {
			response = value;
		}
	};
	await vm.runInNewContext(`${compilePlatformWorker(program)}; onmessage({data: input})`, context, { timeout: 500 });
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

test('symbol clauses are not mistaken for ordinary Intl method names', () => {
	const feature = WEB_FEATURES.find((f) => f.name === 'Intl.Collator.prototype [ %Symbol.toStringTag% ]');
	assert.ok(feature);
	assert.equal(featureRecipe(feature).coverage, 'inspection');
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
