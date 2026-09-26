import assert from 'node:assert/strict';
import test from 'node:test';
import { bindLiveDOMEvent, nativeDOMMethod, platformEventReceipt, resolveDOMBoolean, validateLiveDOMBinding } from './liveDOM';
import { compilePlatformWorker } from './workerSource';
import { validatePlatformProgram } from './compiler';
import { WEB_FEATURES } from './catalogue';
import { liveFormRecipe } from './liveFormFixtures';

test('live bindings invoke the most-specific prototype method without reading named instance properties', () => {
	class Parent {
		checkValidity() {
			return 'parent';
		}
	}
	class Form extends Parent {
		checkValidity() {
			return this === form ? 'native override' : 'wrong receiver';
		}
	}
	const form = new Form();
	Object.defineProperty(form, 'checkValidity', {
		get() {
			throw new Error('Named control getter must not be read');
		}
	});
	assert.equal(nativeDOMMethod(form, 'checkValidity')(), 'native override');
	assert.throws(() => nativeDOMMethod(form, 'constructor'), /not registered/);
	assert.throws(() => nativeDOMMethod(form, 'reset'), /does not implement/);
});

test('event-only bindings require a supported event and reject executable or unbounded grammar', () => {
	assert.doesNotThrow(() => validateLiveDOMBinding({ target: '#form', event: '#form|submit' }));
	for (const value of [
		null,
		{ target: '#form' },
		{ target: '#form', method: 'submit' },
		{ target: '#form', event: '#form|submit', args: [] },
		{ target: '#form', event: '#form|unknown' },
		{ target: '#form', event: '#form|submit|click' },
		{ target: 'x'.repeat(501), method: 'click' }
	])
		assert.throws(() => validateLiveDOMBinding(value));
	assert.throws(() => validateLiveDOMBinding({ target: '#form', method: 'requestSubmit', args: [{ op: 'element', selector: '', extra: true }] }));
	assert.throws(() => validatePlatformProgram({ version: 1, title: 'Invalid context', allowFormEvents: 'yes' }));
});

test('event receipts preserve cancellation and exclude arbitrary Event fields', () => {
	const event = new Event('submit', { bubbles: true, cancelable: true });
	(event as Event & { arbitrary: unknown }).arbitrary = { secret: 'not part of the projection' };
	event.preventDefault();
	assert.deepEqual(platformEventReceipt(event), {
		type: 'submit',
		bubbles: true,
		cancelable: true,
		defaultPrevented: true,
		isTrusted: false,
		composed: false,
		eventPhase: 0,
		target: null,
		currentTarget: null
	});
});

test('event node receipts use native getters, bound text, and do not traverse named controls', () => {
	class Target extends EventTarget {
		get nodeType() {
			return 1;
		}
		get localName() {
			return 'form';
		}
		get id() {
			return 'actual-form';
		}
		get name() {
			return 'x'.repeat(2000);
		}
	}
	const target = new Target();
	Object.defineProperty(target, 'id', {
		get() {
			throw new Error('Named control must not be read');
		}
	});
	let result: ReturnType<typeof platformEventReceipt> | undefined;
	target.addEventListener('reset', (event) => {
		result = platformEventReceipt(event);
	});
	target.dispatchEvent(new Event('reset'));
	assert.equal(result?.target?.id, 'actual-form');
	assert.equal(result?.target?.name?.length, 256);
	assert.deepEqual(result?.currentTarget, result?.target);
});

test('live form recipes compile and retain their event bindings in reusable program data', () => {
	const examples = WEB_FEATURES.flatMap((f) => {
		const r = liveFormRecipe(f);
		return r ? [r.program] : [];
	});
	assert.equal(examples.length, 9);
	for (const program of examples) assert.doesNotThrow(() => compilePlatformWorker(program), program.title);
	const request = examples.find((p) => p.title === 'HTMLFormElement.requestSubmit')!;
	assert.ok(request.dom?.some((op) => op.event === '#sample|submit' && !op.method));
	assert.deepEqual(request.dom?.find((op) => op.method === 'requestSubmit')?.args, [{ op: 'element', selector: '#send' }]);
});

test('saved event flags accept only explicit booleans and own boolean inputs', () => {
	const operation = { target: '#sample', event: '#sample|click' };
	assert.doesNotThrow(() =>
		validateLiveDOMBinding({ ...operation, options: { capture: { op: 'input', name: 'capture' }, once: true, passive: false }, preventDefault: true })
	);
	assert.doesNotThrow(() => validateLiveDOMBinding({ ...operation, binding: 'handler', returnFalse: { op: 'input', name: 'cancel' } }));
	for (const extra of [
		{ options: { signal: true } },
		{ options: { once: 'false' } },
		{ returnFalse: true },
		{ binding: 'handler', options: {} },
		{ preventDefault: { op: 'input', name: 'x', source: 'code' } },
		{ stopPropagation: 1 },
		{ source: 'alert(1)' }
	])
		assert.throws(() => validateLiveDOMBinding({ ...operation, ...extra }));
	assert.throws(() => validateLiveDOMBinding({ target: '#sample', method: 'click', preventDefault: true }));
	assert.equal(resolveDOMBoolean({ op: 'input', name: 'cancel' }, { cancel: false }), false);
	for (const input of [{ cancel: 'false' }, {}, Object.create({ cancel: true })])
		assert.throws(() => resolveDOMBoolean({ op: 'input', name: 'cancel' }, input));
});

test('native listener options, cancellation and cleanup retain EventTarget behavior', () => {
	const target = new EventTarget();
	const trace: string[] = [];
	const unbind = bindLiveDOMEvent(
		target,
		'click',
		{ target: '#sample', options: { once: true }, preventDefault: true, stopImmediatePropagation: true },
		{},
		() => trace.push('selected')
	);
	target.addEventListener('click', () => trace.push('later'));
	assert.equal(target.dispatchEvent(new Event('click', { cancelable: true })), false);
	assert.deepEqual(trace, ['selected']);
	assert.equal(target.dispatchEvent(new Event('click', { cancelable: true })), true);
	assert.deepEqual(trace, ['selected', 'later']);
	unbind();
	const stop = bindLiveDOMEvent(target, 'input', { target: '#sample' }, {}, () => trace.push('input'));
	stop();
	target.dispatchEvent(new Event('input'));
	assert.deepEqual(trace, ['selected', 'later']);
});

test('IDL cleanup cannot clear a later replacement, and missing native handlers are unsupported', () => {
	class Target extends EventTarget {
		private handler: ((event: Event) => unknown) | null = null;
		get onclick() {
			return this.handler;
		}
		set onclick(value) {
			this.handler = value;
		}
	}
	const target = new Target();
	const trace: number[] = [];
	const first = bindLiveDOMEvent(target, 'click', { target: '#sample', binding: 'handler' }, {}, () => trace.push(1));
	const second = bindLiveDOMEvent(target, 'click', { target: '#sample', binding: 'handler', returnFalse: true }, {}, () => trace.push(2));
	first();
	assert.equal(target.onclick?.(new Event('click')), false);
	assert.deepEqual(trace, [2]);
	second();
	assert.equal(target.onclick, null);
	assert.throws(
		() => bindLiveDOMEvent(target, 'command', { target: '#sample', binding: 'handler' }, {}, () => {}),
		/does not implement the oncommand handler/
	);
});

test('native event detail projection is bounded and ignores shadowed instance fields', () => {
	class Input extends Event {
		get data() {
			return 'x'.repeat(300);
		}
		get inputType() {
			return 'insertText';
		}
		get clientX() {
			return Infinity;
		}
	}
	const event = new Input('input');
	Object.defineProperty(event, 'data', {
		get() {
			throw Error('No own getter');
		}
	});
	const receipt: Record<string, unknown> = platformEventReceipt(event);
	assert.equal(String(receipt.data).length, 256);
	assert.equal(receipt.inputType, 'insertText');
	assert.equal(receipt.clientX, undefined);
});
