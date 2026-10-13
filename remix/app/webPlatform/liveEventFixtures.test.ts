import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES } from './catalogue';
import { compilePlatformWorker } from './workerSource';
import { liveEventRecipe } from './liveEventFixtures';
import { validatePlatformProgram } from './compiler';

test('107 active-document event examples compile to editable bindings without inline source', () => {
	const examples = WEB_FEATURES.flatMap((f) => {
		const r = liveEventRecipe(f);
		return r ? [{ f, program: r.program }] : [];
	});
	assert.equal(examples.length, 107);
	assert.equal(examples.filter((e) => e.f.language === 'html').length, 52);
	for (const { program } of examples) {
		assert.doesNotThrow(() => compilePlatformWorker(program), program.title);
		const main = program.dom!.find((binding) => binding.label === 'Selected handler')!;
		assert.deepEqual(main.preventDefault, { op: 'input', name: 'preventDefault' });
		const edited = structuredClone(program);
		edited.parameters!.find((p) => p.name === 'preventDefault')!.default = true;
		edited.dom!.find((binding) => binding.label === 'Selected handler')!.stopImmediatePropagation = true;
		assert.deepEqual(validatePlatformProgram(JSON.parse(JSON.stringify(edited))), edited);
		assert.ok(!JSON.stringify(program.document).match(/"on[a-z]+":/));
	}
});

test('IDL handlers retain native property mode; window and media lifecycles are not claimed', () => {
	const feature = WEB_FEATURES.find((f) => f.language === 'html' && f.name === 'onclick')!;
	const program = liveEventRecipe(feature)!.program;
	const main = program.dom!.find((binding) => binding.label === 'Selected handler')!;
	assert.equal(main.binding, 'handler');
	assert.equal(main.options, undefined);
	assert.deepEqual(main.returnFalse, { op: 'input', name: 'returnFalse' });
	for (const name of ['onbeforeunload', 'onstorage', 'oncanplay']) assert.equal(liveEventRecipe({ ...feature, name }), undefined);
});
