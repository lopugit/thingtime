import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { ariaRecipe } from './ariaFixtures';
import { editARIAProgram } from './ariaTestCases';
import { ARIA_BOUNDARIES } from './ariaBoundaryFixtures';
import { ariaArgument } from './ariaPolicy';
import { compilePlatformWorker } from './workerSource';
test('all catalogued ARIA properties and element relationships survive editable Component serialization', () => {
	const features = WEB_FEATURES.filter((f) => (f.interface || f.name) === 'ARIAMixin');
	assert.equal(features.length, 53);
	for (const f of features) {
		const program = ariaRecipe(f)!.program;
		assert.equal(featureCoverage(f), 'interactive');
		const component = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		assert.deepEqual(component.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, program);
		const edited = editARIAProgram(program);
		assert.notDeepEqual(program.parameters, edited.parameters);
		for (const p of [program, edited]) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(p)), f.name);
	}
	for (const f of ARIA_BOUNDARIES) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(f.program)), f.name);
});
test('ARIA native conversion bounds nullable text and validates every element reference before assignment', () => {
	const element = {};
	const resolve = (raw: unknown) => {
		if (raw !== 'owned') throw Error('foreign element');
		return element;
	};
	assert.equal(ariaArgument(null, 'aria-text', resolve), null);
	assert.equal(ariaArgument('false', 'aria-text', resolve), 'false');
	assert.equal(ariaArgument('owned', 'aria-element', resolve), element);
	assert.deepEqual(ariaArgument(['owned'], 'aria-elements', resolve), [element]);
	assert.throws(() => ariaArgument(false, 'aria-text', resolve), /text/);
	assert.throws(() => ariaArgument('x'.repeat(4097), 'aria-text', resolve), /text/);
	assert.throws(() => ariaArgument(Array(65).fill('owned'), 'aria-elements', resolve), /64/);
	assert.throws(() => ariaArgument(['owned', 'foreign'], 'aria-elements', resolve), /foreign/);
});
