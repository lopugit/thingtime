import { ANIMATION_BOUNDARIES } from './animationBoundaryFixtures';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { animationRecipe } from './animationFixtures';
import { editAnimationProgram } from './animationTestCases';
import { animationKeyframes, animationArgument, animationRecord } from './animationSupport';
import { compilePlatformWorker } from './workerSource';
test('animation definitions preserve authored keyframes, timing and native programs as saved Components', () => {
	const features = WEB_FEATURES.filter((f) => animationRecipe(f));
	assert.equal(features.length, 111);
	for (const fixture of ANIMATION_BOUNDARIES) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(fixture.program)), fixture.name);
	for (const f of features) {
		const program = animationRecipe(f)!.program;
		assert.equal(featureCoverage(f), 'interactive');
		const component = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		assert.deepEqual(component.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, program);
		const edited = editAnimationProgram(program);
		assert.notDeepEqual(program.parameters, edited.parameters);
		for (const p of [program, edited]) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(p)), f.name);
	}
});
test('native keyframe conversion bounds both array and property-indexed forms before parsing', () => {
	assert.deepEqual(animationKeyframes({ opacity: [0, 1], offset: [0, 1] }), { opacity: [0, 1], offset: [0, 1] });
	assert.deepEqual(animationKeyframes([{ opacity: 0 }, { opacity: 1 }]), [{ opacity: 0 }, { opacity: 1 }]);
	assert.equal(animationKeyframes(null), null);
	assert.throws(() => animationKeyframes(Array.from({ length: 65 }, () => ({ opacity: 1 }))), /count/);
	assert.throws(() => animationKeyframes({ opacity: Array(65).fill(1) }), /count/);
	assert.throws(() => animationKeyframes([{ offset: 2 }]), /bounded animation number/);
	assert.throws(() => animationKeyframes([{ opacity: { value: 1 } }]), /text/);
	assert.throws(() => animationKeyframes(JSON.parse('{"__proto__":{"opacity":1}}')), /property/);
	assert.throws(() => animationKeyframes(Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['--v' + i, Array(64).fill(0)]))), /value budget/);
});
test('animation option dictionaries reject hidden authority and unbounded values', () => {
	const noHandle = () => {
		throw new Error('foreign receiver');
	};
	assert.throws(() => animationArgument({ timeline: {} }, 'animation-options', noHandle), /foreign receiver/);
	assert.throws(() => animationArgument({ duration: Infinity }, 'animation-timing', noHandle), /bounded/);
	assert.throws(() => animationArgument({ duration: -1 }, 'animation-effect-options', noHandle), /bounded/);
	assert.throws(() => animationArgument({ duration: 100, trigger: {} }, 'animation-options', noHandle), /dictionary/);
	assert.throws(() => animationArgument({ subtree: 'yes' }, 'animation-query', noHandle), /boolean/);
	assert.deepEqual(animationArgument({ duration: 'auto', delay: -20 }, 'animation-timing', noHandle), { duration: 'auto', delay: -20 });
	assert.deepEqual(animationRecord({ progress: 0.5, currentIteration: 1 }), { progress: 0.5, currentIteration: 1 });
	assert.throws(() => animationRecord({ nested: new Date() }), /native animation record/);
});
