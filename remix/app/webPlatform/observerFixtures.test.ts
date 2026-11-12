import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { compilePlatformWorker } from './workerSource';
import { observerRecipe } from './observerFixtures';
import { editObserverProgram } from './observerTestCases';
import { OBSERVER_BOUNDARIES } from './observerBoundaryFixtures';
test('all Mutation, Resize and Intersection Observer entries carry editable saved programs', () => {
	const features = WEB_FEATURES.filter((f) => observerRecipe(f));
	assert.equal(features.length, 81);
	for (const feature of features) {
		const program = observerRecipe(feature)!.program;
		assert.equal(featureCoverage(feature), 'interactive');
		const component = JSON.parse(JSON.stringify(componentForFeature(feature.id)));
		assert.deepEqual(component.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, program);
		const edited = editObserverProgram(program);
		assert.notDeepEqual(edited.parameters, program.parameters);
		for (const version of [program, edited]) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(version)), feature.name);
	}
	for (const fixture of OBSERVER_BOUNDARIES) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(fixture.program)), fixture.name);
});
