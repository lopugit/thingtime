import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	ACTION_LIMIT_CEILINGS,
	CASCADE_CHILD_THINGTIME,
	MAX_ACTION_RUN_HISTORY,
	MAX_ACTION_RUNS_RETAINED,
	MAX_ACTION_SEARCH_LIMIT,
	PROTECTED_THINGTIME,
	deriveActionEffects,
	parseActionRef,
	sanitizeActionCrystal
} from './registry.ts';

// The save-time half of the bounded-execution contract, unit-tested where the
// live battery (scripts/verify-actions.mjs) can't reach: what happens when a
// step OMITS something. These are the guards that make a shared action's
// consent surface truthful — an action that saves has declared-and-true
// effects, and the derived summary never under-reports.

const validBase = {
	name: 'Test action',
	inputs: [{ name: 'title', type: 'string', required: true }],
	steps: [
		{ op: 'things.create', schema: 'customer', values: { name: '$input.title' } },
		{ op: 'return', value: '$step.1' }
	],
	capabilities: [{ capability: 'things.create', schemas: ['customer'] }]
};

const expectFail = (crystal: Record<string, unknown>, pattern: RegExp, label: string) => {
	const result = sanitizeActionCrystal(crystal);
	assert.equal(result.ok, false, `${label}: expected a refusal`);
	if (result.ok === false) assert.match(result.error, pattern, label);
};

test('a valid program sanitizes and preserves its steps', () => {
	const result = sanitizeActionCrystal(validBase);
	assert.equal(result.ok, true);
	if (result.ok) {
		const steps = result.crystal.steps as Record<string, unknown>[];
		assert.equal(steps.length, 2);
		assert.equal(steps[0].op, 'things.create');
		assert.equal(steps[0].schema, 'customer');
	}
});

test('the vocabulary is closed — unknown ops are refused', () => {
	expectFail(
		{ name: 'Bad', steps: [{ op: 'shell.exec', cmd: 'rm -rf /' }] },
		/closed/,
		'unknown op'
	);
});

test('a step without its capability declared is refused', () => {
	expectFail(
		{ name: 'Bad', steps: [{ op: 'things.create', schema: 'customer', values: { a: 1 } }] },
		/capability/,
		'uncovered step'
	);
});

test('a literal step schema outside the capability scope is refused', () => {
	expectFail(
		{
			name: 'Bad',
			steps: [{ op: 'things.create', schema: 'customer', values: { a: 1 } }],
			capabilities: [{ capability: 'things.create', schemas: ['invoice'] }]
		},
		/scoped to/,
		'scope mismatch'
	);
});

test('search limits are bounded 1..MAX_ACTION_SEARCH_LIMIT', () => {
	const step = (limit: number) => ({
		name: 'Bad',
		steps: [{ op: 'things.search', schema: 'customer', limit }],
		capabilities: [{ capability: 'things.read', schemas: ['customer'] }]
	});
	// limit 0 would be Mongo's "unbounded" — must never reach the executor
	expectFail(step(0), /limit must be/, 'limit 0');
	expectFail(step(MAX_ACTION_SEARCH_LIMIT + 1), /limit must be/, 'limit above cap');
	assert.equal(sanitizeActionCrystal(step(1)).ok, true);
	assert.equal(sanitizeActionCrystal(step(MAX_ACTION_SEARCH_LIMIT)).ok, true);
});

test('return must be the last step', () => {
	expectFail(
		{
			name: 'Bad',
			steps: [
				{ op: 'return', value: 'early' },
				{ op: 'things.create', schema: 'customer', values: { a: 1 } }
			],
			capabilities: [{ capability: 'things.create', schemas: ['customer'] }]
		},
		/last step/,
		'mid return'
	);
});

test('a $step reference to a later step is refused', () => {
	expectFail(
		{
			name: 'Bad',
			steps: [
				{ op: 'things.create', schema: 'customer', values: { a: '$step.2.id' } },
				{ op: 'return', value: '$step.1' }
			],
			capabilities: [{ capability: 'things.create', schemas: ['customer'] }]
		},
		/before it has run/,
		'forward ref'
	);
});

test('a $input reference to an undeclared input is refused', () => {
	expectFail(
		{
			name: 'Bad',
			steps: [{ op: 'things.create', schema: 'customer', values: { a: '$input.nope' } }],
			capabilities: [{ capability: 'things.create', schemas: ['customer'] }]
		},
		/no such input/,
		'undeclared input'
	);
});

test('actions.invoke outside the declared allowlist is refused', () => {
	expectFail(
		{
			name: 'Bad',
			steps: [{ op: 'actions.invoke', action: 'not-allowed' }],
			capabilities: [{ capability: 'actions.invoke', actions: ['something-else'] }]
		},
		/allowlist/,
		'allowlist violation'
	);
});

test('duplicate capabilities are refused', () => {
	expectFail(
		{
			name: 'Bad',
			steps: [{ op: 'return', value: 1 }],
			capabilities: [{ capability: 'things.read' }, { capability: 'things.read' }]
		},
		/Duplicate capability/,
		'duplicate capability'
	);
});

test('unknown limit keys are refused and known limits clamp to the ceilings', () => {
	expectFail({ name: 'Bad', steps: [{ op: 'return', value: 1 }], limits: { fork: 9 } }, /Unknown limit/, 'unknown limit');
	const result = sanitizeActionCrystal({
		name: 'Clamped',
		steps: [{ op: 'return', value: 1 }],
		limits: { timeoutMs: 900000, maxOperations: 9999 }
	});
	assert.equal(result.ok, true);
	if (result.ok) {
		const limits = result.crystal.limits as Record<string, number>;
		assert.equal(limits.timeoutMs, ACTION_LIMIT_CEILINGS.timeoutMs);
		assert.equal(limits.maxOperations, ACTION_LIMIT_CEILINGS.maxOperations);
	}
});

// ── the derived consent surface ─────────────────────────────────────────────

test('an unscoped things.search reports the broad read effect', () => {
	// THE regression guard for the consent surface: a bare search is the
	// broadest read in the vocabulary and must render as "reads things" ('*'),
	// never as no read effect at all (things.get already had this treatment).
	const effects = deriveActionEffects([{ op: 'things.search' }]);
	assert.deepEqual(effects.reads, ['*']);
});

test('an unscoped things.get reports the broad read effect', () => {
	assert.deepEqual(deriveActionEffects([{ op: 'things.get', id: '$input.x' }]).reads, ['*']);
});

test('effects summarize creates, scoped reads, updates, and invokes', () => {
	const effects = deriveActionEffects([
		{ op: 'things.search', schema: 'customer' },
		{ op: 'things.create', schema: 'invoice', values: {} },
		{ op: 'things.update', id: '$input.id', values: {} },
		{ op: 'actions.invoke', action: 'send-email' },
		{ op: 'return', value: 1 }
	]);
	assert.deepEqual(effects.reads, ['customer']);
	assert.deepEqual(effects.creates, ['invoice']);
	assert.equal(effects.updates, true);
	assert.deepEqual(effects.invokes, ['send-email']);
	assert.equal(effects.returns, true);
});

// ── the reference grammar ───────────────────────────────────────────────────

test('parseActionRef: literals, escapes, and proto segments', () => {
	assert.equal(parseActionRef('plain text'), null);
	assert.equal(parseActionRef('$$100'), null); // escaped literal, not a ref
	assert.deepEqual(parseActionRef('$now'), { kind: 'now' });
	assert.deepEqual(parseActionRef('$input.name'), { kind: 'input', name: 'name' });
	assert.deepEqual(parseActionRef('$step.2.crystal.name'), { kind: 'step', step: 2, path: ['crystal', 'name'] });
	const proto = parseActionRef('$step.1.__proto__.polluted');
	assert.equal(proto && 'ok' in proto && proto.ok === false, true, 'proto segment must be refused');
	const malformed = parseActionRef('$bogus.root');
	assert.equal(malformed && 'ok' in malformed && malformed.ok === false, true, 'unknown root must be refused');
});

// Input defaults substitute verbatim at run time when the input is omitted,
// so an incongruent default would make every default-using run fail input
// validation. The grammar refuses the mismatch at save time instead.
test('input defaults must be congruent with their declared type', () => {
	const withInputs = (extra: Record<string, unknown>) => ({
		...validBase,
		inputs: [{ name: 'title', type: 'string', required: true }, extra]
	});
	expectFail(withInputs({ name: 'note', type: 'string', default: true }), /default must be text/, 'boolean default on a string input');
	expectFail(withInputs({ name: 'count', type: 'number', default: 'lots' }), /default must be a number/, 'text default on a number input');
	expectFail(withInputs({ name: 'flag', type: 'boolean', default: 'true' }), /default must be true or false/, 'text default on a boolean input');
	expectFail(
		withInputs({ name: 'mode', type: 'enum', values: ['draft', 'sent'], default: 'paid' }),
		/default must be one of its enum values/,
		'out-of-set enum default'
	);
	const ok = sanitizeActionCrystal({
		...validBase,
		inputs: [
			{ name: 'title', type: 'string', required: true },
			{ name: 'note', type: 'string', default: '42' },
			{ name: 'count', type: 'number', default: 3 },
			{ name: 'flag', type: 'boolean', default: false },
			{ name: 'mode', type: 'enum', values: ['draft', 'sent'], default: 'sent' }
		]
	});
	assert.equal(ok.ok, true, 'congruent defaults save');
});

// action-run records are the one artifact of a run written outside createThing
// (protected kind, direct insert) and stamped storageClass 'control', which
// takes them out of the storage ledger entirely — so the executor bounds the
// trail by COUNT after each write. Retention must never cut below what the
// history endpoint still serves, or /actions would list runs that the next run
// silently deleted.
test('run retention never drops a record the history endpoint would still show', () => {
	assert.ok(
		MAX_ACTION_RUNS_RETAINED >= MAX_ACTION_RUN_HISTORY,
		`retention (${MAX_ACTION_RUNS_RETAINED}) must cover the history page size (${MAX_ACTION_RUN_HISTORY})`
	);
	assert.ok(Number.isInteger(MAX_ACTION_RUNS_RETAINED) && MAX_ACTION_RUNS_RETAINED > 0, 'retention is a positive integer');
});

// The retention prune only ever runs DURING a run of that same action, so it
// cannot bound a trail whose action is gone. action-run is also PROTECTED (no
// route lets its owner delete it) and storageClass 'control' (outside the
// storage ledger), so if deleting an action did not take its records with it,
// create/run/delete cycles would strand unaccounted documents that nothing
// would ever prune or bill — and the owner would have no way to remove their
// own run history. The cascade is what closes that, so both halves of the
// reasoning are pinned here.
test('a deleted action takes its run records with it', () => {
	assert.ok(
		(CASCADE_CHILD_THINGTIME as readonly string[]).includes('action-run'),
		'action-run must cascade with the action its targetId names'
	);
	assert.ok(
		(PROTECTED_THINGTIME as readonly string[]).includes('action-run'),
		'action-run stays protected — the cascade, not a delete route, is how the trail goes away'
	);
});
