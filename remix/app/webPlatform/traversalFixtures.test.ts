import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { traversalRecipe, editTraversalProgram } from './traversalFixtures';
import { compilePlatformWorker } from './workerSource';
import { TRAVERSAL_BOUNDARIES } from './traversalBoundaryFixtures';
test('traversal and document factories are complete reusable Component programs', () => {
	const features = WEB_FEATURES.filter((f) => traversalRecipe(f));
	assert.equal(features.length, 41);
	for (const f of features) {
		const program = traversalRecipe(f)!.program;
		assert.equal(featureCoverage(f), 'interactive');
		const component = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		assert.deepEqual(component.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, program);
		for (const p of [program, editTraversalProgram(program)]) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(p)), f.name);
	}
	for (const f of TRAVERSAL_BOUNDARIES) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(f.program)), f.name);
});
