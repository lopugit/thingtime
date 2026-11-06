import { CANVAS_BOUNDARY_FIXTURES } from './canvasBoundaryFixtures';
import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES, featureCoverage, componentForFeature } from './catalogue';
import { canvasRecipe } from './canvasFixtures';
import { canvasArgument, canvasContextAttributes } from './canvasSupport';
import { compilePlatformWorker } from './workerSource';
const noHandle = () => {
	throw new Error('Not a run-owned handle');
};
test('Canvas catalogue programs compile and remain complete editable Components', () => {
	const examples = WEB_FEATURES.filter((f) => canvasRecipe(f));
	assert.ok(examples.length > 120);
	for (const f of examples) {
		const r = canvasRecipe(f)!;
		assert.equal(featureCoverage(f), 'interactive', f.name);
		assert.doesNotThrow(() => compilePlatformWorker(r.program), f.name);
		const saved = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		const program = saved.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program;
		assert.deepEqual(program, r.program);
		program.parameters.find((p: any) => p.name === 'color').default = '#ff0000';
		assert.doesNotThrow(() => compilePlatformWorker(program), f.name);
	}
	for (const name of [
		'HTMLCanvasElement.constructor',
		'HTMLCanvasElement.captureStream',
		'HTMLCanvasElement.transferControlToOffscreen',
		'CanvasUserInterface.drawFocusIfNeeded'
	])
		assert.equal(canvasRecipe(WEB_FEATURES.find((f) => f.name === name)!), null, name);
});
test('Canvas arguments bound native allocation and refuse coercion or foreign receiver objects', () => {
	for (const value of [-1, 513, '512', true, NaN, Infinity]) assert.throws(() => canvasArgument(value, 'canvas-size', noHandle));
	assert.equal(canvasArgument(0, 'canvas-size', noHandle), 0);
	assert.equal(canvasArgument(512, 'canvas-size', noHandle), 512);
	assert.equal(canvasArgument(-32, 'pixel-size', noHandle), -32);
	assert.throws(() => canvasArgument(33, 'pixel-size', noHandle));
	for (const rule of ['canvas-source', 'canvas-path', 'canvas-style', 'canvas-image-data']) assert.throws(() => canvasArgument({}, rule, noHandle));
	for (const value of [{ alpha: 'false' }, { arbitrary: 1 }, []]) assert.throws(() => canvasArgument(value, 'canvas-settings', noHandle));
	assert.deepEqual(canvasArgument({ alpha: false, willReadFrequently: true }, 'canvas-settings', noHandle), {
		alpha: false,
		willReadFrequently: true
	});
	assert.deepEqual(canvasArgument({ a: 0, d: 1, e: -20 }, 'canvas-matrix', noHandle), { a: 0, d: 1, e: -20 });
	assert.throws(() => canvasArgument({ a: '1' }, 'canvas-matrix', noHandle));
	assert.throws(() => canvasArgument(Array(33).fill(1), 'canvas-dash', noHandle));
	assert.throws(() => canvasArgument(Array(5).fill(1), 'canvas-radii', noHandle));
});
test('Canvas filters and fonts cannot introduce URLs or excessive blur and text rasterization', () => {
	for (const value of ['url(https://example.com/filter)', 'blur(100px)', 'blur(32px) '.repeat(5)])
		assert.throws(() => canvasArgument(value, 'canvas-filter', noHandle));
	assert.equal(canvasArgument('blur(2px) contrast(120%)', 'canvas-filter', noHandle), 'blur(2px) contrast(120%)');
	for (const value of ['100000px serif', 'calc(100000 * 24px) serif', '1e10px serif', '100vh serif', '999em serif', '8em serif', '80% serif'])
		assert.throws(() => canvasArgument(value, 'canvas-font', noHandle));
	assert.equal(canvasArgument('bold 24px sans-serif', 'canvas-font', noHandle), 'bold 24px sans-serif');
});

test('native context settings project known fields without widening author inputs', () => {
	assert.deepEqual(canvasContextAttributes({ alpha: false, colorSpace: 'srgb', implementationDetail: { opaque: true } }), {
		alpha: false,
		colorSpace: 'srgb'
	});
	assert.throws(() => canvasArgument({ implementationDetail: true }, 'canvas-settings', noHandle));
});

test('native Canvas boundary programs remain ordinary compilable program data', () => {
	for (const f of CANVAS_BOUNDARY_FIXTURES) assert.doesNotThrow(() => compilePlatformWorker(f.program), f.name);
});
