import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { CSS_FUNCTION_EXAMPLES, cssFunctionRecipe } from './cssFunctionFixtures';
import { compilePlatformWorker } from './workerSource';
import { validatePlatformProgram } from './compiler';
import { CSS_PROBE_BOUNDARY_FIXTURES } from './cssProbeBoundaryFixtures';

test('CSS functions are serializable editable Component programs with concrete contexts', () => {
	const examples = WEB_FEATURES.filter((f) => cssFunctionRecipe(f));
	assert.equal(examples.length, 180);
	for (const f of examples) {
		const program = cssFunctionRecipe(f)!.program;
		assert.doesNotThrow(() => compilePlatformWorker(program), f.name);
		assert.equal(featureCoverage(f), 'interactive', f.name);
		const saved = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		assert.deepEqual(saved.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, program);
		assert.notEqual(CSS_FUNCTION_EXAMPLES[f.name].value, CSS_FUNCTION_EXAMPLES[f.name].edited);
	}
	assert.equal(cssFunctionRecipe(WEB_FEATURES.find((f) => f.language === 'css' && f.name === 'element()' && f.group === 'css-gcpm-3')!), undefined);
	const cssFunction = examples[0];
	assert.equal(cssFunctionRecipe({ ...cssFunction, kind: 'type' }), undefined);
	assert.equal(cssFunctionRecipe({ ...cssFunction, name: 'paint()' }), undefined, 'Worklet setup is still required');
});
test('CSS observations reject malformed or unbounded fields before rendering', () => {
	for (const probe of [
		{ name: 3 },
		{ name: '' },
		{ name: 'width', target: {} },
		{ name: 'width', value: 'x'.repeat(2049) },
		{ name: 'width', compareTarget: [] },
		{ name: 'content', pseudoElement: '::part(secret)' },
		{ name: 'color', pseudoElement: '::before{color:red}' }
	])
		assert.throws(() => validatePlatformProgram({ version: 1, title: 'Invalid probe', probe: { kind: 'css', ...probe } }));
	for (const fixture of CSS_PROBE_BOUNDARY_FIXTURES.filter((f) => !f.error)) assert.doesNotThrow(() => compilePlatformWorker(fixture.program));
});
