import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES } from './catalogue';
import { compilePlatformWorker } from './workerSource';
import { htmlFormRecipe } from './htmlFormFixtures';
import { HTML_FORM_BOUNDARY_FIXTURES } from './htmlFormBoundaryFixtures';

test('form recipes and browser boundary cases compile as reusable program data', () => {
	const examples = WEB_FEATURES.flatMap((feature) => {
		const value = htmlFormRecipe(feature);
		return value ? [{ name: feature.name, program: value.program }] : [];
	});
	assert.equal(examples.length, 212);
	for (const example of [...examples, ...HTML_FORM_BOUNDARY_FIXTURES])
		assert.doesNotThrow(() => compilePlatformWorker(example.program), example.name);
	for (const feature of WEB_FEATURES.filter(
		(f) =>
			f.kind === 'constructor' ||
			f.name === 'HTMLFormElement.reset' ||
			(f.interface === 'ValidityState' && ['badInput', 'patternMismatch', 'tooLong', 'tooShort'].includes(f.member || ''))
	)) {
		assert.equal(htmlFormRecipe(feature), undefined, `${feature.name} still needs a dedicated context`);
	}
});
