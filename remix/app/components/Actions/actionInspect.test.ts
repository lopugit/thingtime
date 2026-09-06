import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveActionEffects } from '../../schemas/registry.ts';

import {
	actionCannotAccess,
	coerceInputDefault,
	coerceValueText,
	componentBindsAction,
	deriveRequiredCapabilities,
	runInputDescriptorsOf,
	selectActionByKey
} from './actionInspect.ts';

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

test('componentBindsAction matches literal ttAction keys and ids', () => {
	const render = { tag: 'div', children: [{ tag: 'span', ttAction: 'send-invoice', children: ['Send'] }] };
	assert.equal(componentBindsAction(render, { id: 'abc', actionKey: 'send-invoice' }), true);
	assert.equal(componentBindsAction(render, { id: 'abc', actionKey: 'other' }), false);
	assert.equal(componentBindsAction({ tag: 'div', ttAction: 'abc' }, { id: 'abc' }), true);
});

test('componentBindsAction never false-positives on substrings', () => {
	const render = { tag: 'div', ttAction: 'send-invoice-v2' };
	assert.equal(componentBindsAction(render, { id: 'x', actionKey: 'send-invoice' }), false);
	assert.equal(componentBindsAction(null, { id: 'x', actionKey: 'send-invoice' }), false);
});

// A parameterless action is a first-class shape: `inputs` is optional in the
// grammar, the registry writes the key ONLY when non-empty, and the builder
// advertises "No inputs — the action runs parameterless." The run form derives
// its defaults from this list inside a memo and syncs them into state, so the
// empty case has to be reference-stable or the inspector re-renders forever.
test('a parameterless action yields a STABLE empty descriptor list', () => {
	const parameterless = { name: 'Nightly digest', steps: [{ op: 'things.search', schema: 'invoice' }] };
	const first = runInputDescriptorsOf(parameterless);
	const second = runInputDescriptorsOf(parameterless);
	assert.deepEqual(first, []);
	// same identity across calls AND across distinct crystals — anything else
	// re-fires the run panel's defaults effect on every render
	assert.equal(first, second);
	assert.equal(first, runInputDescriptorsOf({ name: 'Another', steps: [] }));
	assert.equal(first, runInputDescriptorsOf(null));
	assert.equal(first, runInputDescriptorsOf(undefined));
	assert.equal(first, runInputDescriptorsOf({ inputs: undefined }));
	// a non-array `inputs` is malformed, not a descriptor list
	assert.equal(first, runInputDescriptorsOf({ inputs: 'nope' } as never));
});

test('a declared input list passes through by reference', () => {
	const inputs = [{ name: 'amount', type: 'number' }];
	const crystal = { name: 'Charge', inputs };
	assert.equal(runInputDescriptorsOf(crystal), inputs);
	// stable across calls too, so the memo below it never re-derives
	assert.equal(runInputDescriptorsOf(crystal), runInputDescriptorsOf(crystal));
});

// Builder defaults are only coerced TOWARD the declared type — the grammar
// refuses incongruent defaults at save time, so a string input's '42' (or a
// zero-padded phone) must survive as text while a number input's '42'
// becomes 42. Anything the coercion can't honestly convert passes through
// so the save fails with the grammar's message instead of mislabeling.
test('coerceInputDefault coerces toward the declared type only', () => {
	assert.equal(coerceInputDefault('42', 'number'), 42);
	assert.equal(coerceInputDefault('1.50', 'number'), 1.5);
	assert.equal(coerceInputDefault('abc', 'number'), 'abc');
	assert.equal(coerceInputDefault('true', 'boolean'), true);
	assert.equal(coerceInputDefault('false', 'boolean'), false);
	assert.equal(coerceInputDefault('yes', 'boolean'), 'yes');
	assert.equal(coerceInputDefault('42', 'string'), '42');
	assert.equal(coerceInputDefault('true', 'text'), 'true');
	assert.equal(coerceInputDefault('sent', 'enum'), 'sent');
	assert.equal(coerceInputDefault('0412345678', 'string'), '0412345678');
});

// Duplicate actionKeys must resolve identically in the inspector and the
// executor (latest revision = highest crystal.version), or the page would
// display a different program than a key-referenced run executes.
test('selectActionByKey: id wins, then the latest actionKey revision', () => {
	const v1 = { id: 'a1', crystal: { actionKey: 'send', version: 1 } };
	const v2 = { id: 'a2', crystal: { actionKey: 'send', version: 2 } };
	const unversioned = { id: 'a3', crystal: { actionKey: 'send' } };
	const other = { id: 'b1', crystal: { actionKey: 'tag' } };
	assert.equal(selectActionByKey([v2, v1, other], 'a1'), v1);
	assert.equal(selectActionByKey([v1, v2, other], 'send'), v2);
	assert.equal(selectActionByKey([v2, v1], 'send'), v2);
	assert.equal(selectActionByKey([unversioned, v1], 'send'), v1);
	assert.equal(selectActionByKey([other], 'send'), null);
	assert.equal(selectActionByKey([], 'send'), null);
});

// A composing action cannot assert absolute negatives about code it never
// read: the invoked child runs on its OWN declaration, so "Cannot create
// things" on the parent would be a lie the inspector tells about the run.
// Only the vocabulary-level negatives (no network/secrets/deletes) hold for
// every program unconditionally.
test('a composing action does not claim negatives its children can break', () => {
	const composed = actionCannotAccess([{ capability: 'actions.invoke', actions: ['make-invoice'] }]);
	assert.ok(composed.includes('No network'), 'vocabulary negatives always hold');
	assert.ok(composed.includes('No secrets'));
	assert.ok(composed.includes('No deletes'));
	assert.equal(composed.includes('Cannot create things'), false, 'a child may create');
	assert.equal(composed.includes('Cannot update things'), false, 'a child may update');
	assert.equal(composed.includes('Cannot read things'), false, 'a child may read');
	assert.ok(composed.some((line) => /Runs other actions/.test(line)), 'the composition is disclosed instead');
});

test('a non-composing action still asserts the full negative list', () => {
	const leaf = actionCannotAccess([{ capability: 'things.read', schemas: ['customer'] }]);
	assert.ok(leaf.includes('Cannot create things'));
	assert.ok(leaf.includes('Cannot update things'));
	assert.ok(leaf.includes('Cannot invoke other actions'));
	assert.equal(leaf.includes('Cannot read things'), false, 'it declared things.read');
});

// Every line of this list renders under a 🚫 as something the program cannot
// do, so a declared things.delete must DROP "No deletes" and add nothing:
// an affirmative sentence here would render as "🚫 Can delete …", inverting
// the one capability that destroys data. The disclosure is a chip instead
// (deriveActionEffects().deletes → the Effects section).
test('a declared things.delete drops the negative without asserting an affirmative', () => {
	const deleter = actionCannotAccess([{ capability: 'things.delete', schemas: ['task'] }]);
	assert.equal(deleter.includes('No deletes'), false, 'it declared things.delete');
	assert.equal(
		deleter.some((line) => /^Can\b/.test(line)),
		false,
		'the 🚫 list only ever states negatives'
	);
	assert.ok(deleter.some((line) => line.includes('things.delete only: task')), 'the scope is still disclosed');
});

// The Effects section is the surface that carries the affirmative, so the
// derived effects a delete-only program produces have to be non-empty —
// otherwise the destructive step has no at-a-glance disclosure anywhere.
test('a delete-only program derives a delete effect to render', () => {
	const effects = deriveActionEffects([
		{ op: 'things.delete', id: '$input.id' },
		{ op: 'return', value: 'gone' }
	]);
	assert.equal(effects.deletes, true);
	assert.deepEqual(effects.creates, []);
	assert.equal(effects.updates, false);
});
