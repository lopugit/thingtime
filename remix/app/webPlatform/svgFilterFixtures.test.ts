import { SVG_FILTER_BOUNDARY_FIXTURES } from './svgFilterBoundaryFixtures';
import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { svgFilterRecipe } from './svgFilterFixtures';
import { svgAttribute, svgArgument } from './svgSupport';
import { svgFilterNumbers } from './svgFilterSupport';
import { compilePlatformWorker } from './workerSource';

test('Filter recipes compile as editable reusable component programs', () => {
	const examples = WEB_FEATURES.filter((f) => svgFilterRecipe(f));
	assert.equal(examples.length, 192);
	for (const f of examples) {
		const program = svgFilterRecipe(f)!.program;
		assert.doesNotThrow(() => compilePlatformWorker(program), f.name);
		assert.equal(featureCoverage(f), 'interactive', f.name);
		const saved = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		assert.deepEqual(saved.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, program);
	}
});
test('Filter work and local image budgets reject oversized or active input', () => {
	for (const [key, value] of [
		['numOctaves', -1],
		['numOctaves', 5],
		['order', 6],
		['order', 1.5],
		['targetX', 1.2],
		['stdDeviationX', 17],
		['radiusY', 9],
		['kernelMatrix', '1 '.repeat(33)]
	])
		assert.throws(() => svgFilterNumbers(String(key), value));
	for (const [tag, key, value] of [
		['feImage', 'href', 'https://example.com/a.png'],
		['feImage', 'href', 'data:image/svg+xml,<svg/>'],
		['feImage', 'href', 'data:image/png;base64,aGVsbG8='],
		['filter', 'width', '513'],
		['filter', 'filterUnits', 'objectBoundingBox'],
		['rect', 'filter', 'blur(99999px)'],
		['feBlend', 'in', 'url(#bad)']
	])
		assert.throws(() => svgAttribute(tag, key, value));
	assert.equal(svgAttribute('feGaussianBlur', 'stdDeviation', '3 4'), '3 4');
	assert.deepEqual(svgFilterNumbers('pointsAtX', 100), [100]);
	assert.throws(() => svgArgument('bad', 'svg-filter-image', () => ({})));
});

test('Filter boundary programs compile', () => {
	for (const f of SVG_FILTER_BOUNDARY_FIXTURES) assert.doesNotThrow(() => compilePlatformWorker(f.program), f.name);
});
