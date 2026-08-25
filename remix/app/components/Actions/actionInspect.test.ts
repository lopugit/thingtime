import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveActionEffects } from '../../schemas/registry.ts';

import { actionCannotAccess, coerceValueText, deriveRequiredCapabilities } from './actionInspect.ts';

// The builder's consent surface: deriveRequiredCapabilities promises that a
// UI-authored action cannot declare less than it does, and coerceValueText
// decides what an author can literally type into a value field. Both are pure
// helpers — everything the save-time registry gate cannot see (what a dynamic
// id resolves to, what a form string "meant") is decided here, so both carry
// the same regression bar as the grammar tests.

test('literal step schemas derive scoped capabilities', () => {
	const derived = deriveRequiredCapabilities([
		{ op: 'things.create', schema: 'customer', values: { name: '$input.name' } },
		{ op: 'things.search', schema: 'invoice' },
		{ op: 'return', value: '$step.2' }
	]);
	assert.deepEqual(derived, [
		{ capability: 'things.create', schemas: ['customer'] },
		{ capability: 'things.read', schemas: ['invoice'] }
	]);
});

test('a dynamic-id get alone derives an unscoped things.read', () => {
	const derived = deriveRequiredCapabilities([{ op: 'things.get', id: '$input.id' }]);
	assert.deepEqual(derived, [{ capability: 'things.read' }]);
	assert.equal('schemas' in derived[0], false);
});

test('a bare things.search derives an unscoped things.read', () => {
	const derived = deriveRequiredCapabilities([{ op: 'things.search' }]);
	assert.deepEqual(derived, [{ capability: 'things.read' }]);
});

test('an unscoped read step widens a scope a sibling step seeded', () => {
	// The regression: search{customer} seeded ['customer'] and the bare get
	// contributed nothing, so the derived declaration was NARROWER than the
	// program — it saved, then refused mid-run the first time the dynamic id
	// resolved outside 'customer'. One unscoped step must unscope the whole
	// capability.
	const derived = deriveRequiredCapabilities([
		{ op: 'things.search', schema: 'customer' },
		{ op: 'things.get', id: '$input.invoiceId' }
	]);
	const read = derived.find((entry) => entry.capability === 'things.read');
	assert.ok(read, 'things.read must still be derived');
	assert.equal('schemas' in read!, false, 'one unscoped read step must unscope the whole capability');
});

test('the derived read scope agrees with the effects-summary breadth', () => {
	// Finding 2 made deriveActionEffects report a bare read as the '*' broad
	// read; the capability chip must never claim narrower than that.
	const steps = [
		{ op: 'things.search', schema: 'customer' },
		{ op: 'things.get', id: '$input.invoiceId' }
	];
	const effects = deriveActionEffects(steps);
	assert.ok(effects.reads.includes('*'), 'effects summary reports the broad read');
	const read = deriveRequiredCapabilities(steps).find((entry) => entry.capability === 'things.read');
	assert.equal('schemas' in read!, false, 'capability chip agrees with the effects summary');
});

test('things.update derives an unscoped things.update (ids are dynamic)', () => {
	const derived = deriveRequiredCapabilities([{ op: 'things.update', id: '$input.id', values: { status: 'sent' } }]);
	assert.deepEqual(derived, [{ capability: 'things.update' }]);
});

test('actions.invoke derives the invoked-action allowlist', () => {
	const derived = deriveRequiredCapabilities([
		{ op: 'actions.invoke', action: 'send-invoice-email' },
		{ op: 'actions.invoke', action: 'render-invoice-pdf' }
	]);
	assert.deepEqual(derived, [{ capability: 'actions.invoke', actions: ['send-invoice-email', 'render-invoice-pdf'] }]);
});

test('refs and $$-escapes stay verbatim strings', () => {
	assert.equal(coerceValueText('$input.name'), '$input.name');
	assert.equal(coerceValueText('$step.1.id'), '$step.1.id');
	assert.equal(coerceValueText('$$literal-dollar'), '$$literal-dollar');
});

test('true/false coerce to booleans', () => {
	assert.equal(coerceValueText('true'), true);
	assert.equal(coerceValueText('false'), false);
	assert.equal(coerceValueText(' true '), true);
});

test('canonical decimal text coerces to numbers', () => {
	assert.equal(coerceValueText('42'), 42);
	assert.equal(coerceValueText('0'), 0);
	assert.equal(coerceValueText('0.5'), 0.5);
	assert.equal(coerceValueText('-3.25'), -3.25);
	assert.equal(coerceValueText('1.50'), 1.5);
	assert.equal(coerceValueText(' 12 '), 12);
});

test('zero-padded and exponent text stays a string', () => {
	// Number('0412345678') === 412345678 — a lossy read of a phone number,
	// and a string schema field rejects numbers outright, so under naive
	// coercion these values were unauthorable in the builder.
	assert.equal(coerceValueText('0412345678'), '0412345678');
	assert.equal(coerceValueText('0800'), '0800');
	assert.equal(coerceValueText('007'), '007');
	assert.equal(coerceValueText('1e3'), '1e3');
	assert.equal(coerceValueText('0x10'), '0x10');
	assert.equal(coerceValueText('Infinity'), 'Infinity');
});

test('non-numeric text returns the raw value untrimmed', () => {
	assert.equal(coerceValueText('Margaret Hamilton'), 'Margaret Hamilton');
	assert.equal(coerceValueText(' padded '), ' padded ');
	assert.equal(coerceValueText(''), '');
});

test('actionCannotAccess reflects scoped entries and vocabulary invariants', () => {
	const list = actionCannotAccess([{ capability: 'things.read', schemas: ['customer'] }]);
	assert.ok(list.includes('No network'));
	assert.ok(list.includes('No secrets'));
	assert.ok(list.includes('No deletes'));
	assert.ok(list.includes('Cannot create things'));
	assert.ok(list.some((line) => line.includes('things.read only: customer')));
});
