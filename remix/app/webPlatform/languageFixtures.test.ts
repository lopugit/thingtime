import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES } from './catalogue';
import { featureRecipe } from './recipes';
import { javascriptDefinitionsRecipe } from './javascriptDefinitions';
import { javascriptControlRecipe } from './javascriptControl';
import { compilePlatformWorker } from './workerSource';

async function run(name: string, overrides = {}) {
	const feature = WEB_FEATURES.find((f) => f.language === 'javascript' && f.name === name);
	assert.ok(feature, name);
	const recipe = featureRecipe(feature);
	assert.equal(recipe.coverage, 'interactive', name);
	const program = JSON.parse(JSON.stringify(recipe.program));
	const input = { ...Object.fromEntries((program.parameters || []).map((p) => [p.name, p.default])), ...overrides };
	let response: any;
	await vm.runInNewContext(
		`${compilePlatformWorker(program)};onmessage({data:JSON.parse(inputJSON)})`,
		{
			inputJSON: JSON.stringify(input),
			postMessage: (value) => {
				response = value;
			}
		},
		{ timeout: 1000 }
	);
	assert.equal(response.ok, true, name + ': ' + JSON.stringify(response));
	return JSON.parse(JSON.stringify(response.result));
}

test('language fixtures retain all authored nodes and exactly their used inputs through JSON persistence', async () => {
	let count = 0;
	for (const feature of WEB_FEATURES.filter((f) => f.language === 'javascript')) {
		const authored = javascriptDefinitionsRecipe(feature) || javascriptControlRecipe(feature);
		if (!authored) continue;
		count++;
		assert.deepEqual(featureRecipe(feature), authored);
		const used = new Set<string>();
		const visit = (value: any) => {
			if (!value || typeof value !== 'object' || value.op === 'literal') return;
			if (value.op === 'input') used.add(value.name);
			Object.values(value).forEach(visit);
		};
		visit(authored.program.steps);
		assert.deepEqual([...used].sort(), (authored.program.parameters || []).map((p) => p.name).sort(), feature.name);
		await run(feature.name);
	}
	assert.equal(count, 28);
});

test('changed language inputs exercise private fields, receiver binding, generators and control flow', async () => {
	assert.deepEqual(await run('Class Definitions', { initial: 8, amount: -3, replacement: 0 }), {
		before: 8,
		incremented: 5,
		afterSetter: 0,
		staticKind: 'Counter',
		instances: 1,
		privateBrand: true,
		plainObjectBrand: false
	});
	assert.equal(await run('The this Keyword', { base: 10, amount: -2 }), 8);
	assert.equal(await run('The super Keyword', { name: 'Builder', suffix: '?' }), 'Hello Builder?');
	for (const name of ['Generator Function Definitions', 'Async Generator Function Definitions'])
		assert.deepEqual(await run(name, { items: [3, 5], factor: 4 }), [12, 20]);
	assert.equal(await run('The do-while Statement', { limit: -2 }), 1);
	assert.deepEqual(await run('The for Statement', { limit: 0 }), []);
	assert.deepEqual(await run('The switch Statement', { choice: 'unknown' }), ['default']);
	assert.deepEqual(await run('Labelled Statements', { items: [1, 2], stop: 1 }), []);
	assert.deepEqual(await run('Postfix Increment Operator', { initial: '9' }), { returned: 9, stored: 10 });
	assert.deepEqual(await run('The delete Operator', { object: { retained: 2 }, key: 'missing' }), { deleted: true, after: { retained: 2 } });
	const assignments = await run('Assignment Operators', { initial: null, right: 7 });
	assert.deepEqual(assignments['??='], { returned: 7, stored: 7 });
	assert.deepEqual(assignments['&&='], { returned: null, stored: null });
	assert.equal(await run('Template Literals', { name: null, count: 0 }), 'Hello null!\nCount: 0.');
});
