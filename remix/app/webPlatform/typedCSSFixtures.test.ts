import { editTypedCSSProgram } from './typedCSSTestCases';
import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { typedCSSRecipe } from './typedCSSFixtures';
import { compilePlatformWorker } from './workerSource';
import { typedCSSArgument, typedCSSNumericType } from './typedCSSSupport';
import { TYPED_CSS_BOUNDARIES } from './typedCSSBoundaryFixtures';
const noHandle = () => {
	throw new Error('foreign handle');
};
test('all Typed OM entries have serializable editable native programs', () => {
	const fs = WEB_FEATURES.filter((f) => f.group === 'CSS Typed OM Level 1');
	assert.equal(fs.length, 249);
	for (const f of fs) {
		const r = typedCSSRecipe(f)!;
		assert.ok(r, f.name);
		assert.equal(featureCoverage(f), 'interactive');
		assert.doesNotThrow(() => compilePlatformWorker(r.program), f.name);
		const component = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		const p = component.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program;
		assert.deepEqual(p, r.program);
		assert.ok(p.parameters.length > 0);
		const edited = editTypedCSSProgram(p);
		assert.notDeepEqual(edited.parameters, p.parameters, f.name);
		assert.doesNotThrow(() => compilePlatformWorker(edited));
	}
});
test('CSS arguments refuse coercion, unbounded allocation and foreign handles', () => {
	for (const value of [Infinity, NaN, '24', {}, true, 32769]) assert.throws(() => typedCSSArgument(value, 'css-number', noHandle));
	for (const rule of ['css-numeric', 'css-style-value', 'css-keyword', 'css-perspective', 'css-unparsed'])
		assert.throws(() => typedCSSArgument({}, rule, noHandle));
	assert.equal(typedCSSArgument(12, 'css-number', noHandle), 12);
	assert.deepEqual(typedCSSArgument([1, 0, 0, 1, 12, 4], 'css-matrix', noHandle), [1, 0, 0, 1, 12, 4]);
	for (const value of [Array(33).fill(1), {}, '[]']) assert.throws(() => typedCSSArgument(value, 'css-numeric-list', noHandle));
	for (const value of [{ is2D: 'true' }, { is2D: true, extra: 1 }, []]) assert.throws(() => typedCSSArgument(value, 'css-matrix-options', noHandle));
	for (const value of ['@import "remote";', '@font-face {font-family:demo}', '.a {width:1px}.b{width:2px}', '.a {\\77idth:1px}'])
		assert.throws(() => typedCSSArgument(value, 'css-rule', noHandle));
	assert.equal(typedCSSArgument('.demo {width:20px}', 'css-rule', noHandle), '.demo {width:20px}');
});
test('native numeric dictionaries expose only the specified dimensional fields', () => {
	assert.deepEqual(typedCSSNumericType({ length: 1, percentHint: 'length', privateObject: { token: 'no' } }), { length: 1, percentHint: 'length' });
	assert.throws(() => typedCSSNumericType({ length: '1' }));
});
test('native CSS boundary programs compile', () => {
	for (const f of TYPED_CSS_BOUNDARIES) assert.doesNotThrow(() => compilePlatformWorker(f.program), f.name);
});
