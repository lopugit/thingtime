import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES } from './catalogue';
import { javascriptBindingRecipe } from './javascriptBindingFixtures';
import { compilePlatformWorker } from './workerSource';
import { snapshotPlatformDraft } from './draft';
const examples = WEB_FEATURES.flatMap((f) => {
	const r = javascriptBindingRecipe(f);
	return r ? [{ feature: f, program: r.program }] : [];
});
const find = (name: string) => {
	const item = examples.find((e) => e.feature.name === name);
	assert.ok(item, name);
	return item.program;
};
async function execute(program: any, edits: Record<string, unknown> = {}) {
	const input = structuredClone({ ...Object.fromEntries(program.parameters.map((p: any) => [p.name, p.default])), ...edits });
	let output: any;
	await vm.runInNewContext(
		compilePlatformWorker(program) + ';onmessage({data:input})',
		{
			input,
			postMessage: (value: unknown) => {
				output = value;
			}
		},
		{ timeout: 1500 }
	);
	assert.equal(output.ok, true, JSON.stringify(output));
	return JSON.parse(JSON.stringify(output.result));
}
const run = (name: string, edits = {}) => execute(find(name), edits);
const bind = 'Destructuring Binding Patterns',
	assign = 'Destructuring Assignment',
	iterator = 'Runtime Semantics: IteratorDestructuringAssignmentEvaluation';
test('every authored binding example executes complete saved program data', async () => {
	assert.equal(examples.length, 20);
	for (const { feature, program } of examples) {
		const result = await execute(program);
		assert.equal(result.status, 'ok', feature.name + ': ' + JSON.stringify(result));
	}
});
test('editable patterns preserve undefined-only defaults, nested arrays, errors and assignment identity', async () => {
	for (const name of [bind, assign]) {
		const object = await run(name, { source: { title: null, count: 2 } });
		assert.equal(object.result.selected, null);
		assert.deepEqual(object.trace, ['computed key']);
		const missing = await run(name, { source: {}, fallback: 'chosen' });
		assert.equal(missing.result.selected, 'chosen');
		assert.deepEqual(missing.trace, ['computed key', 'property default']);
		const array = await run(name, { array: true, values: [1, 9, {}, 4], undefinedFirst: true, fallback: 'custom' });
		assert.deepEqual(array.result, { first: 'custom', label: 'custom', rest: [4], ...(name === assign ? { sameSource: true } : {}) });
		assert.deepEqual(array.trace, ['first default', 'nested default']);
		for (const edits of [{ source: null }, { array: true, values: [1, 2, null] }, { array: true, values: { length: 10 } }]) {
			const bad = await run(name, edits);
			assert.equal(bad.status, 'threw');
			assert.equal(bad.name, 'TypeError');
		}
		const bound = await run(name, { array: true, undefinedFirst: true, values: { length: 5000 } });
		assert.equal(bound.name, 'RangeError');
		assert.match(bound.message, /demo limits/);
	}
});
test('object rest preserves enumerable symbol and getter values while excluding inherited and hidden values', async () => {
	for (const name of ['Runtime Semantics: RestBindingInitialization', 'Runtime Semantics: RestDestructuringAssignmentEvaluation']) {
		const value = await run(name, { source: { title: 'custom', extra: 4 }, key: 'observed', observed: 11, symbolValue: 'kept' });
		assert.equal(value.result.selected, 11);
		assert.equal(value.result.symbol, 'kept');
		assert.deepEqual(value.result.restKeys, ['title', 'extra', 'Symbol(rest key)']);
		assert.deepEqual(value.result.rest, { title: 'custom', extra: 4 });
		const nativeTrace = vm.runInNewContext(
			`(()=>{const trace=[];const source=Object.assign(Object.create({inherited:99}),{title:'custom',extra:4});Object.defineProperty(source,'hidden',{value:'non-enumerable',enumerable:false});Object.defineProperty(source,'observed',{enumerable:true,get(){trace.push('rest getter');return 11}});source[Symbol('rest key')]='kept';${
				name.includes('Assignment')
					? "let selected,rest;({[(trace.push('computed key'),'observed')]:selected,...rest}=source)"
					: "const {[(trace.push('computed key'),'observed')]:selected,...rest}=source"
			};return trace})()`
		);
		assert.deepEqual(value.trace, JSON.parse(JSON.stringify(nativeTrace)));
		assert.equal(value.result.expectedGetterReads, 1);
		assert.equal(value.result.getterReads, value.trace.filter((s: string) => s === 'rest getter').length);
		assert.equal(value.result.matchesExpectedGetterReads, value.result.getterReads === 1);
	}
});
test('iterator patterns expose consumption, elision, lazy default failure and cleanup', async () => {
	assert.deepEqual(await run(iterator), {
		status: 'ok',
		result: { first: 1, third: 3 },
		trace: [{ yielded: 1 }, { yielded: 2 }, { yielded: 3 }, 'generator closed']
	});
	const exhausted = await run(iterator, { mode: 'rest' });
	assert.deepEqual(exhausted.result, { first: 1, rest: [2, 3, 4] });
	assert.equal(exhausted.trace.at(-1), 'generator closed');
	assert.deepEqual(await run(iterator, { mode: 'empty' }), { status: 'ok', result: {}, trace: [] });
	const failed = await run(iterator, { undefinedFirst: true, throwDefault: true });
	assert.equal(failed.status, 'threw');
	assert.equal(failed.name, 'Error');
	assert.deepEqual(failed.trace, [{ yielded: 1 }, 'default initializer', 'generator closed']);
});
test('loop bindings capture per-iteration values and async rows without leaking a shared var by default', async () => {
	for (const name of ['Runtime Semantics: ForDeclarationBindingInitialization', 'Runtime Semantics: ForDeclarationBindingInstantiation']) {
		for (const async of [false, true]) {
			const rows = [[7, 'first'], [8]];
			assert.deepEqual((await run(name, { rows, async })).result, [
				{ number: 7, label: 'first' },
				{ number: 8, label: 'untitled' }
			]);
			assert.deepEqual((await run(name, { rows, async, shared: true })).result, [
				{ number: 8, label: 'untitled' },
				{ number: 8, label: 'untitled' }
			]);
		}
	}
	for (const name of [
		'CreatePerIterationEnvironment ( perIterationBindings )',
		'ForBodyEvaluation ( test, increment, stmt, perIterationBindings, labelSet )'
	]) {
		assert.deepEqual((await run(name, { start: 2, limit: 5 })).result, [2, 3, 4]);
		assert.deepEqual((await run(name, { start: 2, limit: 5, shared: true })).result, [5, 5, 5]);
		for (const edits of [
			{ start: 0, limit: 17 },
			{ start: 2 ** 53, limit: 2 ** 53 + 2 }
		])
			assert.equal((await run(name, edits)).name, 'RangeError');
	}
});
test('all six native function forms retain destructured and rest parameter defaults', async () => {
	for (const example of examples.filter((e) => e.feature.name.includes('Instantiate'))) {
		const value = await execute(example.program, { omit: true, fallback: 'custom', rest: [9, 8] });
		const expected = { label: 'custom', first: 9, tail: [8] };
		assert.deepEqual(value.result, example.feature.name.includes('Generator') ? [expected] : expected);
	}
});
test('saved edited binding Components preserve nodes and actual input defaults', async () => {
	const program = find(bind);
	const values: Record<string, any> = {
		...Object.fromEntries(program.parameters!.map((p) => [p.name, p.default])),
		array: true,
		values: [5, 0, { label: 'saved' }, 7]
	};
	const saved = snapshotPlatformDraft(
		JSON.stringify(program),
		Object.fromEntries(
			program.parameters!.map((p) => [p.name, { type: p.type, value: p.type === 'json' ? JSON.stringify(values[p.name]) : values[p.name] }])
		)
	).program;
	assert.deepEqual(saved.steps, program.steps);
	assert.equal(saved.parameters!.find((p) => p.name === 'array')!.default, true);
	assert.deepEqual((await execute(saved)).result, { first: 5, label: 'saved', rest: [7] });
});
