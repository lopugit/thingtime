import { CSSOM_BOUNDARIES } from './cssomBoundaryFixtures';
import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { cssomRecipe } from './cssomFixtures';
import { editCSSOMProgram } from './cssomTestCases';
import { compilePlatformWorker } from './workerSource';
import { cssomArgument, cssomText } from './cssomSupport';
const noHandle = () => {
	throw new Error('Foreign receiver');
};
test('CSSOM catalogue programs retain all authored operations and edited defaults', () => {
	const features = WEB_FEATURES.filter((f) => f.spec === 'https://drafts.csswg.org/cssom-1/');
	assert.equal(features.length, 102);
	for (const f of features) {
		const r = cssomRecipe(f)!;
		assert.equal(featureCoverage(f), 'interactive');
		assert.doesNotThrow(() => compilePlatformWorker(r.program), f.name);
		const c = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		const p = c.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program;
		assert.deepEqual(p, r.program);
		const e = editCSSOMProgram(p);
		assert.notDeepEqual(e.parameters, p.parameters, f.name);
		assert.doesNotThrow(() => compilePlatformWorker(e));
	}
});
test('CSSOM native parser inputs bound text, nesting, allocations and options without coercion', () => {
	for (const v of [null, {}, 12, 'x'.repeat(4097), '{'.repeat(9), '.a{}'.repeat(33)]) assert.throws(() => cssomText(v));
	assert.equal(cssomText('@media screen {.a{color:red}}'), '@media screen {.a{color:red}}');
	for (const v of [null, [], { disabled: 'false' }, { media: [] }, { extra: true }]) assert.throws(() => cssomArgument(v, 'cssom-options', noHandle));
	assert.deepEqual(cssomArgument({ disabled: false, baseURL: null, media: 'screen' }, 'cssom-options', noHandle), {
		disabled: false,
		baseURL: null,
		media: 'screen'
	});
	for (const v of [[], { mode: 'closed' }, { mode: 'open', delegatesFocus: true }]) assert.throws(() => cssomArgument(v, 'cssom-shadow', noHandle));
	for (const v of [Array(9).fill(null), {}, [{ $dom: 'foreign' }]]) assert.throws(() => cssomArgument(v, 'cssom-sheets', noHandle));
	assert.throws(() => cssomArgument('@import "remote";', 'cssom-rule', noHandle));
	assert.throws(() => cssomArgument('::part(private)', 'cssom-pseudo', noHandle));
});

test('CSSOM browser boundary fixtures remain complete compiled programs', () => {
	for (const f of CSSOM_BOUNDARIES) assert.doesNotThrow(() => compilePlatformWorker(f.program), f.name);
});
