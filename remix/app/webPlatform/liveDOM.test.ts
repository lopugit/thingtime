import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeDOMMethod, platformEventReceipt, validateLiveDOMBinding } from './liveDOM';
import { compilePlatformWorker } from './workerSource';
import { validatePlatformProgram } from './compiler';
import { WEB_FEATURES } from './catalogue';
import { liveFormRecipe } from './liveFormFixtures';

test('live bindings invoke the most-specific prototype method without reading named instance properties', () => {
	class Parent { checkValidity() { return 'parent'; } }
	class Form extends Parent { checkValidity() { return this === form ? 'native override' : 'wrong receiver'; } }
	const form = new Form();
	Object.defineProperty(form, 'checkValidity', { get() { throw new Error('Named control getter must not be read'); } });
	assert.equal(nativeDOMMethod(form, 'checkValidity')(), 'native override');
	assert.throws(() => nativeDOMMethod(form, 'constructor'), /not registered/);
	assert.throws(() => nativeDOMMethod(form, 'reset'), /does not implement/);
});

test('event-only bindings require a supported event and reject executable or unbounded grammar', () => {
	assert.doesNotThrow(() => validateLiveDOMBinding({ target: '#form', event: '#form|submit' }));
	for (const value of [null, { target: '#form' }, { target: '#form', method: 'submit' },
		{ target: '#form', event: '#form|submit', args: [] }, { target: '#form', event: '#form|unknown' },
		{ target: '#form', event: '#form|submit|click' }, { target: 'x'.repeat(501), method: 'click' }])
		assert.throws(() => validateLiveDOMBinding(value));
	assert.throws(() => validateLiveDOMBinding({ target: '#form', method: 'requestSubmit', args: [{ op: 'element', selector: '', extra: true }] }));
	assert.throws(() => validatePlatformProgram({ version: 1, title: 'Invalid context', allowFormEvents: 'yes' }));
});

test('event receipts preserve cancellation and exclude arbitrary Event fields', () => {
	const event = new Event('submit', { bubbles: true, cancelable: true });
	(event as Event & { arbitrary: unknown }).arbitrary = { secret: 'not part of the projection' };
	event.preventDefault();
	assert.deepEqual(platformEventReceipt(event), { type: 'submit', bubbles: true, cancelable: true,
		defaultPrevented: true, isTrusted: false, target: null, currentTarget: null });
});

test('event node receipts use native getters, bound text, and do not traverse named controls', () => {
	class Target extends EventTarget {
		get nodeType() { return 1; }
		get localName() { return 'form'; }
		get id() { return 'actual-form'; }
		get name() { return 'x'.repeat(2000); }
	}
	const target = new Target();
	Object.defineProperty(target, 'id', { get() { throw new Error('Named control must not be read'); } });
	let result: ReturnType<typeof platformEventReceipt> | undefined;
	target.addEventListener('reset', event => { result = platformEventReceipt(event); });
	target.dispatchEvent(new Event('reset'));
	assert.equal(result?.target?.id, 'actual-form');
	assert.equal(result?.target?.name?.length, 256);
	assert.deepEqual(result?.currentTarget, result?.target);
});

test('live form recipes compile and retain their event bindings in reusable program data', () => {
	const examples = WEB_FEATURES.flatMap(f => { const r = liveFormRecipe(f); return r ? [r.program] : []; });
	assert.equal(examples.length, 9);
	for (const program of examples) assert.doesNotThrow(() => compilePlatformWorker(program), program.title);
	const request = examples.find(p => p.title === 'HTMLFormElement.requestSubmit')!;
	assert.ok(request.dom?.some(op => op.event === '#sample|submit' && !op.method));
	assert.deepEqual(request.dom?.find(op => op.method === 'requestSubmit')?.args, [{ op: 'element', selector: '#send' }]);
});
