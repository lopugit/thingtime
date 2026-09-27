import { SVG_BOUNDARY_FIXTURES } from './svgBoundaryFixtures';
import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES, featureCoverage, componentForFeature } from './catalogue';
import { svgRecipe } from './svgFixtures';
import { svgTag, svgAttribute, svgArgument } from './svgSupport';
import { compilePlatformWorker } from './workerSource';
test('SVG recipes compile and preserve complete edited program data', () => {
	const examples = WEB_FEATURES.filter((f) => svgRecipe(f));
	assert.ok(examples.length > 200, examples.length.toString());
	for (const f of examples) {
		const r = svgRecipe(f)!;
		assert.equal(featureCoverage(f), 'interactive', f.name);
		assert.doesNotThrow(() => compilePlatformWorker(r.program), f.name);
		const saved = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		const program = saved.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program;
		assert.deepEqual(program, r.program);
		program.parameters.find((p: any) => p.name === 'color').default = '#ff0000';
		assert.doesNotThrow(() => compilePlatformWorker(program), f.name);
	}
	for (const name of ['SVGScriptElement', 'SVGForeignObjectElement', 'SVGUseElement', 'SVGAnimationElement', 'SVGFEGaussianBlurElement'])
		assert.equal(svgRecipe(WEB_FEATURES.find((f) => f.name === name)!), null, name);
});
test('SVG namespace and paint policy refuses active resources and unbounded inputs', () => {
	for (const tag of ['script', 'foreignObject', 'iframe', 'use', 'animate']) assert.throws(() => svgTag(tag));
	assert.equal(svgTag('linearGradient'), 'linearGradient');
	for (const [tag, key, value] of [
		['svg', 'width', '513'],
		['svg', 'height', '100%'],
		['path', 'd', 'x'.repeat(4097)],
		['rect', 'fill', 'url(https://example.com/paint)'],
		['linearGradient', 'href', 'https://example.com/paint'],
		['rect', 'onclick', 'alert(1)'],
		['polygon', 'points', '1,1' + '-2,-2'.repeat(32)],
		['switch', 'systemLanguage', Array(33).fill('en').join('\n')],
		['text', 'rotate', '0' + '-1'.repeat(32)]
	])
		assert.throws(() => svgAttribute(tag, key, value));
	assert.equal(svgAttribute('rect', 'fill', 'url(#paint)'), 'url(#paint)');
	assert.equal(svgAttribute('svg', 'width', '256'), '256');
	const handle = () => {
		throw new Error('Foreign handle');
	};
	for (const v of ['12px', NaN, Infinity, 4097]) assert.throws(() => svgArgument(v, 'svg-number', handle));
	assert.throws(() => svgArgument({}, 'svg-length', handle));
	assert.throws(() => svgArgument({ stroke: 'false' }, 'svg-box-options', handle));
	assert.throws(() => svgArgument('100000px', 'svg-unit', handle));
	assert.deepEqual(svgArgument({ x: 5, y: 8 }, 'svg-point', handle), { x: 5, y: 8 });
});

test('SVG native browser fixtures remain valid complete program data', () => {
	for (const f of SVG_BOUNDARY_FIXTURES) assert.doesNotThrow(() => compilePlatformWorker(f.program), f.name);
});
