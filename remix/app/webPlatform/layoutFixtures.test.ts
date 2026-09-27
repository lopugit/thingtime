import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES, componentForFeature, featureCoverage } from './catalogue';
import { compilePlatformWorker } from './workerSource';
import { layoutRecipe } from './layoutFixtures';
import { editLayoutProgram } from './layoutTestCases';
import { layoutArgument, layoutScrollResult } from './layoutSupport';
import { LAYOUT_BOUNDARIES } from './layoutBoundaryFixtures';
import { bindLiveDOMEvent, validateLiveDOMBinding } from './liveDOM';
test('CSSOM View and remaining Geometry programs survive Component serialization and edits', () => {
	const features = WEB_FEATURES.filter((f) => layoutRecipe(f));
	assert.equal(features.length, 149);
	for (const f of features) {
		const p = layoutRecipe(f)!.program;
		assert.equal(featureCoverage(f), 'interactive');
		const c = JSON.parse(JSON.stringify(componentForFeature(f.id)));
		assert.deepEqual(c.render.children.find((n: any) => n.tag === 'tt-web-platform').props.program, p);
		assert.doesNotThrow(() => compilePlatformWorker(p));
		const edited = editLayoutProgram(p);
		assert.notDeepEqual(edited.parameters, p.parameters);
		assert.doesNotThrow(() => compilePlatformWorker(edited));
	}
	for (const f of LAYOUT_BOUNDARIES) assert.doesNotThrow(() => compilePlatformWorker(f.program));
});
test('Layout options enforce bounded numbers, closed dictionaries and owned nodes', () => {
	const receiver = () => {
		throw new Error('foreign receiver');
	};
	for (const value of [null, [], { top: Infinity }, { left: 40000 }, { behavior: 'unregistered' }, { extra: true }, { top: '20' }])
		assert.throws(() => layoutArgument(value, 'layout-scroll', receiver));
	assert.deepEqual(layoutArgument({ top: 20.5, behavior: 'smooth' }, 'layout-scroll', receiver), { top: 20.5, behavior: 'smooth' });
	assert.throws(() => layoutArgument({ relativeTo: {} }, 'layout-box', receiver), /foreign/);
	assert.throws(() => layoutArgument({ shadowRoots: Array(9).fill({}) }, 'layout-caret', receiver), /budget/);
	assert.throws(() => layoutArgument({ p1: { x: '1' } }, 'layout-quad', receiver));
	assert.equal(layoutScrollResult(undefined), undefined);
	assert.deepEqual(layoutScrollResult({ interrupted: true }), { interrupted: true });
	for (const value of [
		{ interrupted: 'false' },
		{ secret: true },
		{
			get interrupted() {
				throw new Error('must not read getter');
			}
		}
	])
		assert.throws(() => layoutScrollResult(value), /Unregistered/);
});
test('Legacy media listeners remove the exact callback and remain inert after cleanup', () => {
	class Query extends EventTarget {
		calls: string[] = [];
		addListener(fn: EventListener) {
			this.calls.push('add');
			this.addEventListener('change', fn);
		}
		removeListener(fn: EventListener) {
			this.calls.push('remove');
			this.removeEventListener('change', fn);
		}
	}
	const q = new Query();
	let called = 0;
	const binding = { target: '$media:screen', event: '$media:screen|change', binding: 'legacy' as const, removeOn: '#remove|click' };
	validateLiveDOMBinding(binding);
	const stop = bindLiveDOMEvent(q, 'change', binding, {}, () => called++);
	q.dispatchEvent(new Event('change'));
	stop();
	q.dispatchEvent(new Event('change'));
	assert.equal(called, 1);
	assert.deepEqual(q.calls, ['add', 'remove']);
	for (const invalid of [
		{ ...binding, event: '#sample|change' },
		{ ...binding, removeOn: '$visualViewport|resize' },
		{ ...binding, options: { once: true } }
	])
		assert.throws(() => validateLiveDOMBinding(invalid));
});
