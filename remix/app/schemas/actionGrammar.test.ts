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

// ── v2 vocabulary: compute / when / delete / each / fail / expressions ──────

test('compute steps bind expressions and later steps can read them', () => {
	const result = sanitizeActionCrystal({
		name: 'Roll',
		inputs: [{ name: 'lo', type: 'number', default: 1 }],
		steps: [
			{ op: 'compute', value: { ttExpr: ['randomInt', '$input.lo', 6] } },
			{ op: 'compute', value: { total: { ttExpr: ['add', '$step.1', 10] }, label: { ttConcat: ['rolled ', '$step.1'] } } },
			{ op: 'return', value: '$step.2' }
		]
	});
	assert.equal(result.ok, true);
	if (result.ok) {
		const effects = deriveActionEffects(result.crystal.steps);
		assert.equal(effects.computes, true);
		assert.equal(effects.deletes, false);
	}
});

test('expressions are validated against the closed catalogue and arities', () => {
	expectFail({ name: 'Bad', steps: [{ op: 'compute', value: { ttExpr: ['eval', 'x'] } }] }, /unknown function/, 'unknown fn');
	expectFail({ name: 'Bad', steps: [{ op: 'compute', value: { ttExpr: ['sub', 1] } }] }, /takes 2 args/, 'arity');
	expectFail({ name: 'Bad', steps: [{ op: 'compute', value: { ttExpr: ['add', '$item', 1] } }] }, /outside an each step or a list lambda/, '$item at top level');
	const ok = sanitizeActionCrystal({ name: 'Lambda', steps: [{ op: 'compute', value: { ttExpr: ['map', [1, 2], { ttExpr: ['add', '$item', '$index'] }] } }] });
	assert.equal(ok.ok, true, 'lambda args may read $item/$index');
});

test('when guards any step and allows a guarded early return', () => {
	const result = sanitizeActionCrystal({
		name: 'Guarded',
		inputs: [{ name: 'skip', type: 'boolean', default: false }],
		steps: [
			{ op: 'return', when: '$input.skip', value: { skipped: true } },
			{ op: 'compute', value: 1, when: { ttExpr: ['not', '$input.skip'] } },
			{ op: 'return', value: '$step.2' }
		]
	});
	assert.equal(result.ok, true);
	expectFail({ name: 'Bad', steps: [{ op: 'return', value: 1 }, { op: 'compute', value: 2 }] }, /last step/, 'unguarded return must be last');
});

test('things.delete needs its capability and derives a delete effect', () => {
	expectFail({ name: 'Bad', steps: [{ op: 'things.delete', id: 'abc' }] }, /things.delete capability/, 'missing capability');
	const result = sanitizeActionCrystal({
		name: 'Erase',
		steps: [{ op: 'things.delete', id: 'abc' }],
		capabilities: [{ capability: 'things.delete', schemas: ['profile'] }]
	});
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(deriveActionEffects(result.crystal.steps).deletes, true);
});

test('each invokes a child per element with $item bound in its inputs', () => {
	const result = sanitizeActionCrystal({
		name: 'Heal all',
		steps: [
			{ op: 'things.search', schema: 'pokemon', limit: 6 },
			{ op: 'each', list: '$step.1', action: 'heal-one', max: 6, inputs: { id: '$item.id', slot: '$index' } },
			{ op: 'return', value: '$step.2' }
		],
		capabilities: [{ capability: 'things.read', schemas: ['pokemon'] }, { capability: 'actions.invoke', actions: ['heal-one'] }]
	});
	assert.equal(result.ok, true);
	if (result.ok) assert.deepEqual(deriveActionEffects(result.crystal.steps).invokes, ['heal-one']);
	expectFail(
		{ name: 'Bad', steps: [{ op: 'each', list: [1], action: 'x', max: 999 }], capabilities: [{ capability: 'actions.invoke' }] },
		/max must be/,
		'each max cap'
	);
});

test('fail steps carry an authored message', () => {
	const result = sanitizeActionCrystal({
		name: 'Refuse',
		inputs: [{ name: 'balls', type: 'number', default: 0 }],
		steps: [{ op: 'fail', when: { ttExpr: ['lte', '$input.balls', 0] }, message: 'No Poké Balls left!' }, { op: 'return', value: 'ok' }]
	});
	assert.equal(result.ok, true);
	expectFail({ name: 'Bad', steps: [{ op: 'fail' }] }, /needs message/, 'message required');
});

test('search accepts scope, where, match, sort and offset within their caps', () => {
	const result = sanitizeActionCrystal({
		name: 'Species',
		inputs: [{ name: 'dex', type: 'number', required: true }],
		steps: [
			{ op: 'things.search', schema: 'species', scope: 'public', where: { dex: '$input.dex' }, match: { name: 'pika' }, sort: { field: 'dex', dir: 'asc' }, offset: 0, limit: 5 },
			{ op: 'return', value: '$step.1' }
		],
		capabilities: [{ capability: 'things.read', schemas: ['species'] }]
	});
	assert.equal(result.ok, true);
	if (result.ok) assert.deepEqual(deriveActionEffects(result.crystal.steps).publicReads, ['species']);
	expectFail({ name: 'Bad', steps: [{ op: 'things.search', scope: 'public' }], capabilities: [{ capability: 'things.read' }] }, /must name a schema/, 'public needs schema');
	expectFail(
		{ name: 'Bad', steps: [{ op: 'things.search', where: { schemaId: 'x' } }], capabilities: [{ capability: 'things.read' }] },
		/not a plain crystal field/,
		'where cannot touch provenance'
	);
	expectFail(
		{ name: 'Bad', steps: [{ op: 'things.search', sort: { field: '$bad' } }], capabilities: [{ capability: 'things.read' }] },
		/sort.field/,
		'sort field grammar'
	);
});

// "The catalogue is closed" is a save-time promise, and the closure has to
// survive the prototype chain: EXPRESSION_CATALOGUE is an object literal, so
// `CATALOGUE['constructor']` is truthy with min/max undefined — and both arity
// comparisons against undefined are false. An unguarded gate would store the
// step, and the executor would then call whatever the name inherited.
test('ttExpr cannot name a function inherited from Object.prototype', () => {
	for (const name of ['constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__proto__']) {
		expectFail(
			{ name: 'Bad', steps: [{ op: 'compute', value: { ttExpr: [name, 'x', 'y'] } }] },
			/names an unknown function/,
			`ttExpr ${name}`
		);
	}
	// the real catalogue entry with the same shape still saves
	const ok = sanitizeActionCrystal({ name: 'Fine', steps: [{ op: 'compute', value: { ttExpr: ['toString', 7] } }] });
	assert.equal(ok.ok, true);
});

test('viewer refs parse and unknown roots are still refused', () => {
	assert.deepEqual(parseActionRef('$viewer.id'), { kind: 'viewer', field: 'id' });
	assert.deepEqual(parseActionRef('$item.hp.max'), { kind: 'item', path: ['hp', 'max'] });
	assert.deepEqual(parseActionRef('$index'), { kind: 'index' });
	const bad = parseActionRef('$viewer.email');
	assert.equal(bad && 'ok' in bad ? bad.ok : true, false);
	const unknown = parseActionRef('$env.SECRET');
	assert.equal(unknown && 'ok' in unknown ? unknown.ok : true, false);
});
