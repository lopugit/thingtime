import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { compilePlatformWorker } from './workerSource';
import { rangeRecipe } from './rangeFixtures';
import { editRangeProgram } from './rangeTestCases';
import { RANGE_BOUNDARIES } from './rangeBoundaryFixtures';
import { rangeHTML, rangeInit } from './rangeSupport';
test('range recipes and edited Components carry serializable executable programs', () => {
	const features = WEB_FEATURES.filter((f) => rangeRecipe(f));
	assert.equal(features.length, 40);
	for (const f of features) {
		const program = rangeRecipe(f)!.program;
		assert.equal(featureCoverage(f), 'interactive');
		const component = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		assert.deepEqual(component.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, program);
		for (const version of [program, editRangeProgram(program)]) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(version)), f.name);
	}
	for (const fixture of RANGE_BOUNDARIES) assert.doesNotThrow(() => new vm.Script(compilePlatformWorker(fixture.program)), fixture.name);
});
test('contextual HTML validates the entire input before native parsing', () => {
	for (const html of ['<p>Safe <strong>text</strong></p>', '&lt;script&gt;', '<TABLE><tr><td>A</td></tr></TABLE>'])
		assert.equal(rangeHTML(html), html);
	for (const html of [
		'<p title=x>a</p>',
		'<script>',
		'<!--a-->',
		'<svg>',
		'<p',
		'x<',
		'<noscript>',
		'<style>',
		'<custom-element>',
		'<img src=x>',
		'<b></b>'.repeat(65),
		'x'.repeat(4097)
	])
		assert.throws(() => rangeHTML(html));
	assert.throws(() => rangeInit({ startContainer: 1, startOffset: 0, endContainer: 2 }, Object, Number));
});
