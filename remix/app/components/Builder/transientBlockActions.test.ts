import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransientLifetime, transientControlForTarget, isTransientBlockTarget, parseTransientBinding, transientFieldValue, transientNamedField } from './transientBlockActions';

test('bindings contain only operation names and scalar arguments, not executable or nested payloads', () => {
	const binding = parseTransientBinding('{"operation":"plan.select-model","id":"account-1","selected":true}');
	assert.equal(binding?.operation, 'plan.select-model');
	assert.deepEqual({ ...binding?.inputs }, { id: 'account-1', selected: true });
	assert.equal(Object.isFrozen(binding?.inputs), true);
	assert.equal(Object.getPrototypeOf(binding?.inputs), null);
	for (const invalid of ['null', '[]', '{}', '{"operation":"__proto__"}', '{"operation":"plan.begin","__proto__":"bad"}',
		'{"operation":"plan.begin","constructor":"bad"}', '{"operation":"plan.begin","nested":{"token":"never"}}'])
		assert.equal(parseTransientBinding(invalid), null);
});

test('closing the scope revokes pending operation signals and field-reader authority', () => {
	const previous = createTransientLifetime();
	let cancelled = false;
	previous.signal.addEventListener('abort', () => { cancelled = true; });
	previous.assertActive(); previous.close();
	assert.equal(cancelled, true);
	assert.throws(previous.assertActive, { name: 'AbortError' });
	const next = createTransientLifetime();
	next.assertActive();
	assert.equal(next.signal.aborted, false);
});

test('field readers refuse another form, duplicate names, disabled values and file paths', () => {
	const group = { tagName: 'FIELDSET', querySelectorAll: () => fields };
	const other = {};
	const field = (name: string, parent: unknown = group, disabled = false) => ({ name, tagName: 'INPUT', type: 'text', value: 'fixture',
		closest: () => parent, matches: () => disabled });
	let fields = [field('local'), field('foreign', other), field('disabled', group, true)];
	assert.equal(transientNamedField(group as any, 'local'), fields[0]);
	assert.equal(transientNamedField(group as any, 'foreign'), null);
	assert.equal(transientNamedField(group as any, 'disabled'), null);
	fields.push(field('local'));
	assert.equal(transientNamedField(group as any, 'local'), null);
	assert.equal(transientFieldValue({ ...field('file'), type: 'file', value: '/private/file' } as any), undefined);
	assert.equal(transientFieldValue({ ...field('check'), type: 'checkbox', checked: false } as any), false);
});


test('a transient boundary refuses outer capture delegates even on plain and forged controls', () => {
	const boundary = {};
	for (const kind of ['plain-text', 'no-action-input', 'forged-ordinary-action']) {
		const element = { kind, closest: (selector: string) => selector === '[data-tt-transient-boundary]' ? boundary : null };
		assert.equal(isTransientBlockTarget(element as any), true);
	}
	assert.equal(isTransientBlockTarget({ closest: () => null } as any), false);
});


test('capture leaves native Thing controls and nested adapters to their own handlers', () => {
	const root = { contains: () => true };
	const nestedBoundary = {};
	const control = (action: string, boundary: unknown = root) => ({
		getAttribute: () => action,
		closest: () => boundary
	});
	const nativeToggle = { closest: () => null };
	assert.equal(transientControlForTarget(root as any, nativeToggle as any), null,
		'the Thing data/render toggle must reach its React onClick');
	const owned = control('$transient');
	assert.equal(transientControlForTarget(root as any, { closest: () => owned } as any), owned);
	const foreign = control('saved-action');
	assert.equal(transientControlForTarget(root as any, { closest: () => foreign } as any), null);
	const nested = control('$transient', nestedBoundary);
	assert.equal(transientControlForTarget(root as any, { closest: () => nested } as any), null,
		'an outer adapter cannot capture a nested adapter control');
	assert.equal(transientControlForTarget({ contains: () => false } as any, { closest: () => owned } as any), null);
});
